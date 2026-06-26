"""Read-only SQLite database access for the explorer API.

Connections are pooled per worker thread (FastAPI runs sync endpoints in a
threadpool), so each thread reuses one long-lived read-only handle instead of
opening/closing a connection per request. Read tuning pragmas are applied once
per connection. A one-time ``ensure_schema()`` migration adds the indexes and
the denormalized ``account_authorities.adi_url`` column that the heavy
analytics endpoints rely on.
"""

import sqlite3
import json
import os
import threading
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "EXPLORER_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "identity_tree_complete.db"),
)

_URL_PREFIX = "acc://"

# Per-thread read-only connection pool.
_local = threading.local()


def _configure(conn: sqlite3.Connection) -> sqlite3.Connection:
    conn.row_factory = sqlite3.Row
    # Read tuning — applied once per connection, not per request.
    conn.execute("PRAGMA query_only=1")
    conn.execute("PRAGMA cache_size=-16000")     # ~16 MB page cache
    conn.execute("PRAGMA mmap_size=268435456")   # 256 MB memory-mapped I/O
    conn.execute("PRAGMA temp_store=MEMORY")
    return conn


def get_connection() -> sqlite3.Connection:
    """Return this thread's long-lived read-only connection, opening it lazily."""
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
        _configure(conn)
        _local.conn = conn
    return conn


@contextmanager
def get_db():
    # Yields the pooled read-only connection; intentionally does NOT close it,
    # so it is reused for the lifetime of the worker thread.
    yield get_connection()


# ---------------------------------------------------------------------------
# Schema migration (idempotent, run once at startup)
# ---------------------------------------------------------------------------

_MISSING_INDEXES = [
    ("idx_key_entries_hash", "key_entries", "public_key_hash"),
    ("idx_key_entries_delegate", "key_entries", "delegate"),
    ("idx_key_pages_adi", "key_pages", "adi_url"),
    ("idx_token_accounts_token", "token_accounts", "token_url"),
]


def _owner_adi(account_url: str, adis: set[str]) -> str:
    """Resolve the ADI that owns an account URL (longest registered ADI prefix).

    ``acc://foo.acme/tokens`` -> ``acc://foo.acme``. Falls back to the first path
    segment when no registered ADI prefix matches (a handful of un-crawled ADIs).
    """
    if account_url in adis:
        return account_url
    if not account_url.startswith(_URL_PREFIX):
        return account_url
    parts = account_url[len(_URL_PREFIX):].split("/")
    for i in range(len(parts) - 1, 0, -1):
        cand = _URL_PREFIX + "/".join(parts[:i])
        if cand in adis:
            return cand
    return _URL_PREFIX + parts[0]


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(r[1] == column for r in conn.execute(f"PRAGMA table_info({table})"))


