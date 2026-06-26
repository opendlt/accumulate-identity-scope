"""Global search endpoint."""

from fastapi import APIRouter, Query
from ..database import get_db, rows_to_list, search_index_available

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_RESULTS_PER_TYPE = 20

# kind -> (table, extra LIKE columns for the fallback path)
_KINDS = [
    ("adi", "adis", []),
    ("token_account", "token_accounts", []),
    ("data_account", "data_accounts", []),
    ("key_book", "key_books", []),
    ("token_issuer", "token_issuers", ["symbol"]),
    ("lite_account", "lite_accounts", []),
]
_RESULT_KEY = {
    "adi": "adis",
    "token_account": "token_accounts",
    "data_account": "data_accounts",
    "key_book": "key_books",
    "token_issuer": "token_issuers",
    "lite_account": "lite_accounts",
}


def _fts_search(conn, q: str) -> dict:
    """Substring search via the FTS5 trigram index (case-insensitive)."""
    # Quote the term as an FTS5 string literal so URL punctuation isn't parsed
    # as query syntax; trigram then matches it as a substring.
    term = '"' + q.replace('"', '""') + '"'
    out = {}
    for kind, table, _ in _KINDS:
        urls = [
            r["url"] for r in conn.execute(
                "SELECT url FROM search_index WHERE search_index MATCH ? AND kind = ? "
                "ORDER BY url LIMIT ?",
                (term, kind, MAX_RESULTS_PER_TYPE),
            ).fetchall()
        ]
        if urls:
            placeholders = ",".join("?" * len(urls))
            rows = conn.execute(
                f"SELECT * FROM {table} WHERE url IN ({placeholders}) ORDER BY url", urls
            ).fetchall()
        else:
            rows = []
        out[_RESULT_KEY[kind]] = rows_to_list(rows)
    return out


def _like_search(conn, q: str) -> dict:
    """Fallback substring search for short queries (trigram needs >= 3 chars)."""
    pattern = f"%{q}%"
    out = {}
    for kind, table, extra_cols in _KINDS:
        cols = ["url"] + extra_cols
        where = " OR ".join(f"{c} LIKE ?" for c in cols)
        params = [pattern] * len(cols) + [MAX_RESULTS_PER_TYPE]
        rows = conn.execute(
            f"SELECT * FROM {table} WHERE {where} ORDER BY url LIMIT ?", params
        ).fetchall()
        out[_RESULT_KEY[kind]] = rows_to_list(rows)
    return out


@router.get("")
def search(q: str = Query(..., min_length=1)):
    q = q.strip()
    with get_db() as conn:
        # Trigram FTS requires at least 3 characters; shorter queries (and any
        # environment without the FTS index) fall back to LIKE.
        if len(q) >= 3 and search_index_available():
            results = _fts_search(conn, q)
        else:
            results = _like_search(conn, q)

    total = sum(len(v) for v in results.values())
    return {"query": q, "total": total, **results}
