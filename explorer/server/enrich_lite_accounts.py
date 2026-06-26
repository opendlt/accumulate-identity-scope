"""D1.2 — Enrich lite accounts with live on-chain state (type + balance + credits).

The genesis snapshot gives lite-account URLs and key hashes but no balances. This
queries each lite account against the Accumulate v3 API and records its confirmed
type, token balance, and (for lite identities) credit balance — so the explorer
shows real holdings, not just URLs.

Resumable (skips already-enriched rows), rate-limited, and safe to re-run. Note:
this reflects CURRENT state (a genesis-faithful balance requires parsing the state
snapshot — see DATA_REVIEW Phase 1 D1.1).

    python -m server.enrich_lite_accounts --type lite_token_account --rate 10
    python -m server.enrich_lite_accounts --limit 500          # quick verification batch
    python -m server.enrich_lite_accounts                      # all unenriched lite accounts
"""

import argparse
import time
import sqlite3

from accumulate_client.v3.client import AccumulateV3Client

from .database import DB_PATH

DEFAULT_ENDPOINT = "https://mainnet.accumulatenetwork.io/v3"

_EXTRA_COLUMNS = {
    "confirmed_type": "TEXT",
    "balance": "INTEGER",
    "credits": "INTEGER",
    "enriched_at": "TEXT",
    "enrich_status": "TEXT",
}


def _ensure_columns(conn: sqlite3.Connection):
    existing = {r[1] for r in conn.execute("PRAGMA table_info(lite_accounts)")}
    for col, decl in _EXTRA_COLUMNS.items():
        if col not in existing:
            conn.execute(f"ALTER TABLE lite_accounts ADD COLUMN {col} {decl}")
    conn.commit()


def _account_from(result: dict) -> dict:
    """Extract the account record from a v3 query result."""
    if not isinstance(result, dict):
        return {}
    return result.get("account", result)


def enrich(db_path: str, endpoint: str, type_filter: str | None, limit: int | None, rate: float):
    conn = sqlite3.connect(db_path)
    _ensure_columns(conn)

    where = "WHERE enriched_at IS NULL"
    params: list = []
    if type_filter:
        where += " AND account_type = ?"
        params.append(type_filter)
    sql = f"SELECT url, token_url FROM lite_accounts {where} ORDER BY account_type, url"
    if limit:
        sql += f" LIMIT {int(limit)}"
    todo = conn.execute(sql, params).fetchall()
    total = len(todo)
    print(f"Enriching {total:,} lite accounts from {endpoint} (rate={rate}/s)")

    client = AccumulateV3Client(endpoint)
    delay = 1.0 / rate if rate > 0 else 0.0
    done = ok = errors = 0
    batch = []
    for url, _token in todo:
        ctype = bal = credits = status = None
        try:
            acct = _account_from(client.query(url))
            if not acct:
                status = "not_found"
            else:
                ctype = acct.get("type")
                b = acct.get("balance")
                bal = int(b) if b is not None else None
                cb = acct.get("creditBalance")
                credits = int(cb) if cb is not None else None
                status = "ok"
                ok += 1
        except Exception as exc:  # network / timeout / not-found error
            msg = type(exc).__name__
            status = "not_found" if "not found" in str(exc).lower() else f"exc:{msg}"
            errors += 1
        batch.append((ctype, bal, credits, status, url))
        done += 1
        if len(batch) >= 100:
            conn.executemany(
                "UPDATE lite_accounts SET confirmed_type=?, balance=?, credits=?, "
                "enrich_status=?, enriched_at=datetime('now') WHERE url=?", batch)
            conn.commit(); batch.clear()
            print(f"  {done:,}/{total:,}  ok={ok} err={errors}", flush=True)
        if delay:
            time.sleep(delay)

    if batch:
        conn.executemany(
            "UPDATE lite_accounts SET confirmed_type=?, balance=?, credits=?, "
            "enrich_status=?, enriched_at=datetime('now') WHERE url=?", batch)
        conn.commit()
    conn.close()
    try:
        client.close()
    except Exception:
        pass
    print(f"Done. enriched={done:,} ok={ok} errors={errors}")
    return {"enriched": done, "ok": ok, "errors": errors}


def main():
    ap = argparse.ArgumentParser(description="Enrich lite accounts with live balances.")
    ap.add_argument("--db", default=DB_PATH)
    ap.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    ap.add_argument("--type", dest="type_filter", default=None,
                    help="restrict to one account_type (e.g. lite_token_account)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--rate", type=float, default=10.0, help="requests per second")
    args = ap.parse_args()
    enrich(args.db, args.endpoint, args.type_filter, args.limit, args.rate)


if __name__ == "__main__":
    main()
