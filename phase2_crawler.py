"""Phase 2: Key Page Detail Crawler.

For each key page discovered in Phase 1:
- Query full key page details
- Extract: version, threshold, keys, delegate signers
"""

import logging

from .api_client import ApiClient
from .database import Database

log = logging.getLogger(__name__)


def crawl_key_page(db: Database, api: ApiClient, page_url: str, key_book_url: str,
                   adi_url: str):
    """Query a key page and store its full details."""
    result = api.query_account(page_url)
    if not result:
        log.warning("Could not query key page: %s", page_url)
        return False

    acct = result.get("account", {})

    version = acct.get("version")
    threshold = acct.get("threshold")
    accept_threshold = acct.get("acceptThreshold")
    credit_balance = acct.get("creditBalance")
    keys = acct.get("keys", [])

    db.upsert_key_page(
        url=page_url,
        key_book_url=key_book_url,
        adi_url=adi_url,
        version=version,
        threshold=threshold,
        accept_threshold=accept_threshold,
        credit_balance=credit_balance,
        crawl_status="done",
    )

    # Clear old entries and insert fresh
    db.clear_key_entries(page_url)
    for key_entry in keys:
        db.insert_key_entry(
            key_page_url=page_url,
            public_key_hash=key_entry.get("publicKeyHash"),
            public_key=key_entry.get("publicKey"),
            delegate=key_entry.get("delegate"),
            last_used_on=key_entry.get("lastUsedOn"),
        )

    log.debug(
        "  Key page %s: version=%s threshold=%s keys=%d",
        page_url, version, threshold, len(keys),
    )
    return True


def run_phase2(db: Database, api: ApiClient):
    """Run Phase 2: crawl all pending key pages."""
    log.info("=== Phase 2: Key Page Detail Crawler ===")

    pending = db.get_pending_key_pages()
    total = len(pending)
    log.info("Found %d pending key pages to crawl", total)

    success = 0
    errors = 0
    for i, page in enumerate(pending):
        try:
            ok = crawl_key_page(
                db, api,
                page["url"], page["key_book_url"], page["adi_url"],
            )
            if ok:
                success += 1
            else:
                errors += 1
        except Exception as e:
            log.error("Error crawling key page %s: %s", page["url"], e)
            errors += 1

        if (i + 1) % 20 == 0:
            db.commit()
            log.info("  Progress: %d/%d key pages processed", i + 1, total)

    db.commit()

    total_entries = db.conn.execute("SELECT COUNT(*) FROM key_entries").fetchone()[0]
    log.info(
        "Phase 2 complete. %d key pages processed (%d success, %d errors). "
        "%d key entries recorded.",
        total, success, errors, total_entries,
    )
    log.info("API requests made: %d", api.request_count)
