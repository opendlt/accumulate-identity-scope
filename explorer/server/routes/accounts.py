"""Token and data account endpoints."""

from fastapi import APIRouter, Query
from typing import Optional
from ..database import get_db, rows_to_list, row_to_dict

router = APIRouter(prefix="/api", tags=["accounts"])


@router.get("/token-accounts")
def list_token_accounts(
    adi_url: Optional[str] = None,
    token_url: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        conditions = []
        params = []
        if adi_url:
            conditions.append("adi_url = ?")
            params.append(adi_url)
        if token_url:
            conditions.append("token_url = ?")
            params.append(token_url)
        if search:
            conditions.append("url LIKE ?")
            params.append(f"%{search}%")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM token_accounts {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM token_accounts {where} ORDER BY url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

    return {"items": rows_to_list(rows), "total": total, "page": page, "per_page": per_page}


@router.get("/token-accounts/{url:path}")
def get_token_account(url: str):
    if not url.startswith("acc://"):
        url = "acc://" + url
    with get_db() as conn:
        row = conn.execute("SELECT * FROM token_accounts WHERE url = ?", (url,)).fetchone()
        if not row:
            return {"error": "Token account not found"}
        acct = row_to_dict(row)
        acct["authorities"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM account_authorities WHERE account_url = ?", (url,)
            ).fetchall()
        ]
    return acct


@router.get("/data-accounts")
def list_data_accounts(
    adi_url: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        conditions = []
        params = []
        if adi_url:
            conditions.append("adi_url = ?")
            params.append(adi_url)
        if search:
            conditions.append("url LIKE ?")
            params.append(f"%{search}%")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM data_accounts {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM data_accounts {where} ORDER BY url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

    return {"items": rows_to_list(rows), "total": total, "page": page, "per_page": per_page}


@router.get("/token-issuers")
def list_token_issuers():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM token_issuers ORDER BY url").fetchall()
    return rows_to_list(rows)
