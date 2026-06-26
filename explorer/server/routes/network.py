"""Network summary and topology endpoints optimized for the dashboard."""

from fastapi import APIRouter, Query
from ..database import get_db
from ..cache import cached

router = APIRouter(prefix="/api/network", tags=["network"])


@router.get("/summary")
@cached()
def get_network_summary():
    """Aggregated network summary optimized for the Command Center dashboard."""
    with get_db() as conn:
        # --- Counts ---
        counts = {}
        for table in ("adis", "token_accounts", "data_accounts", "token_issuers",
                       "key_books", "key_pages", "key_entries", "account_authorities",
                       "lite_accounts"):
            try:
                counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except Exception:
                counts[table] = 0

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
        # Books that govern accounts owned by a different ADI than the book itself.
        # Uses the denormalized account_authorities.adi_url (equality) instead of a
        # `LIKE adi_url || '/%'` scan against all 43k ADIs.
        cross_adi_count = conn.execute("""
            SELECT COUNT(DISTINCT aa.authority_url) FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            WHERE aa.adi_url IS NOT NULL AND aa.adi_url != kb.adi_url
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
            -- last_used_on is microseconds since the Unix epoch.
            SELECT date(last_used_on / 1000000, 'unixepoch') as day,
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
@cached()
def get_topology(active_only: bool = Query(True, description="Exclude empty/reserved ADIs with no accounts")):
    """Get network topology for visualization.

    Returns nodes (ADIs) and edges (parent-child, cross-ADI authority, key
    sharing, delegation). Defaults to active ADIs only — the full 43k-node graph
    is not renderable in a browser force layout, so the unfiltered view must be
    requested explicitly (active_only=false). Node account/book counts use
    grouped joins instead of per-row correlated subqueries, and every returned
    edge is guaranteed to reference two returned nodes.
    """
    with get_db() as conn:
        active_filter = ""
        if active_only:
            active_filter = (
                "WHERE (tc.c IS NOT NULL OR dc.c IS NOT NULL OR bc.c IS NOT NULL "
                "OR (a.entry_count IS NOT NULL AND a.entry_count > 0))"
            )

        nodes = []
        node_ids = set()
        for r in conn.execute(f"""
            SELECT a.url, a.parent_url, a.entry_count, a.crawl_status,
                   COALESCE(tc.c, 0) AS token_count,
                   COALESCE(dc.c, 0) AS data_count,
                   COALESCE(bc.c, 0) AS book_count
            FROM adis a
            LEFT JOIN (SELECT adi_url, COUNT(*) c FROM token_accounts GROUP BY adi_url) tc ON tc.adi_url = a.url
            LEFT JOIN (SELECT adi_url, COUNT(*) c FROM data_accounts  GROUP BY adi_url) dc ON dc.adi_url = a.url
            LEFT JOIN (SELECT adi_url, COUNT(*) c FROM key_books       GROUP BY adi_url) bc ON bc.adi_url = a.url
            {active_filter}
            ORDER BY a.url
        """):
            node_ids.add(r["url"])
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

        def both_present(s, t):
            return s in node_ids and t in node_ids

        # Parent-child edges
        hierarchy_edges = [
            {"source": n["parent_url"], "target": n["id"], "type": "hierarchy"}
            for n in nodes
            if n["parent_url"] and n["parent_url"] in node_ids
        ]

        # Cross-ADI authority edges (book in ADI A governs account in ADI B)
        authority_edges = []
        for r in conn.execute("""
            SELECT DISTINCT kb.adi_url AS source_adi, aa.adi_url AS target_adi
            FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            WHERE aa.adi_url IS NOT NULL AND aa.adi_url != kb.adi_url
        """):
            if r["source_adi"] and r["target_adi"] and both_present(r["source_adi"], r["target_adi"]):
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
            if both_present(r["source_adi"], r["target_adi"]):
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
            if both_present(r["source_adi"], r["target_adi"]):
                delegation_edges.append({
                    "source": r["source_adi"],
                    "target": r["target_adi"],
                    "type": "delegation",
                })

        total_adis = conn.execute("SELECT COUNT(*) FROM adis").fetchone()[0]

    # Per-node key-reuse degree: how many distinct other ADIs each node shares a
    # signing key with. Powers an honest "Key Reuse Risk" color mode (previously
    # the UI colored by key-book count, which is unrelated to reuse).
    shared_partners: dict[str, set] = {}
    for e in key_edges:
        shared_partners.setdefault(e["source"], set()).add(e["target"])
        shared_partners.setdefault(e["target"], set()).add(e["source"])
    for n in nodes:
        n["shared_key_count"] = len(shared_partners.get(n["id"], ()))

    edges = hierarchy_edges + authority_edges + key_edges + delegation_edges
    return {
        "nodes": nodes,
        "edges": edges,
        "meta": {
            "active_only": active_only,
            "total_adis": total_adis,
            "returned_nodes": len(nodes),
            "edge_counts": {
                "hierarchy": len(hierarchy_edges),
                "authority": len(authority_edges),
                "key_sharing": len(key_edges),
                "delegation": len(delegation_edges),
            },
        },
    }
