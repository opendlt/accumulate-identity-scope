"""Global search endpoint."""

from fastapi import APIRouter, Query
from ..database import get_db, rows_to_list

router = APIRouter(prefix="/api/search", tags=["search"])

MAX_RESULTS_PER_TYPE = 20


@router.get("")
def search(q: str = Query(..., min_length=1)):
    pattern = f"%{q}%"
    with get_db() as conn:
        adis = rows_to_list(conn.execute(
            "SELECT * FROM adis WHERE url LIKE ? ORDER BY url LIMIT ?",
            (pattern, MAX_RESULTS_PER_TYPE),
        ).fetchall())

        token_accounts = rows_to_list(conn.execute(
            "SELECT * FROM token_accounts WHERE url LIKE ? ORDER BY url LIMIT ?",
            (pattern, MAX_RESULTS_PER_TYPE),
        ).fetchall())

        data_accounts = rows_to_list(conn.execute(
            "SELECT * FROM data_accounts WHERE url LIKE ? ORDER BY url LIMIT ?",
            (pattern, MAX_RESULTS_PER_TYPE),
        ).fetchall())

        key_books = rows_to_list(conn.execute(
            "SELECT * FROM key_books WHERE url LIKE ? ORDER BY url LIMIT ?",
            (pattern, MAX_RESULTS_PER_TYPE),
        ).fetchall())

        token_issuers = rows_to_list(conn.execute(
            "SELECT * FROM token_issuers WHERE url LIKE ? OR symbol LIKE ? ORDER BY url LIMIT ?",
            (pattern, pattern, MAX_RESULTS_PER_TYPE),
        ).fetchall())

    total = len(adis) + len(token_accounts) + len(data_accounts) + len(key_books) + len(token_issuers)
    return {
        "query": q,
        "total": total,
        "adis": adis,
        "token_accounts": token_accounts,
        "data_accounts": data_accounts,
        "key_books": key_books,
        "token_issuers": token_issuers,
    }
