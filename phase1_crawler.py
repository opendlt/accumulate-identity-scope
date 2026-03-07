"""Phase 1: ADI Directory Crawler & Analyzer.

For each ADI:
- Query directory to discover all sub-accounts
- Categorize each entry (token account, data account, key book, token issuer, sub-ADI)
- Query each entry for details (authorities, token URL, etc.)
- Recursively process sub-ADIs
- Record all authorities (explicit + implied)
"""

import json
import sqlite3
import logging
from urllib.parse import urlparse

from .api_client import ApiClient
from .database import Database

log = logging.getLogger(__name__)

# Account types returned by the API
ACCOUNT_TYPES = {
    "identity": "adi",
    "tokenAccount": "token_account",
    "dataAccount": "data_account",
    "tokenIssuer": "token_issuer",
    "keyBook": "key_book",
    "keyPage": "key_page",
    "liteTokenAccount": "lite_token_account",
    "liteIdentity": "lite_identity",
    "liteDataAccount": "lite_data_account",
}


def get_adi_url_from_account(account_url: str) -> str:
    """Extract the ADI URL from an account URL.

    e.g. acc://myadi.acme/token -> acc://myadi.acme
    e.g. acc://myadi.acme/book/1 -> acc://myadi.acme
    """
    parsed = urlparse(account_url)
    # The ADI is the authority portion: scheme://authority
    return f"{parsed.scheme}://{parsed.netloc}"


def extract_authorities(account_data: dict) -> list[dict]:
    """Extract authorities from account response."""
    acct = account_data.get("account", {})
    return acct.get("authorities", [])


def authorities_to_json(authorities: list[dict]) -> str:
    """Convert authorities list to JSON string for storage."""
    return json.dumps([
        {"url": a.get("url", ""), "disabled": a.get("disabled", False)}
        for a in authorities
    ])


def store_authorities(db: Database, account_url: str, authorities: list[dict],
                      adi_authorities: list[dict] | None = None):
    """Store authority records. If account has no explicit authorities, use ADI's (implied)."""
    if authorities:
        for auth in authorities:
            db.upsert_authority(
                account_url, auth.get("url", ""),
                is_implied=False,
                disabled=auth.get("disabled", False),
            )
    elif adi_authorities:
        # Implied authority: inherit from parent ADI
        for auth in adi_authorities:
            db.upsert_authority(
                account_url, auth.get("url", ""),
                is_implied=True,
                disabled=auth.get("disabled", False),
            )


def process_token_account(db: Database, api: ApiClient, url: str, adi_url: str,
                          adi_authorities: list[dict]):
    """Query and store a token account."""
    result = api.query_account(url)
    if not result:
        log.warning("Could not query token account: %s", url)
        return

    acct = result.get("account", {})
    token_url = acct.get("tokenUrl", "")
    authorities = extract_authorities(result)
    auth_json = authorities_to_json(authorities) if authorities else authorities_to_json(adi_authorities)

    db.upsert_token_account(url, adi_url, token_url, auth_json)
    store_authorities(db, url, authorities, adi_authorities)
    log.debug("  Token account: %s -> token=%s", url, token_url)


def process_data_account(db: Database, api: ApiClient, url: str, adi_url: str,
                         adi_authorities: list[dict]):
    """Query and store a data account."""
    result = api.query_account(url)
    if not result:
        log.warning("Could not query data account: %s", url)
        return

    authorities = extract_authorities(result)
    auth_json = authorities_to_json(authorities) if authorities else authorities_to_json(adi_authorities)

    db.upsert_data_account(url, adi_url, auth_json)
    store_authorities(db, url, authorities, adi_authorities)
    log.debug("  Data account: %s", url)


def process_token_issuer(db: Database, api: ApiClient, url: str, adi_url: str,
                         adi_authorities: list[dict]):
    """Query and store a token issuer."""
    result = api.query_account(url)
    if not result:
        log.warning("Could not query token issuer: %s", url)
        return

    acct = result.get("account", {})
    authorities = extract_authorities(result)
    auth_json = authorities_to_json(authorities) if authorities else authorities_to_json(adi_authorities)

    db.upsert_token_issuer(
        url=url,
        adi_url=adi_url,
        symbol=acct.get("symbol", ""),
        precision=acct.get("precision", 0),
        issued=str(acct.get("issued", "0")),
        supply_limit=str(acct.get("supplyLimit", "0")),
        authorities_json=auth_json,
    )
    store_authorities(db, url, authorities, adi_authorities)
    log.debug("  Token issuer: %s symbol=%s", url, acct.get("symbol"))


