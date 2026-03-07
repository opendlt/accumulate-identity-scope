"""Network summary and topology endpoints optimized for the dashboard."""

from fastapi import APIRouter, Query
from ..database import get_db

router = APIRouter(prefix="/api/network", tags=["network"])


@router.get("/summary")
def get_network_summary():
    """Aggregated network summary optimized for the Command Center dashboard."""
    with get_db() as conn:
        # --- Counts ---
        counts = {}
        for table in ("adis", "token_accounts", "data_accounts", "token_issuers",
                       "key_books", "key_pages", "key_entries", "account_authorities"):
            counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

        # --- Health ---
        adi_status = {}
        for r in conn.execute("SELECT crawl_status, COUNT(*) as c FROM adis GROUP BY crawl_status"):
            adi_status[r["crawl_status"]] = r["c"]

        root_count = conn.execute("SELECT COUNT(*) FROM adis WHERE parent_url IS NULL").fetchone()[0]
        sub_count = conn.execute("SELECT COUNT(*) FROM adis WHERE parent_url IS NOT NULL").fetchone()[0]

        # --- Security posture ---
        total_pages = conn.execute("SELECT COUNT(*) FROM key_pages").fetchone()[0]
        multi_sig = conn.execute("SELECT COUNT(*) FROM key_pages WHERE threshold > 1").fetchone()[0]
        zero_credit = conn.execute("SELECT COUNT(*) FROM key_pages WHERE credit_balance = 0").fetchone()[0]
        shared_keys = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT ke.public_key_hash
                FROM key_entries ke
                JOIN key_pages kp ON ke.key_page_url = kp.url
                WHERE ke.public_key_hash IS NOT NULL AND ke.public_key_hash != ''
                GROUP BY ke.public_key_hash
                HAVING COUNT(DISTINCT kp.adi_url) > 1
            )
        """).fetchone()[0]

        security = {
            "total_pages": total_pages,
            "multi_sig": multi_sig,
            "single_sig": total_pages - multi_sig,
            "zero_credit_pages": zero_credit,
            "shared_key_count": shared_keys,
        }

        # --- Authority stats ---
        auth_explicit = conn.execute("SELECT COUNT(*) FROM account_authorities WHERE is_implied=0").fetchone()[0]
        auth_implied = conn.execute("SELECT COUNT(*) FROM account_authorities WHERE is_implied=1").fetchone()[0]
        cross_adi_count = conn.execute("""
            SELECT COUNT(DISTINCT aa.authority_url) FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            WHERE aa.account_url NOT LIKE kb.adi_url || '/%'
              AND aa.account_url != kb.adi_url
        """).fetchone()[0]
        delegation_count = conn.execute(
            "SELECT COUNT(*) FROM key_entries WHERE delegate IS NOT NULL AND delegate != ''"
        ).fetchone()[0]

        authority = {
            "explicit": auth_explicit,
            "implied": auth_implied,
            "cross_adi_books": cross_adi_count,
            "delegation_count": delegation_count,
        }

        # --- Token distribution ---
        token_distribution = []
        for r in conn.execute(
            "SELECT token_url, COUNT(*) as c FROM token_accounts GROUP BY token_url ORDER BY c DESC"
        ):
            token_distribution.append({"token_url": r["token_url"], "count": r["c"]})

        # --- Top key reuse (top 5 for insight card) ---
        top_key_reuse = []
        for r in conn.execute("""
            SELECT ke.public_key_hash, COUNT(DISTINCT kp.adi_url) as adi_count
            FROM key_entries ke
            JOIN key_pages kp ON ke.key_page_url = kp.url
            WHERE ke.public_key_hash IS NOT NULL AND ke.public_key_hash != ''
            GROUP BY ke.public_key_hash
            HAVING adi_count > 1
            ORDER BY adi_count DESC
            LIMIT 5
        """):
            top_key_reuse.append({
                "key_hash": r["public_key_hash"],
                "adi_count": r["adi_count"],
            })

        # --- Top authority books by governed count ---
        top_authority_books = []
        for r in conn.execute("""
            SELECT authority_url, COUNT(*) as governed
            FROM account_authorities
            GROUP BY authority_url
            ORDER BY governed DESC
            LIMIT 5
        """):
            top_authority_books.append({
                "authority_url": r["authority_url"],
                "governed_count": r["governed"],
            })

        # --- Depth distribution ---
        depth_distribution = []
        for r in conn.execute("""
            WITH RECURSIVE tree(url, depth) AS (
                SELECT url, 0 FROM adis WHERE parent_url IS NULL
                UNION ALL
                SELECT a.url, t.depth+1 FROM adis a JOIN tree t ON a.parent_url = t.url
            )
            SELECT depth, COUNT(*) as c FROM tree GROUP BY depth ORDER BY depth
        """):
            depth_distribution.append({"depth": r["depth"], "count": r["c"]})

        # --- Top ADIs ---
        top_adis = []
        for r in conn.execute("""
            SELECT a.url, a.entry_count,
                (SELECT COUNT(*) FROM token_accounts t WHERE t.adi_url = a.url) as token_count,
                (SELECT COUNT(*) FROM data_accounts d WHERE d.adi_url = a.url) as data_count
            FROM adis a ORDER BY a.entry_count DESC NULLS LAST LIMIT 10
        """):
            top_adis.append(dict(r))

        # --- Key activity timeline (from last_used_on) ---
        key_activity = []
        for r in conn.execute("""
            SELECT date(last_used_on / 1000000000, 'unixepoch') as day,
                   COUNT(*) as uses
            FROM key_entries
            WHERE last_used_on IS NOT NULL AND last_used_on > 0
            GROUP BY day
            ORDER BY day
        """):
            if r["day"]:
                key_activity.append({"date": r["day"], "count": r["uses"]})

    return {
        "counts": counts,
        "adi_status": adi_status,
        "root_count": root_count,
        "sub_count": sub_count,
        "security": security,
        "authority": authority,
        "token_distribution": token_distribution,
        "top_key_reuse": top_key_reuse,
        "top_authority_books": top_authority_books,
        "depth_distribution": depth_distribution,
        "top_adis": top_adis,
        "key_activity": key_activity,
    }


@router.get("/topology")
def get_topology(active_only: bool = Query(False, description="Exclude empty/reserved ADIs with no accounts")):
    """Get network topology for visualization.

    Returns nodes (ADIs) and edges (parent-child + cross-ADI authority).
    Use active_only=true to exclude empty ADIs for faster loading.
    """
    with get_db() as conn:
        # Build query — optionally filter to active ADIs only
        where_clause = ""
        if active_only:
            where_clause = "HAVING token_count > 0 OR data_count > 0 OR book_count > 0 OR (a.entry_count IS NOT NULL AND a.entry_count > 0)"

        nodes = []
        for r in conn.execute(f"""
            SELECT a.url, a.parent_url, a.entry_count, a.crawl_status,
                (SELECT COUNT(*) FROM token_accounts t WHERE t.adi_url = a.url) as token_count,
                (SELECT COUNT(*) FROM data_accounts d WHERE d.adi_url = a.url) as data_count,
                (SELECT COUNT(*) FROM key_books kb WHERE kb.adi_url = a.url) as book_count
            FROM adis a
            GROUP BY a.url
            {where_clause}
            ORDER BY a.url
        """):
            nodes.append({
                "id": r["url"],
                "parent_url": r["parent_url"],
                "entry_count": r["entry_count"] or 0,
                "crawl_status": r["crawl_status"],
                "token_count": r["token_count"],
                "data_count": r["data_count"],
                "book_count": r["book_count"],
                "account_total": r["token_count"] + r["data_count"],
            })

        # Parent-child edges
        hierarchy_edges = []
        for n in nodes:
            if n["parent_url"]:
                hierarchy_edges.append({
                    "source": n["parent_url"],
                    "target": n["id"],
                    "type": "hierarchy",
                })

        # Cross-ADI authority edges (book in ADI A governs account in ADI B)
        authority_edges = []
        for r in conn.execute("""
            SELECT DISTINCT kb.adi_url as source_adi,
                   CASE
                       WHEN ta.adi_url IS NOT NULL THEN ta.adi_url
                       WHEN da.adi_url IS NOT NULL THEN da.adi_url
                       ELSE NULL
                   END as target_adi
            FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            LEFT JOIN token_accounts ta ON aa.account_url = ta.url
            LEFT JOIN data_accounts da ON aa.account_url = da.url
            WHERE target_adi IS NOT NULL AND target_adi != kb.adi_url
        """):
            if r["source_adi"] and r["target_adi"]:
                authority_edges.append({
                    "source": r["source_adi"],
                    "target": r["target_adi"],
                    "type": "authority",
                })

        # Key sharing edges (ADIs sharing the same key)
        key_edges = []
        for r in conn.execute("""
            SELECT DISTINCT a1.adi_url as source_adi, a2.adi_url as target_adi
            FROM key_entries ke1
            JOIN key_pages a1 ON ke1.key_page_url = a1.url
            JOIN key_entries ke2 ON ke1.public_key_hash = ke2.public_key_hash
                AND ke1.id < ke2.id
            JOIN key_pages a2 ON ke2.key_page_url = a2.url
            WHERE ke1.public_key_hash IS NOT NULL AND ke1.public_key_hash != ''
              AND a1.adi_url != a2.adi_url
        """):
            key_edges.append({
                "source": r["source_adi"],
                "target": r["target_adi"],
                "type": "key_sharing",
            })

        # Delegation edges
        delegation_edges = []
        for r in conn.execute("""
            SELECT DISTINCT kp.adi_url as source_adi,
                   kb.adi_url as target_adi
            FROM key_entries ke
            JOIN key_pages kp ON ke.key_page_url = kp.url
            JOIN key_books kb ON ke.delegate = kb.url
            WHERE ke.delegate IS NOT NULL AND ke.delegate != ''
              AND kp.adi_url != kb.adi_url
        """):
            delegation_edges.append({
                "source": r["source_adi"],
                "target": r["target_adi"],
                "type": "delegation",
            })

    return {
        "nodes": nodes,
        "edges": hierarchy_edges + authority_edges + key_edges + delegation_edges,
    }
