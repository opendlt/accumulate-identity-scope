"""ETL: flow the crawler's discoveries into the live explorer database.

The blocks-2→present crawler (`accumulate_adi_crawler`) records every account it
sees a transaction touch — including post-genesis LITE accounts and new ADIs /
sub-accounts — into a typed `accounts` table with current state (Phase 2/3). This
maps that table onto the explorer's schema so the Scope reflects post-genesis
discoveries automatically, the same one-step pattern as the genesis loader.

Idempotent: re-running upserts. Invalidates the FTS index so new accounts become
searchable on the next server start.

    python -m server.sync_from_crawler --crawler-db ../../accumulate_adi_crawler/identities.db
"""

import argparse
import json
import os
import sqlite3

from .database import DB_PATH

DEFAULT_CRAWLER_DB = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "accumulate_adi_crawler", "identities.db",
)


def _owning_adi(url: str) -> str | None:
    """Top ADI of an account URL: acc://foo.acme/book/1 -> acc://foo.acme."""
    if not url.startswith("acc://"):
        return None
    host = url[len("acc://"):].split("/", 1)[0]
    return f"acc://{host}" if host.endswith(".acme") else None


def _key_hash(url: str) -> str:
    return url[len("acc://"):].split("/", 1)[0]


def _parent_path(url: str) -> str:
    return url.rsplit("/", 1)[0]


def sync(crawler_db: str, explorer_db: str) -> dict:
    src = sqlite3.connect(crawler_db)
    src.row_factory = sqlite3.Row
    if "accounts" not in {r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type='table'")}:
        src.close()
        return {"error": "crawler DB has no accounts table (run the Phase 2/3 crawler first)"}

    dst = sqlite3.connect(explorer_db)
    counts = {k: 0 for k in ("lite", "adis", "token_accounts", "data_accounts",
                             "key_books", "key_pages", "token_issuers", "authorities")}

    rows = src.execute("SELECT * FROM accounts").fetchall()
    for a in rows:
        url = a["url"]
        cat = a["account_type"]
        ctype = (a["confirmed_type"] if "confirmed_type" in a.keys() else None) or ""
        adi = _owning_adi(url)
        auths = a["authorities_json"] if "authorities_json" in a.keys() else None

        if cat in ("lite_identity", "lite_token_account"):
            dst.execute(
                """INSERT INTO lite_accounts (url, account_type, key_hash, token_url, lite_identity,
                       source, first_seen_block, confirmed_type, balance, credits, enriched_at)
                   VALUES (?,?,?,?,?, 'crawl', ?, ?, ?, ?, ?)
                   ON CONFLICT(url) DO UPDATE SET
                       confirmed_type=COALESCE(excluded.confirmed_type, lite_accounts.confirmed_type),
                       balance=COALESCE(excluded.balance, lite_accounts.balance),
                       credits=COALESCE(excluded.credits, lite_accounts.credits),
                       token_url=COALESCE(excluded.token_url, lite_accounts.token_url),
                       enriched_at=COALESCE(excluded.enriched_at, lite_accounts.enriched_at)""",
                (url, cat, _key_hash(url), a["token_url"], f"acc://{_key_hash(url)}",
                 a["first_seen_block"], ctype or None, a["balance"], a["credits"], a["enriched_at"]))
            counts["lite"] += 1

        elif cat == "adi_root" or ctype == "identity":
            parent = _parent_path(url) if "/" in url[len("acc://"):] else None
            counts["adis"] += _ins(dst,
                "INSERT OR IGNORE INTO adis (url, parent_url, authorities_json, entry_count, crawl_status) "
                "VALUES (?,?,?,?, 'done')", (url, parent, auths, None))

        elif ctype == "tokenAccount":
            counts["token_accounts"] += _ins(dst,
                "INSERT OR IGNORE INTO token_accounts (url, adi_url, token_url, authorities_json) VALUES (?,?,?,?)",
                (url, adi, a["token_url"], auths))
        elif ctype == "dataAccount":
            counts["data_accounts"] += _ins(dst,
                "INSERT OR IGNORE INTO data_accounts (url, adi_url, authorities_json) VALUES (?,?,?)",
                (url, adi, auths))
        elif ctype == "keyBook":
            counts["key_books"] += _ins(dst,
                "INSERT OR IGNORE INTO key_books (url, adi_url, page_count, authorities_json) VALUES (?,?,?,?)",
                (url, adi, a["page_count"] if "page_count" in a.keys() else None, auths))
        elif ctype == "keyPage":
            counts["key_pages"] += _ins(dst,
                """INSERT OR IGNORE INTO key_pages (url, key_book_url, adi_url, version, threshold,
                       accept_threshold, credit_balance, crawl_status)
                   VALUES (?,?,?,?,?,?,?, 'done')""",
                (url, _parent_path(url), adi, a["version"], a["threshold"],
                 a["accept_threshold"] if "accept_threshold" in a.keys() else None, a["credits"]))
        elif ctype == "tokenIssuer":
            counts["token_issuers"] += _ins(dst,
                "INSERT OR IGNORE INTO token_issuers (url, adi_url, authorities_json) VALUES (?,?,?)",
                (url, adi, auths))

        # Authorities (idempotent: only insert links not already present)
        if auths:
            try:
                for entry in json.loads(auths):
                    aurl = entry.get("url") if isinstance(entry, dict) else None
                    if not aurl:
                        continue
                    exists = dst.execute(
                        "SELECT 1 FROM account_authorities WHERE account_url=? AND authority_url=?",
                        (url, aurl)).fetchone()
                    if not exists:
                        dst.execute(
                            "INSERT INTO account_authorities (account_url, authority_url, is_implied, disabled, adi_url) "
                            "VALUES (?,?,0,0,?)", (url, aurl, adi))
                        counts["authorities"] += 1
            except (json.JSONDecodeError, TypeError):
                pass

    # Invalidate FTS so new accounts get indexed on next startup.
    dst.execute("DROP TABLE IF EXISTS search_index")
    dst.commit()
    dst.close()
    src.close()
    return counts


def _ins(conn, sql, params) -> int:
    return 1 if conn.execute(sql, params).rowcount > 0 else 0


def main():
    ap = argparse.ArgumentParser(description="Sync crawler discoveries into the explorer DB.")
    ap.add_argument("--crawler-db", default=DEFAULT_CRAWLER_DB)
    ap.add_argument("--db", default=DB_PATH)
    args = ap.parse_args()
    if not os.path.isfile(args.crawler_db):
        raise SystemExit(f"crawler DB not found: {args.crawler_db}")
    print(f"Syncing {args.crawler_db}\n     -> {args.db}")
    result = sync(args.crawler_db, args.db)
    print("  inserted/updated:", result)
    print("  (restart the server to rebuild the search index)")


if __name__ == "__main__":
    main()
