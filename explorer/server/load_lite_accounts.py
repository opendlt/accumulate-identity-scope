"""ETL: load Accumulate lite accounts (and DN system accounts) from the genesis
snapshot into the explorer database.

The genesis snapshot already contains all 177,047 genesis accounts, but the
original extraction kept only ADI roots — dropping ~127k lite accounts (lite
identities, lite token accounts, lite data accounts). This loader classifies
every account by URL shape and populates two typed tables the explorer can serve:

  lite_accounts(url, account_type, key_hash, token_url, lite_identity, source, first_seen_block)
  system_accounts(url, category, source)

Idempotent: re-running refreshes the tables. Run after a new genesis snapshot, or
once to backfill the shipped DB:

    python -m server.load_lite_accounts
    python -m server.load_lite_accounts --db /path/to/identity_tree_complete.db --genesis /path/to/genesis_accounts.json
"""

import argparse
import glob
import json
import os
import re
import sqlite3

from .database import DB_PATH

_PREFIX = "acc://"
_HEX_HOST = re.compile(r"^[0-9a-fA-F]{40,}$")
# Default location of the genesis snapshot artifacts (sibling project).
_DEFAULT_GENESIS_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
    "genesis_snapshot_mainnet",
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS lite_accounts (
    url             TEXT PRIMARY KEY,
    account_type    TEXT NOT NULL,
    key_hash        TEXT,
    token_url       TEXT,
    lite_identity   TEXT,
    source          TEXT DEFAULT 'genesis',
    first_seen_block INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_lite_type ON lite_accounts(account_type);
CREATE INDEX IF NOT EXISTS idx_lite_lid  ON lite_accounts(lite_identity);
CREATE INDEX IF NOT EXISTS idx_lite_token ON lite_accounts(token_url);

CREATE TABLE IF NOT EXISTS system_accounts (
    url      TEXT PRIMARY KEY,
    category TEXT,
    source   TEXT DEFAULT 'genesis'
);
"""


def classify(url: str):
    """Classify a genesis account URL by shape.

    Returns ('lite', dict) for lite accounts, ('system', category) for DN system/
    staking/governance accounts, or (None, None) for named ADIs (already in the
    explorer) and malformed entries.
    """
    if not url.startswith(_PREFIX):
        return None, None
    rest = url[len(_PREFIX):]
    parts = rest.split("/", 1)
    host = parts[0]
    path = parts[1] if len(parts) > 1 else ""

    if _HEX_HOST.match(host):
        lid = _PREFIX + host
        if path:
            # lite token account: path is the token issuer URL (e.g. ACME).
            return "lite", {
                "url": url,
                "account_type": "lite_token_account",
                "key_hash": host,
                "token_url": _PREFIX + path,
                "lite_identity": lid,
            }
        # bare lite address: lite identity (some are lite data accounts —
        # indistinguishable by URL alone; the genesis .snap disambiguates).
        return "lite", {
            "url": url,
            "account_type": "lite_identity",
            "key_hash": host,
            "token_url": None,
            "lite_identity": lid,
        }

    if host == "ACME":
        return "system", "system"
    if host == "dn.acme":
        return "system", "governance"
    if host == "staking.acme":
        return "system", "staking"
    return None, None


def _newest_genesis_json(genesis_dir: str) -> str | None:
    candidates = sorted(glob.glob(os.path.join(genesis_dir, "genesis_accounts_*.json")))
    return candidates[-1] if candidates else None


def load(db_path: str, genesis_path: str) -> dict:
    with open(genesis_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    accounts = data.get("all_genesis_accounts") or data.get("cyclops_user_accounts") or []

    lite_rows = []
    system_rows = []
    skipped = 0
    for url in accounts:
        kind, payload = classify(url)
        if kind == "lite":
            lite_rows.append(payload)
        elif kind == "system":
            system_rows.append((url, payload, "genesis"))
        else:
            skipped += 1

    # Belt-and-suspenders: DN system/staking lists are also enumerated explicitly.
    for url in data.get("dn_system_accounts", []):
        _, cat = classify(url)
        system_rows.append((url, cat or "system", "genesis"))
    for url in data.get("dn_staking_accounts", []):
        system_rows.append((url, "staking", "genesis"))

    conn = sqlite3.connect(db_path)
    try:
        conn.executescript(SCHEMA)
        # Upsert genesis CLASSIFICATION only — never touch enrichment columns
        # (balance/credits/enriched_at). Re-loading genesis must be safe to run
        # after the enrichment pass (INSERT OR REPLACE used to wipe balances).
        conn.executemany(
            """INSERT INTO lite_accounts
               (url, account_type, key_hash, token_url, lite_identity, source, first_seen_block)
               VALUES (:url, :account_type, :key_hash, :token_url, :lite_identity, 'genesis', 1)
               ON CONFLICT(url) DO UPDATE SET
                   account_type = excluded.account_type,
                   key_hash     = excluded.key_hash,
                   token_url    = COALESCE(excluded.token_url, lite_accounts.token_url),
                   lite_identity = excluded.lite_identity""",
            lite_rows,
        )
        conn.executemany(
            "INSERT OR IGNORE INTO system_accounts (url, category, source) VALUES (?, ?, ?)",
            {(u, c, s) for (u, c, s) in system_rows},  # de-dupe
        )
        # Invalidate the FTS index so it is rebuilt (now including lite accounts)
        # on the next server startup / migrate run.
        conn.execute("DROP TABLE IF EXISTS search_index")
        conn.commit()
        by_type = {
            r[0]: r[1] for r in conn.execute(
                "SELECT account_type, COUNT(*) FROM lite_accounts GROUP BY account_type"
            )
        }
        sys_total = conn.execute("SELECT COUNT(*) FROM system_accounts").fetchone()[0]
    finally:
        conn.close()

    return {
        "genesis_file": os.path.basename(genesis_path),
        "lite_loaded": len(lite_rows),
        "lite_by_type": by_type,
        "system_loaded": sys_total,
        "skipped_named_adis": skipped,
    }


def main():
    ap = argparse.ArgumentParser(description="Load genesis lite/system accounts into the explorer DB.")
    ap.add_argument("--db", default=DB_PATH, help="explorer SQLite DB path")
    ap.add_argument("--genesis", default=None, help="genesis_accounts_*.json (default: newest in genesis_snapshot_mainnet)")
    args = ap.parse_args()

    genesis_path = args.genesis or _newest_genesis_json(_DEFAULT_GENESIS_DIR)
    if not genesis_path or not os.path.isfile(genesis_path):
        raise SystemExit(f"genesis snapshot JSON not found (looked in {_DEFAULT_GENESIS_DIR}); pass --genesis")

    print(f"Loading lite/system accounts from {genesis_path}\n  into {args.db}")
    status = load(args.db, genesis_path)
    print(f"  lite accounts loaded: {status['lite_loaded']:,}  {status['lite_by_type']}")
    print(f"  system accounts loaded: {status['system_loaded']}")
    print(f"  skipped (named ADIs / other): {status['skipped_named_adis']:,}")
    print("  done.")


if __name__ == "__main__":
    main()