def ensure_schema() -> dict:
    """Apply read-side schema improvements to the database file (idempotent).

    Adds missing indexes and the denormalized ``account_authorities.adi_url``
    column. Requires write access; if the DB is read-only/unwritable the
    migration is skipped with a warning and the API still serves (assuming a
    previously-migrated file). Returns a small status dict for logging.
    """
    status = {"indexes_created": [], "adi_url_added": False, "skipped": None}
    try:
        conn = sqlite3.connect(DB_PATH)
    except sqlite3.Error as exc:  # pragma: no cover - environment dependent
        status["skipped"] = f"connect failed: {exc}"
        return status

    try:
        # 1) Missing indexes used by the hottest endpoints.
        for name, table, column in _MISSING_INDEXES:
            before = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (name,)
            ).fetchone()
            conn.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({column})")
            if not before:
                status["indexes_created"].append(name)

        # 2) Denormalize the owning ADI onto account_authorities to replace the
        #    expensive `LIKE adi_url || '/%'` joins with equality joins.
        if not _has_column(conn, "account_authorities", "adi_url"):
            conn.execute("ALTER TABLE account_authorities ADD COLUMN adi_url TEXT")
            status["adi_url_added"] = True

        # Populate any rows whose adi_url is not yet set (covers a fresh column
        # and any rows inserted by a later crawl).
        missing = conn.execute(
            "SELECT COUNT(*) FROM account_authorities WHERE adi_url IS NULL"
        ).fetchone()[0]
        if missing:
            adis = {row[0] for row in conn.execute("SELECT url FROM adis")}
            updates = [
                (_owner_adi(acc, adis), acc)
                for (acc,) in conn.execute(
                    "SELECT DISTINCT account_url FROM account_authorities WHERE adi_url IS NULL"
                )
            ]
            conn.executemany(
                "UPDATE account_authorities SET adi_url=? WHERE account_url=? AND adi_url IS NULL",
                updates,
            )
            status["adi_url_populated"] = len(updates)

        conn.execute("CREATE INDEX IF NOT EXISTS idx_authorities_adi ON account_authorities(adi_url)")

        # 2b) Lite / system account tables (populated by load_lite_accounts.py from
        #     the genesis snapshot). Created empty here so the API works even before
        #     the ETL runs.
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS lite_accounts (
                url TEXT PRIMARY KEY, account_type TEXT NOT NULL, key_hash TEXT,
                token_url TEXT, lite_identity TEXT, source TEXT DEFAULT 'genesis',
                first_seen_block INTEGER DEFAULT 1
            );
            CREATE INDEX IF NOT EXISTS idx_lite_type ON lite_accounts(account_type);
            CREATE INDEX IF NOT EXISTS idx_lite_lid  ON lite_accounts(lite_identity);
            CREATE INDEX IF NOT EXISTS idx_lite_token ON lite_accounts(token_url);
            CREATE TABLE IF NOT EXISTS system_accounts (
                url TEXT PRIMARY KEY, category TEXT, source TEXT DEFAULT 'genesis'
            );
        """)

        # 3) Full-text search index (FTS5 trigram) for substring URL/symbol search,
        #    replacing per-keystroke `LIKE '%q%'` full scans across five tables.
        #    Trigram supports case-insensitive substring matching. Built only when
        #    absent; re-run migrate.py after a re-crawl to refresh it.
        status["fts"] = _build_search_index(conn)

        conn.commit()
        try:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except sqlite3.Error:
            pass
    except sqlite3.OperationalError as exc:
        # Typically a read-only/locked file in a constrained deployment.
        status["skipped"] = f"migration skipped (db not writable): {exc}"
    finally:
        conn.close()

    return status


def _build_search_index(conn: sqlite3.Connection) -> str:
    """(Re)build the FTS5 trigram search index. Returns a short status string."""
    exists = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_index'"
    ).fetchone()
    if exists:
        return "present"
    try:
        conn.execute(
            "CREATE VIRTUAL TABLE search_index USING fts5("
            "url, kind UNINDEXED, symbol, tokenize='trigram')"
        )
    except sqlite3.OperationalError as exc:
        return f"unavailable ({exc})"
    conn.executescript(
        """
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'adi', '' FROM adis;
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'token_account', '' FROM token_accounts;
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'data_account', '' FROM data_accounts;
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'key_book', '' FROM key_books;
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'token_issuer', COALESCE(symbol, '') FROM token_issuers;
        INSERT INTO search_index(url, kind, symbol) SELECT url, 'lite_account', '' FROM lite_accounts;
        """
    )
    return "built"


def search_index_available() -> bool:
    conn = get_connection()
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_index'"
    ).fetchone() is not None


def table_columns(table: str) -> set[str]:
    """Return the set of real column names for a table (used to whitelist sorts)."""
    conn = get_connection()
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}


def row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    # Parse JSON fields
    for key in ("authorities_json",):
        if key in d and d[key]:
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    return d


def rows_to_list(rows: list[sqlite3.Row]) -> list[dict]:
    return [row_to_dict(r) for r in rows]
