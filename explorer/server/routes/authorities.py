"""Authority relationship endpoints."""

from fastapi import APIRouter, Query
from typing import Optional
from ..database import get_db

router = APIRouter(prefix="/api/authorities", tags=["authorities"])


@router.get("")
def list_authorities(
    account_url: Optional[str] = None,
    authority_url: Optional[str] = None,
    implied_only: bool = False,
    page: int = Query(1, ge=1),
    per_page: int = Query(100, ge=1, le=1000),
):
    with get_db() as conn:
        conditions = []
        params = []
        if account_url:
            conditions.append("account_url = ?")
            params.append(account_url)
        if authority_url:
            conditions.append("authority_url = ?")
            params.append(authority_url)
        if implied_only:
            conditions.append("is_implied = 1")

        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        total = conn.execute(f"SELECT COUNT(*) FROM account_authorities {where}", params).fetchone()[0]

        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT * FROM account_authorities {where} ORDER BY account_url, authority_url LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()

    return {"items": [dict(r) for r in rows], "total": total, "page": page, "per_page": per_page}


@router.get("/graph")
def authority_graph(adi_url: Optional[str] = None):
    """Get authority relationships as nodes and edges for graph visualization."""
    with get_db() as conn:
        if adi_url:
            # Get all accounts under this ADI tree
            rows = conn.execute("""
                SELECT aa.account_url, aa.authority_url, aa.is_implied, aa.disabled
                FROM account_authorities aa
                WHERE aa.account_url LIKE ? OR aa.authority_url LIKE ?
                ORDER BY aa.account_url
            """, (f"{adi_url}%", f"{adi_url}%")).fetchall()
        else:
            rows = conn.execute("""
                SELECT account_url, authority_url, is_implied, disabled
                FROM account_authorities
                ORDER BY account_url
            """).fetchall()

        nodes = set()
        edges = []
        for r in rows:
            nodes.add(r["account_url"])
            nodes.add(r["authority_url"])
            edges.append({
                "source": r["account_url"],
                "target": r["authority_url"],
                "is_implied": bool(r["is_implied"]),
                "disabled": bool(r["disabled"]),
            })

        # Classify nodes
        node_list = []
        for url in sorted(nodes):
            node_type = "unknown"
            row = conn.execute("SELECT 'adi' as t FROM adis WHERE url = ? UNION ALL SELECT 'key_book' FROM key_books WHERE url = ? UNION ALL SELECT 'token_account' FROM token_accounts WHERE url = ? UNION ALL SELECT 'data_account' FROM data_accounts WHERE url = ?",
                               (url, url, url, url)).fetchone()
            if row:
                node_type = row["t"]
            node_list.append({"id": url, "type": node_type})

    return {"nodes": node_list, "edges": edges}


@router.get("/flows")
def authority_flows():
    """Optimized data for Sankey diagram and chord diagram visualizations."""
    with get_db() as conn:
        # --- Sankey: ADI -> authority book flows ---
        # Each flow = one ADI's accounts governed by one authority book
        sankey_flows = []
        for r in conn.execute("""
            SELECT
                CASE
                    WHEN a.parent_url IS NULL THEN aa.account_url
                    ELSE COALESCE(a.parent_url, aa.account_url)
                END as adi_group,
                aa.authority_url,
                aa.is_implied,
                COUNT(*) as account_count
            FROM account_authorities aa
            LEFT JOIN adis a ON (
                aa.account_url = a.url
                OR aa.account_url LIKE a.url || '/%'
            )
            GROUP BY adi_group, aa.authority_url, aa.is_implied
            ORDER BY account_count DESC
            LIMIT 60
        """):
            sankey_flows.append({
                "source": r["adi_group"] or "unknown",
                "target": r["authority_url"],
                "value": r["account_count"],
                "is_implied": bool(r["is_implied"]),
            })

        # --- Chord: cross-ADI authority matrix ---
        # Which ADIs share authority relationships (their accounts governed by same books)
        chord_data = []
        for r in conn.execute("""
            SELECT
                kb.adi_url as book_owner,
                a.url as governed_adi,
                COUNT(DISTINCT aa.account_url) as link_count
            FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            JOIN adis a ON (
                aa.account_url = a.url
                OR aa.account_url LIKE a.url || '/%'
            )
            WHERE kb.adi_url != a.url
            GROUP BY kb.adi_url, a.url
            HAVING link_count > 0
            ORDER BY link_count DESC
            LIMIT 40
        """):
            chord_data.append({
                "source": r["book_owner"],
                "target": r["governed_adi"],
                "value": r["link_count"],
            })

        # --- Delegation chains ---
        delegations = []
        for r in conn.execute("""
            SELECT
                kp.adi_url as delegator_adi,
                kp.url as key_page,
                ke.delegate as delegate_book,
                ke.public_key_hash
            FROM key_entries ke
            JOIN key_pages kp ON ke.key_page_url = kp.url
            WHERE ke.delegate IS NOT NULL AND ke.delegate != ''
            ORDER BY kp.adi_url
        """):
            delegations.append({
                "delegator_adi": r["delegator_adi"],
                "key_page": r["key_page"],
                "delegate_book": r["delegate_book"],
                "key_hash": r["public_key_hash"],
            })

        # --- Authority concentration for top books ---
        top_books = []
        for r in conn.execute("""
            SELECT
                aa.authority_url,
                kb.adi_url as owner_adi,
                COUNT(*) as total_governed,
                SUM(CASE WHEN aa.is_implied = 1 THEN 1 ELSE 0 END) as implied,
                SUM(CASE WHEN aa.is_implied = 0 THEN 1 ELSE 0 END) as explicit
            FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            GROUP BY aa.authority_url, kb.adi_url
            ORDER BY total_governed DESC
            LIMIT 20
        """):
            top_books.append({
                "authority_url": r["authority_url"],
                "owner_adi": r["owner_adi"],
                "total_governed": r["total_governed"],
                "implied": r["implied"],
                "explicit": r["explicit"],
            })

    return {
        "sankey_flows": sankey_flows,
        "chord_data": chord_data,
        "delegations": delegations,
        "top_books": top_books,
    }