def process_key_book(db: Database, api: ApiClient, url: str, adi_url: str):
    """Query a key book and discover its key pages."""
    result = api.query_account(url)
    if not result:
        log.warning("Could not query key book: %s", url)
        return

    acct = result.get("account", {})
    page_count = acct.get("pageCount", 0)
    authorities = extract_authorities(result)
    auth_json = authorities_to_json(authorities)

    db.upsert_key_book(url, adi_url, page_count, auth_json)
    store_authorities(db, url, authorities)

    # Discover key pages from the key book's directory
    directory = result.get("directory", {})
    page_urls = [r.get("value") for r in directory.get("records", []) if r.get("value")]

    # If directory wasn't included in query response, fetch it separately
    if not page_urls and page_count > 0:
        page_urls = api.query_directory_all(url)

    for page_url in page_urls:
        db.upsert_key_page(page_url, url, adi_url, crawl_status="pending")
        log.debug("    Key page discovered: %s", page_url)

    log.debug("  Key book: %s pages=%d", url, page_count)


def classify_account(result: dict) -> str:
    """Classify an account by its type field."""
    acct = result.get("account", {})
    acct_type = acct.get("type", "unknown")
    return ACCOUNT_TYPES.get(acct_type, acct_type)


def crawl_adi(db: Database, api: ApiClient, adi_url: str, parent_url: str | None = None,
              parent_authorities: list[dict] | None = None):
    """Crawl a single ADI's directory and process all entries."""
    log.info("Crawling ADI: %s", adi_url)

    # Query the ADI itself to get its authorities
    adi_result = api.query_account(adi_url)
    if not adi_result:
        db.mark_adi_error(adi_url, "Failed to query ADI account")
        return

    adi_type = classify_account(adi_result)
    if adi_type != "adi":
        log.warning("URL %s is type '%s', not an identity — skipping", adi_url, adi_type)
        db.mark_adi_error(adi_url, f"Not an identity: type={adi_type}")
        return

    adi_authorities = extract_authorities(adi_result)

    # If the ADI has no explicit authorities, inherit from parent (implied)
    effective_authorities = adi_authorities if adi_authorities else (parent_authorities or [])
    is_implied = not adi_authorities and bool(parent_authorities)

    auth_json = authorities_to_json(effective_authorities)

    # Get full directory listing
    dir_entries = api.query_directory_all(adi_url)
    entry_count = len(dir_entries)

    db.upsert_adi(adi_url, parent_url, auth_json, entry_count, crawl_status="done")
    if is_implied:
        store_authorities(db, adi_url, [], effective_authorities)
    else:
        store_authorities(db, adi_url, adi_authorities)

    # Process each directory entry
    sub_adis = []
    for entry_url in dir_entries:
        result = api.query_account(entry_url)
        if not result:
            log.warning("Could not query directory entry: %s", entry_url)
            continue

        entry_type = classify_account(result)

        if entry_type == "token_account":
            process_token_account(db, api, entry_url, adi_url, effective_authorities)
        elif entry_type == "data_account":
            process_data_account(db, api, entry_url, adi_url, effective_authorities)
        elif entry_type == "token_issuer":
            process_token_issuer(db, api, entry_url, adi_url, effective_authorities)
        elif entry_type == "key_book":
            process_key_book(db, api, entry_url, adi_url)
        elif entry_type == "adi":
            # Sub-ADI — queue for recursive processing
            sub_adis.append(entry_url)
            db.ensure_adi_pending(entry_url, parent_url=adi_url)
            log.info("  Sub-ADI discovered: %s", entry_url)
        elif entry_type == "key_page":
            # Key pages found directly in ADI directory (unusual but possible)
            acct = result.get("account", {})
            key_book = acct.get("keyBook", "")
            db.upsert_key_page(entry_url, key_book, adi_url, crawl_status="pending")
        else:
            log.info("  Unknown account type '%s' for: %s", entry_type, entry_url)

    db.commit()

    # Recursively crawl sub-ADIs, passing effective authorities for inheritance
    for sub_adi_url in sub_adis:
        crawl_adi(db, api, sub_adi_url, parent_url=adi_url,
                  parent_authorities=effective_authorities)


