"""Key book, key page, and key entry endpoints."""

from fastapi import APIRouter, Query
from typing import Optional
from ..database import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/api", tags=["keys"])


@router.get("/key-books")
def list_key_books(
    adi_url: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        conditions = []
        params = []
        if adi_url:
            conditions.append("adi_url = ?")
            params.append(adi_url)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM key_books {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM key_books {where} ORDER BY url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

    return {"items": rows_to_list(rows), "total": total, "page": page, "per_page": per_page}


@router.get("/key-books/{url:path}")
def get_key_book(url: str):
    if not url.startswith("acc://"):
        url = "acc://" + url
    with get_db() as conn:
        row = conn.execute("SELECT * FROM key_books WHERE url = ?", (url,)).fetchone()
        if not row:
            return {"error": "Key book not found"}
        book = row_to_dict(row)

        pages = []
        for page_row in conn.execute(
            "SELECT * FROM key_pages WHERE key_book_url = ? ORDER BY url", (url,)
        ).fetchall():
            page = row_to_dict(page_row)
            page["keys"] = [
                dict(r) for r in conn.execute(
                    "SELECT * FROM key_entries WHERE key_page_url = ?", (page["url"],)
                ).fetchall()
            ]
            pages.append(page)
        book["pages"] = pages

        book["authorities"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM account_authorities WHERE account_url = ?", (url,)
            ).fetchall()
        ]
    return book


@router.get("/key-pages")
def list_key_pages(
    key_book_url: Optional[str] = None,
    adi_url: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        conditions = []
        params = []
        if key_book_url:
            conditions.append("key_book_url = ?")
            params.append(key_book_url)
        if adi_url:
            conditions.append("adi_url = ?")
            params.append(adi_url)

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM key_pages {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM key_pages {where} ORDER BY url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

        result = []
        for r in rows:
            p = row_to_dict(r)
            p["keys"] = [
                dict(k) for k in conn.execute(
                    "SELECT * FROM key_entries WHERE key_page_url = ?", (p["url"],)
                ).fetchall()
            ]
            result.append(p)

    return {"items": result, "total": total, "page": page, "per_page": per_page}


@router.get("/key-pages/{url:path}")
def get_key_page(url: str):
    if not url.startswith("acc://"):
        url = "acc://" + url
    with get_db() as conn:
        row = conn.execute("SELECT * FROM key_pages WHERE url = ?", (url,)).fetchone()
        if not row:
            return {"error": "Key page not found"}
        page = row_to_dict(row)
        page["keys"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM key_entries WHERE key_page_url = ?", (url,)
            ).fetchall()
        ]
    return page
