"""ADI endpoints."""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional
from ..database import get_db, rows_to_list, row_to_dict
from ..cache import cached

router = APIRouter(prefix="/api/adis", tags=["adis"])


@router.get("")
def list_adis(
    root_only: bool = False,
    parent_url: Optional[str] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        conditions = []
        params = []

        if root_only:
            conditions.append("parent_url IS NULL")
        if parent_url:
            conditions.append("parent_url = ?")
            params.append(parent_url)
        if search:
            conditions.append("url LIKE ?")
            params.append(f"%{search}%")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM adis {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM adis {where} ORDER BY url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

    return {"items": rows_to_list(rows), "total": total, "page": page, "per_page": per_page}


@router.get("/tree")
@cached()
def get_full_tree(root_url: Optional[str] = None, max_depth: int = Query(10, ge=1, le=20)):
    """Get the full ADI tree or a subtree as nested structure."""
    with get_db() as conn:
        if root_url:
            rows = conn.execute("""
                WITH RECURSIVE tree(url, parent_url, authorities_json, entry_count, crawl_status, depth) AS (
                    SELECT url, parent_url, authorities_json, entry_count, crawl_status, 0
                    FROM adis WHERE url = ?
                    UNION ALL
                    SELECT a.url, a.parent_url, a.authorities_json, a.entry_count, a.crawl_status, t.depth+1
                    FROM adis a JOIN tree t ON a.parent_url = t.url
                    WHERE t.depth < ?
                )
                SELECT * FROM tree ORDER BY depth, url
            """, (root_url, max_depth)).fetchall()
        else:
            rows = conn.execute("""
                WITH RECURSIVE tree(url, parent_url, authorities_json, entry_count, crawl_status, depth) AS (
                    SELECT url, parent_url, authorities_json, entry_count, crawl_status, 0
                    FROM adis WHERE parent_url IS NULL
                    UNION ALL
                    SELECT a.url, a.parent_url, a.authorities_json, a.entry_count, a.crawl_status, t.depth+1
                    FROM adis a JOIN tree t ON a.parent_url = t.url
                    WHERE t.depth < ?
                )
                SELECT * FROM tree ORDER BY depth, url
            """, (max_depth,)).fetchall()

        # Build nested tree
        flat = rows_to_list(rows)

        # Add account/book counts per node. Three grouped scans (each keyed by
        # the indexed adi_url column) replace the previous 3-correlated-subquery
        # lookup per node, which was an N+1 over the whole tree.
        token_counts = {r["adi_url"]: r["c"] for r in conn.execute(
            "SELECT adi_url, COUNT(*) c FROM token_accounts GROUP BY adi_url")}
        data_counts = {r["adi_url"]: r["c"] for r in conn.execute(
            "SELECT adi_url, COUNT(*) c FROM data_accounts GROUP BY adi_url")}
        book_counts = {r["adi_url"]: r["c"] for r in conn.execute(
            "SELECT adi_url, COUNT(*) c FROM key_books GROUP BY adi_url")}

        for node in flat:
            url = node["url"]
            node["token_count"] = token_counts.get(url, 0)
            node["data_count"] = data_counts.get(url, 0)
            node["book_count"] = book_counts.get(url, 0)

    return _build_tree(flat)


def _build_tree(flat_nodes: list[dict]) -> list[dict]:
    """Convert flat list with parent_url to nested tree."""
    by_url = {n["url"]: {**n, "children": []} for n in flat_nodes}
    roots = []
    for node in flat_nodes:
        wrapped = by_url[node["url"]]
        parent = node.get("parent_url")
        if parent and parent in by_url:
            by_url[parent]["children"].append(wrapped)
        else:
            roots.append(wrapped)
    return roots


@router.get("/{url:path}")
def get_adi(url: str):
    # Re-add acc:// prefix if stripped by path parsing
    if not url.startswith("acc://"):
        url = "acc://" + url
    with get_db() as conn:
        row = conn.execute("SELECT * FROM adis WHERE url = ?", (url,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"ADI not found: {url}")

        adi = row_to_dict(row)

        adi["children"] = rows_to_list(
            conn.execute("SELECT * FROM adis WHERE parent_url = ? ORDER BY url", (url,)).fetchall()
        )
        adi["token_accounts"] = rows_to_list(
            conn.execute("SELECT * FROM token_accounts WHERE adi_url = ? ORDER BY url", (url,)).fetchall()
        )
        adi["data_accounts"] = rows_to_list(
            conn.execute("SELECT * FROM data_accounts WHERE adi_url = ? ORDER BY url", (url,)).fetchall()
        )
        adi["key_books"] = rows_to_list(
            conn.execute("SELECT * FROM key_books WHERE adi_url = ? ORDER BY url", (url,)).fetchall()
        )
        adi["token_issuers"] = rows_to_list(
            conn.execute("SELECT * FROM token_issuers WHERE adi_url = ? ORDER BY url", (url,)).fetchall()
        )
        adi["authorities"] = [
            dict(r) for r in conn.execute(
                "SELECT * FROM account_authorities WHERE account_url = ?", (url,)
            ).fetchall()
        ]

    return adi
