"""Dashboard statistics endpoints."""

from fastapi import APIRouter
from ..database import get_db

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("")
def get_stats():
    with get_db() as conn:
        counts = {}
        for table in ("adis", "token_accounts", "data_accounts", "token_issuers",
                       "key_books", "key_pages", "key_entries", "account_authorities"):
            counts[table] = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

        adi_status = {}
        for r in conn.execute("SELECT crawl_status, COUNT(*) as c FROM adis GROUP BY crawl_status"):
            adi_status[r["crawl_status"]] = r["c"]

        root_count = conn.execute("SELECT COUNT(*) FROM adis WHERE parent_url IS NULL").fetchone()[0]
        sub_count = conn.execute("SELECT COUNT(*) FROM adis WHERE parent_url IS NOT NULL").fetchone()[0]

        token_distribution = []
        for r in conn.execute(
            "SELECT token_url, COUNT(*) as c FROM token_accounts GROUP BY token_url ORDER BY c DESC"
        ):
            token_distribution.append({"token_url": r["token_url"], "count": r["c"]})

        authority_stats = {
            "explicit": conn.execute("SELECT COUNT(*) FROM account_authorities WHERE is_implied=0").fetchone()[0],
            "implied": conn.execute("SELECT COUNT(*) FROM account_authorities WHERE is_implied=1").fetchone()[0],
        }

        threshold_distribution = []
        for r in conn.execute("SELECT threshold, COUNT(*) as c FROM key_pages GROUP BY threshold ORDER BY c DESC"):
            threshold_distribution.append({"threshold": r["threshold"], "count": r["c"]})

        top_adis = []
        for r in conn.execute("""
            SELECT a.url, a.entry_count,
                (SELECT COUNT(*) FROM token_accounts t WHERE t.adi_url = a.url) as token_count,
                (SELECT COUNT(*) FROM data_accounts d WHERE d.adi_url = a.url) as data_count
            FROM adis a
            ORDER BY a.entry_count DESC NULLS LAST
            LIMIT 15
        """):
            top_adis.append(dict(r))

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

    return {
        "counts": counts,
        "adi_status": adi_status,
        "root_count": root_count,
        "sub_count": sub_count,
        "token_distribution": token_distribution,
        "authority_stats": authority_stats,
        "threshold_distribution": threshold_distribution,
        "top_adis": top_adis,
        "depth_distribution": depth_distribution,
    }
