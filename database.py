"""Database schema and access for identity tree mapper."""

import sqlite3
import logging

log = logging.getLogger(__name__)

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS adis (
    url             TEXT PRIMARY KEY,
    parent_url      TEXT,
    authorities_json TEXT,
    entry_count     INTEGER,
    crawl_status    TEXT NOT NULL DEFAULT 'pending',
    error_message   TEXT,
    FOREIGN KEY (parent_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS token_accounts (
    url             TEXT PRIMARY KEY,
    adi_url         TEXT NOT NULL,
    token_url       TEXT,
    authorities_json TEXT,
    FOREIGN KEY (adi_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS data_accounts (
    url             TEXT PRIMARY KEY,
    adi_url         TEXT NOT NULL,
    authorities_json TEXT,
    FOREIGN KEY (adi_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS token_issuers (
    url             TEXT PRIMARY KEY,
    adi_url         TEXT NOT NULL,
    symbol          TEXT,
    precision       INTEGER,
    issued          TEXT,
    supply_limit    TEXT,
    authorities_json TEXT,
    FOREIGN KEY (adi_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS key_books (
    url             TEXT PRIMARY KEY,
    adi_url         TEXT NOT NULL,
    page_count      INTEGER,
    authorities_json TEXT,
    FOREIGN KEY (adi_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS key_pages (
    url             TEXT PRIMARY KEY,
    key_book_url    TEXT NOT NULL,
    adi_url         TEXT NOT NULL,
    version         INTEGER,
    threshold       INTEGER,
    accept_threshold INTEGER,
    credit_balance  INTEGER,
    crawl_status    TEXT NOT NULL DEFAULT 'pending',
    FOREIGN KEY (key_book_url) REFERENCES key_books(url),
    FOREIGN KEY (adi_url) REFERENCES adis(url)
);

CREATE TABLE IF NOT EXISTS key_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    key_page_url    TEXT NOT NULL,
    public_key_hash TEXT,
    public_key      TEXT,
    delegate        TEXT,
    last_used_on    INTEGER,
    FOREIGN KEY (key_page_url) REFERENCES key_pages(url)
);

CREATE TABLE IF NOT EXISTS account_authorities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_url     TEXT NOT NULL,
    authority_url   TEXT NOT NULL,
    is_implied      INTEGER NOT NULL DEFAULT 0,
    disabled        INTEGER NOT NULL DEFAULT 0,
    UNIQUE(account_url, authority_url)
);

CREATE TABLE IF NOT EXISTS crawl_progress (
    key             TEXT PRIMARY KEY,
    value           TEXT
);

CREATE INDEX IF NOT EXISTS idx_token_accounts_adi ON token_accounts(adi_url);
CREATE INDEX IF NOT EXISTS idx_data_accounts_adi ON data_accounts(adi_url);
CREATE INDEX IF NOT EXISTS idx_token_issuers_adi ON token_issuers(adi_url);
CREATE INDEX IF NOT EXISTS idx_key_books_adi ON key_books(adi_url);
CREATE INDEX IF NOT EXISTS idx_key_pages_book ON key_pages(key_book_url);
CREATE INDEX IF NOT EXISTS idx_key_entries_page ON key_entries(key_page_url);
CREATE INDEX IF NOT EXISTS idx_authorities_account ON account_authorities(account_url);
CREATE INDEX IF NOT EXISTS idx_authorities_authority ON account_authorities(authority_url);
CREATE INDEX IF NOT EXISTS idx_adis_parent ON adis(parent_url);
"""


class Database:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(db_path, timeout=30)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript(SCHEMA_SQL)
        self.conn.commit()

    def close(self):
        self.conn.close()

    # --- ADI operations ---

    def upsert_adi(self, url: str, parent_url: str | None, authorities_json: str,
                   entry_count: int, crawl_status: str = "done"):
        self.conn.execute(
            """INSERT INTO adis (url, parent_url, authorities_json, entry_count, crawl_status)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 parent_url=excluded.parent_url,
                 authorities_json=excluded.authorities_json,
                 entry_count=excluded.entry_count,
                 crawl_status=excluded.crawl_status""",
            (url, parent_url, authorities_json, entry_count, crawl_status),
        )

    def mark_adi_error(self, url: str, error: str):
        self.conn.execute(
            """INSERT INTO adis (url, crawl_status, error_message)
               VALUES (?, 'error', ?)
               ON CONFLICT(url) DO UPDATE SET crawl_status='error', error_message=?""",
            (url, error, error),
        )

    def get_pending_adis(self) -> list[str]:
        rows = self.conn.execute(
            "SELECT url FROM adis WHERE crawl_status = 'pending' ORDER BY url"
        ).fetchall()
        return [r["url"] for r in rows]

    def adi_exists(self, url: str) -> bool:
        row = self.conn.execute("SELECT 1 FROM adis WHERE url = ?", (url,)).fetchone()
        return row is not None

    def ensure_adi_pending(self, url: str, parent_url: str | None = None):
        if not self.adi_exists(url):
            self.conn.execute(
                "INSERT INTO adis (url, parent_url, crawl_status) VALUES (?, ?, 'pending')",
                (url, parent_url),
            )

    # --- Token account ---

    def upsert_token_account(self, url: str, adi_url: str, token_url: str,
                             authorities_json: str):
        self.conn.execute(
            """INSERT INTO token_accounts (url, adi_url, token_url, authorities_json)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 adi_url=excluded.adi_url, token_url=excluded.token_url,
                 authorities_json=excluded.authorities_json""",
            (url, adi_url, token_url, authorities_json),
        )

    # --- Data account ---

    def upsert_data_account(self, url: str, adi_url: str, authorities_json: str):
        self.conn.execute(
            """INSERT INTO data_accounts (url, adi_url, authorities_json)
               VALUES (?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 adi_url=excluded.adi_url, authorities_json=excluded.authorities_json""",
            (url, adi_url, authorities_json),
        )

    # --- Token issuer ---

    def upsert_token_issuer(self, url: str, adi_url: str, symbol: str,
                            precision: int, issued: str, supply_limit: str,
                            authorities_json: str):
        self.conn.execute(
            """INSERT INTO token_issuers (url, adi_url, symbol, precision, issued,
                 supply_limit, authorities_json)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 adi_url=excluded.adi_url, symbol=excluded.symbol,
                 precision=excluded.precision, issued=excluded.issued,
                 supply_limit=excluded.supply_limit,
                 authorities_json=excluded.authorities_json""",
            (url, adi_url, symbol, precision, issued, supply_limit, authorities_json),
        )

    # --- Key book ---

    def upsert_key_book(self, url: str, adi_url: str, page_count: int,
                        authorities_json: str):
        self.conn.execute(
            """INSERT INTO key_books (url, adi_url, page_count, authorities_json)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 adi_url=excluded.adi_url, page_count=excluded.page_count,
                 authorities_json=excluded.authorities_json""",
            (url, adi_url, page_count, authorities_json),
        )

    # --- Key page ---

    def upsert_key_page(self, url: str, key_book_url: str, adi_url: str,
                        version: int | None = None, threshold: int | None = None,
                        accept_threshold: int | None = None,
                        credit_balance: int | None = None,
                        crawl_status: str = "pending"):
        self.conn.execute(
            """INSERT INTO key_pages (url, key_book_url, adi_url, version, threshold,
                 accept_threshold, credit_balance, crawl_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(url) DO UPDATE SET
                 key_book_url=excluded.key_book_url, adi_url=excluded.adi_url,
                 version=excluded.version, threshold=excluded.threshold,
                 accept_threshold=excluded.accept_threshold,
                 credit_balance=excluded.credit_balance,
                 crawl_status=excluded.crawl_status""",
            (url, key_book_url, adi_url, version, threshold,
             accept_threshold, credit_balance, crawl_status),
        )

    def get_pending_key_pages(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT url, key_book_url, adi_url FROM key_pages WHERE crawl_status = 'pending'"
        ).fetchall()
        return [dict(r) for r in rows]

    # --- Key entries ---

    def insert_key_entry(self, key_page_url: str, public_key_hash: str | None,
                         public_key: str | None, delegate: str | None,
                         last_used_on: int | None):
        self.conn.execute(
            """INSERT INTO key_entries (key_page_url, public_key_hash, public_key,
                 delegate, last_used_on)
               VALUES (?, ?, ?, ?, ?)""",
            (key_page_url, public_key_hash, public_key, delegate, last_used_on),
        )

    def clear_key_entries(self, key_page_url: str):
        self.conn.execute("DELETE FROM key_entries WHERE key_page_url = ?", (key_page_url,))

    # --- Account authorities ---

    def upsert_authority(self, account_url: str, authority_url: str,
                         is_implied: bool = False, disabled: bool = False):
        self.conn.execute(
            """INSERT INTO account_authorities (account_url, authority_url, is_implied, disabled)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(account_url, authority_url) DO UPDATE SET
                 is_implied=excluded.is_implied, disabled=excluded.disabled""",
            (account_url, authority_url, int(is_implied), int(disabled)),
        )

    # --- Progress tracking ---

    def set_progress(self, key: str, value: str):
        self.conn.execute(
            "INSERT INTO crawl_progress (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        self.conn.commit()

    def get_progress(self, key: str) -> str | None:
        row = self.conn.execute(
            "SELECT value FROM crawl_progress WHERE key = ?", (key,)
        ).fetchone()
        return row["value"] if row else None

    def commit(self):
        self.conn.commit()

    # --- Statistics ---

    def get_stats(self) -> dict:
        stats = {}
        for table in ["adis", "token_accounts", "data_accounts", "token_issuers",
                       "key_books", "key_pages", "key_entries", "account_authorities"]:
            row = self.conn.execute(f"SELECT COUNT(*) as cnt FROM {table}").fetchone()
            stats[table] = row["cnt"]

        row = self.conn.execute(
            "SELECT crawl_status, COUNT(*) as cnt FROM adis GROUP BY crawl_status"
        ).fetchall()
        stats["adi_status"] = {r["crawl_status"]: r["cnt"] for r in row}

        row = self.conn.execute(
            "SELECT crawl_status, COUNT(*) as cnt FROM key_pages GROUP BY crawl_status"
        ).fetchall()
        stats["key_page_status"] = {r["crawl_status"]: r["cnt"] for r in row}

        return stats
