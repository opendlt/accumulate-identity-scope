"""Network intelligence endpoints - deep analytics on the identity tree."""

from fastapi import APIRouter
from ..database import get_db

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.get("")
def get_intelligence():
    with get_db() as conn:
        # --- Key Reuse Clusters ---
        # Keys that control multiple ADIs
        key_reuse = []
        for r in conn.execute("""
            SELECT ke.public_key_hash, COUNT(DISTINCT kp.adi_url) as adi_count,
                   GROUP_CONCAT(DISTINCT kp.adi_url) as adi_urls
            FROM key_entries ke
            JOIN key_pages kp ON ke.key_page_url = kp.url
            WHERE ke.public_key_hash IS NOT NULL AND ke.public_key_hash != ''
            GROUP BY ke.public_key_hash
            HAVING adi_count > 1
            ORDER BY adi_count DESC
            LIMIT 20
        """):
            key_reuse.append({
                "key_hash": r["public_key_hash"],
                "adi_count": r["adi_count"],
                "adi_urls": r["adi_urls"].split(",") if r["adi_urls"] else [],
            })

        # --- Cross-ADI Authority (books that govern foreign accounts) ---
        cross_authority = []
        for r in conn.execute("""
            SELECT aa.authority_url,
                   kb.adi_url as book_owner,
                   COUNT(DISTINCT aa.account_url) as governed_count,
                   COUNT(DISTINCT CASE
                       WHEN aa.account_url NOT LIKE kb.adi_url || '/%'
                            AND aa.account_url != kb.adi_url
                       THEN aa.account_url END) as foreign_count
            FROM account_authorities aa
            JOIN key_books kb ON aa.authority_url = kb.url
            GROUP BY aa.authority_url, kb.adi_url
            HAVING foreign_count > 0
            ORDER BY foreign_count DESC
            LIMIT 20
        """):
            cross_authority.append({
                "authority_url": r["authority_url"],
                "book_owner": r["book_owner"],
                "governed_count": r["governed_count"],
                "foreign_count": r["foreign_count"],
            })

        # --- Delegation Chains ---
        delegations = []
        for r in conn.execute("""
            SELECT ke.delegate,
                   kp.adi_url as delegator_adi,
                   kp.url as key_page,
                   ke.public_key_hash
            FROM key_entries ke
            JOIN key_pages kp ON ke.key_page_url = kp.url
            WHERE ke.delegate IS NOT NULL AND ke.delegate != ''
            ORDER BY ke.delegate
        """):
            delegations.append({
                "delegate": r["delegate"],
                "delegator_adi": r["delegator_adi"],
                "key_page": r["key_page"],
                "key_hash": r["public_key_hash"],
            })

        # --- Token Economy ---
        token_economy = []
        for r in conn.execute("""
            SELECT ti.url, ti.symbol, ti.precision, ti.issued, ti.supply_limit, ti.adi_url,
                   (SELECT COUNT(*) FROM token_accounts ta WHERE ta.token_url = ti.url) as holder_count
            FROM token_issuers ti
            ORDER BY holder_count DESC
        """):
            token_economy.append({
                "url": r["url"],
                "symbol": r["symbol"],
                "precision": r["precision"],
                "issued": r["issued"],
                "supply_limit": r["supply_limit"],
                "adi_url": r["adi_url"],
                "holder_count": r["holder_count"],
            })

        # --- ACME Distribution ---
        acme_by_adi = []
        for r in conn.execute("""
            SELECT adi_url, COUNT(*) as acme_accounts
            FROM token_accounts
            WHERE token_url = 'acc://ACME'
            GROUP BY adi_url
            ORDER BY acme_accounts DESC
            LIMIT 20
        """):
            acme_by_adi.append({
                "adi_url": r["adi_url"],
                "acme_accounts": r["acme_accounts"],
            })

        total_acme = conn.execute(
            "SELECT COUNT(*) FROM token_accounts WHERE token_url = 'acc://ACME'"
        ).fetchone()[0]

        # --- Authority Concentration ---
        # How many accounts each authority book governs
        authority_concentration = []
        for r in conn.execute("""
            SELECT authority_url,
                   COUNT(*) as total_accounts,
                   SUM(CASE WHEN is_implied = 1 THEN 1 ELSE 0 END) as implied_count,
                   SUM(CASE WHEN is_implied = 0 THEN 1 ELSE 0 END) as explicit_count
            FROM account_authorities
            GROUP BY authority_url
            ORDER BY total_accounts DESC
            LIMIT 20
        """):
            authority_concentration.append({
                "authority_url": r["authority_url"],
                "total_accounts": r["total_accounts"],
                "implied_count": r["implied_count"],
                "explicit_count": r["explicit_count"],
            })

        # --- Key Security Metrics ---
        total_pages = conn.execute("SELECT COUNT(*) FROM key_pages").fetchone()[0]
        single_sig = conn.execute(
            "SELECT COUNT(*) FROM key_pages WHERE threshold <= 1"
        ).fetchone()[0]
        multi_sig = conn.execute(
            "SELECT COUNT(*) FROM key_pages WHERE threshold > 1"
        ).fetchone()[0]
        zero_credit = conn.execute(
            "SELECT COUNT(*) FROM key_pages WHERE credit_balance = 0"
        ).fetchone()[0]

        key_security = {
            "total_pages": total_pages,
            "single_sig": single_sig,
            "multi_sig": multi_sig,
            "zero_credit_pages": zero_credit,
        }

        # --- Orphan / Standalone ADIs (root ADIs with no sub-ADIs, no accounts) ---
        empty_adis = conn.execute("""
            SELECT COUNT(*) FROM adis a
            WHERE a.parent_url IS NULL
              AND NOT EXISTS (SELECT 1 FROM adis c WHERE c.parent_url = a.url)
              AND NOT EXISTS (SELECT 1 FROM token_accounts ta WHERE ta.adi_url = a.url)
              AND NOT EXISTS (SELECT 1 FROM data_accounts da WHERE da.adi_url = a.url)
              AND a.entry_count = 0
        """).fetchone()[0]

        # --- Accounts per ADI distribution ---
        accounts_per_adi = []
        for r in conn.execute("""
            SELECT bucket, COUNT(*) as adi_count FROM (
                SELECT CASE
                    WHEN cnt = 0 THEN '0'
                    WHEN cnt BETWEEN 1 AND 5 THEN '1-5'
                    WHEN cnt BETWEEN 6 AND 20 THEN '6-20'
                    WHEN cnt BETWEEN 21 AND 100 THEN '21-100'
                    ELSE '100+'
                END as bucket
                FROM (
                    SELECT a.url,
                           (SELECT COUNT(*) FROM token_accounts t WHERE t.adi_url = a.url)
                           + (SELECT COUNT(*) FROM data_accounts d WHERE d.adi_url = a.url) as cnt
                    FROM adis a
                )
            )
            GROUP BY bucket
            ORDER BY CASE bucket
                WHEN '0' THEN 1 WHEN '1-5' THEN 2 WHEN '6-20' THEN 3
                WHEN '21-100' THEN 4 ELSE 5 END
        """):
            accounts_per_adi.append({"bucket": r["bucket"], "adi_count": r["adi_count"]})

    return {
        "key_reuse": key_reuse,
        "cross_authority": cross_authority,
        "delegations": delegations,
        "token_economy": token_economy,
        "acme_distribution": {
            "total_acme_accounts": total_acme,
            "top_adis": acme_by_adi,
        },
        "authority_concentration": authority_concentration,
        "key_security": key_security,
        "empty_adis": empty_adis,
        "accounts_per_adi": accounts_per_adi,
    }