def load_seed_adis(source_db_path: str) -> list[tuple[str, str | None]]:
    """Load ADI URLs from the source identities.db.

    Returns list of (url, parent_url) tuples. Sub-ADIs have their parent
    inferred from the URL structure.
    """
    conn = sqlite3.connect(source_db_path)
    rows = conn.execute("SELECT identity_url FROM identities ORDER BY identity_url").fetchall()
    conn.close()

    results = []
    for (url,) in rows:
        parsed = urlparse(url)
        path = parsed.path.strip("/")
        if not path:
            # Root ADI — no parent
            results.append((url, None))
        else:
            # Sub-ADI — parent is the root identity (scheme://authority)
            parent = f"{parsed.scheme}://{parsed.netloc}"
            results.append((url, parent))
    return results


def run_phase1(db: Database, api: ApiClient, source_db_path: str, resume: bool = True):
    """Run Phase 1: crawl all ADIs from source database."""
    log.info("=== Phase 1: ADI Directory Crawler ===")

    # Load seed ADIs if not resuming or if no ADIs exist yet
    existing_count = db.conn.execute("SELECT COUNT(*) FROM adis").fetchone()[0]
    if not resume or existing_count == 0:
        seed_adis = load_seed_adis(source_db_path)
        log.info("Loaded %d seed ADIs from source database (%d root, %d sub-ADIs)",
                 len(seed_adis),
                 sum(1 for _, p in seed_adis if p is None),
                 sum(1 for _, p in seed_adis if p is not None))
        # Insert roots first, then sub-ADIs (to satisfy foreign key on parent_url)
        roots = [(u, p) for u, p in seed_adis if p is None]
        subs = [(u, p) for u, p in seed_adis if p is not None]
        for adi_url, parent_url in roots:
            db.ensure_adi_pending(adi_url, parent_url=None)
        db.commit()
        for adi_url, parent_url in subs:
            # Ensure parent exists (it may not be in seed list if crawler missed it)
            db.ensure_adi_pending(parent_url, parent_url=None)
            db.ensure_adi_pending(adi_url, parent_url=parent_url)
        db.commit()

    # Process all pending ADIs (includes newly discovered sub-ADIs)
    iteration = 0
    while True:
        pending = db.get_pending_adis()
        if not pending:
            break

        iteration += 1
        log.info("Phase 1 iteration %d: %d pending ADIs", iteration, len(pending))

        for i, adi_url in enumerate(pending):
            try:
                # Look up parent authorities for sub-ADIs (for implied authority propagation)
                parent_row = db.conn.execute(
                    "SELECT parent_url, authorities_json FROM adis WHERE url = ?", (adi_url,)
                ).fetchone()
                parent_url = parent_row["parent_url"] if parent_row else None
                parent_auths = None
                if parent_url:
                    parent_adi = db.conn.execute(
                        "SELECT authorities_json FROM adis WHERE url = ?", (parent_url,)
                    ).fetchone()
                    if parent_adi and parent_adi["authorities_json"]:
                        import json as _json
                        parent_auths = _json.loads(parent_adi["authorities_json"])

                crawl_adi(db, api, adi_url, parent_url=parent_url,
                          parent_authorities=parent_auths)
            except Exception as e:
                log.error("Error crawling ADI %s: %s", adi_url, e)
                try:
                    db.mark_adi_error(adi_url, str(e))
                    db.commit()
                except Exception as db_err:
                    log.error("Failed to record error for %s: %s", adi_url, db_err)

            if (i + 1) % 10 == 0:
                stats = db.get_stats()
                log.info(
                    "  Progress: %d/%d ADIs | DB: %d ADIs, %d token_accts, "
                    "%d data_accts, %d issuers, %d key_books, %d key_pages",
                    i + 1, len(pending),
                    stats["adis"], stats["token_accounts"],
                    stats["data_accounts"], stats["token_issuers"],
                    stats["key_books"], stats["key_pages"],
                )

    stats = db.get_stats()
    log.info(
        "Phase 1 complete. Totals: %d ADIs, %d token accounts, %d data accounts, "
        "%d token issuers, %d key books, %d key pages discovered",
        stats["adis"], stats["token_accounts"], stats["data_accounts"],
        stats["token_issuers"], stats["key_books"], stats["key_pages"],
    )
    log.info("API requests made: %d", api.request_count)
