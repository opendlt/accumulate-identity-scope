"""Network intelligence endpoints - deep analytics on the identity tree."""

from fastapi import APIRouter, Query, HTTPException
from ..database import get_db
from ..cache import cached

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])


@router.get("")
@cached()
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
                       WHEN aa.adi_url IS NOT NULL AND aa.adi_url != kb.adi_url
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
        # True mean of the M in each page's M-of-N threshold (not a fabricated
        # weighting). Used by the Key Vault "Avg signatures required" metric.
        avg_threshold_raw = conn.execute(
            "SELECT AVG(threshold) FROM key_pages WHERE threshold IS NOT NULL"
        ).fetchone()[0]

        key_security = {
            "total_pages": total_pages,
            "single_sig": single_sig,
            "multi_sig": multi_sig,
            "zero_credit_pages": zero_credit,
            "avg_threshold": round(avg_threshold_raw, 2) if avg_threshold_raw is not None else 0,
        }

        # --- Per-ADI security posture (drives the Risk Heatmap single_sig /
        #     no_credits columns, which were previously never populated) ---
        adi_security = []
        for r in conn.execute("""
            SELECT adi_url,
                   COUNT(*) as total_pages,
                   SUM(CASE WHEN threshold <= 1 THEN 1 ELSE 0 END) as single_sig,
                   SUM(CASE WHEN threshold > 1 THEN 1 ELSE 0 END) as multi_sig,
                   SUM(CASE WHEN credit_balance = 0 THEN 1 ELSE 0 END) as no_credits
            FROM key_pages
            WHERE adi_url IS NOT NULL
            GROUP BY adi_url
        """):
            adi_security.append({
                "adi_url": r["adi_url"],
                "total_pages": r["total_pages"],
                "single_sig": r["single_sig"],
                "multi_sig": r["multi_sig"],
                "no_credits": r["no_credits"],
            })

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
                           COALESCE(tc.c, 0) + COALESCE(dc.c, 0) as cnt
                    FROM adis a
                    LEFT JOIN (SELECT adi_url, COUNT(*) c FROM token_accounts GROUP BY adi_url) tc ON tc.adi_url = a.url
                    LEFT JOIN (SELECT adi_url, COUNT(*) c FROM data_accounts  GROUP BY adi_url) dc ON dc.adi_url = a.url
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
        "adi_security": adi_security,
        "empty_adis": empty_adis,
        "accounts_per_adi": accounts_per_adi,
    }


_SEVERITY_WEIGHT = {"high": 30, "medium": 15, "low": 5, "ok": 0}


def _grade(score: int) -> str:
    if score >= 90: return "A"
    if score >= 75: return "B"
    if score >= 60: return "C"
    if score >= 40: return "D"
    return "F"


@router.get("/adi-report")
@cached()
def get_adi_report(url: str = Query(..., description="ADI URL, e.g. acc://foo.acme")):
    """Per-ADI Security Report Card: synthesize every signal for one identity into
    a prioritized, actionable verdict (findings + fixes + score + benchmarks).
    Answers "is this identity secure, and what should be fixed?".
    """
    if not url.startswith("acc://"):
        url = "acc://" + url

    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM adis WHERE url = ?", (url,)).fetchone():
            raise HTTPException(status_code=404, detail=f"ADI not found: {url}")

        # --- Key pages (signing strength) ---
        pages = conn.execute(
            "SELECT threshold, credit_balance FROM key_pages WHERE adi_url = ?", (url,)
        ).fetchall()
        total_pages = len(pages)
        single_sig = sum(1 for p in pages if (p["threshold"] or 0) <= 1)
        multi_sig = total_pages - single_sig
        zero_credit = sum(1 for p in pages if (p["credit_balance"] or 0) == 0)
        thresholds = [p["threshold"] for p in pages if p["threshold"] is not None]
        avg_threshold = round(sum(thresholds) / len(thresholds), 2) if thresholds else 0

        # --- Key reuse (keys of this ADI also used by others) ---
        reuse_rows = conn.execute("""
            WITH my_keys AS (
                SELECT DISTINCT ke.public_key_hash AS h
                FROM key_entries ke JOIN key_pages kp ON ke.key_page_url = kp.url
                WHERE kp.adi_url = ? AND ke.public_key_hash IS NOT NULL AND ke.public_key_hash != ''
            )
            SELECT mk.h AS key_hash, COUNT(DISTINCT kp2.adi_url) AS adi_count,
                   GROUP_CONCAT(DISTINCT kp2.adi_url) AS adis
            FROM my_keys mk
            JOIN key_entries ke2 ON ke2.public_key_hash = mk.h
            JOIN key_pages kp2 ON ke2.key_page_url = kp2.url
            GROUP BY mk.h
            HAVING adi_count > 1
            ORDER BY adi_count DESC
        """, (url,)).fetchall()
        shared_keys = len(reuse_rows)
        shared_with = set()
        for r in reuse_rows:
            for a in (r["adis"] or "").split(","):
                if a and a != url:
                    shared_with.add(a)
        max_cluster = max((r["adi_count"] for r in reuse_rows), default=0)

        # --- Authorities (who governs this ADI's accounts) ---
        auth_rows = conn.execute("""
            SELECT aa.account_url, aa.authority_url, aa.is_implied, aa.disabled, kb.adi_url AS book_adi
            FROM account_authorities aa
            LEFT JOIN key_books kb ON aa.authority_url = kb.url
            WHERE aa.adi_url = ?
        """, (url,)).fetchall()
        per_account: dict[str, dict] = {}
        cross_adi = set()
        disabled = 0
        for r in auth_rows:
            acc = per_account.setdefault(r["account_url"], {"imp": 0, "exp": 0})
            if r["is_implied"]:
                acc["imp"] += 1
            else:
                acc["exp"] += 1
            if r["disabled"]:
                disabled += 1
            if r["book_adi"] and r["book_adi"] != url:
                cross_adi.add(r["authority_url"])
        implied_only = sum(1 for a in per_account.values() if a["imp"] > 0 and a["exp"] == 0)
        cross_adi_count = len(cross_adi)

        # --- Delegation ---
        delegates_out = conn.execute("""
            SELECT COUNT(*) FROM key_entries ke JOIN key_pages kp ON ke.key_page_url = kp.url
            WHERE kp.adi_url = ? AND ke.delegate IS NOT NULL AND ke.delegate != ''
        """, (url,)).fetchone()[0]
        delegated_in = conn.execute("""
            SELECT COUNT(*) FROM key_entries ke JOIN key_books kb ON ke.delegate = kb.url
            WHERE kb.adi_url = ?
        """, (url,)).fetchone()[0]

        # --- Accounts summary ---
        token_count = conn.execute("SELECT COUNT(*) FROM token_accounts WHERE adi_url = ?", (url,)).fetchone()[0]
        data_count = conn.execute("SELECT COUNT(*) FROM data_accounts WHERE adi_url = ?", (url,)).fetchone()[0]
        book_count = conn.execute("SELECT COUNT(*) FROM key_books WHERE adi_url = ?", (url,)).fetchone()[0]

        # --- Network benchmarks (E2) ---
        net = conn.execute("""
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN threshold > 1 THEN 1 ELSE 0 END) AS multi
            FROM key_pages
        """).fetchone()
        net_multi_rate = round((net["multi"] or 0) / net["total"] * 100, 1) if net["total"] else 0.0

    # --- Synthesize prioritized findings (each: severity + why + fix) ---
    findings = []
    if shared_keys > 0:
        findings.append({
            "id": "key-reuse", "severity": "high",
            "title": f"Shares {shared_keys} signing key{'s' if shared_keys != 1 else ''} with {len(shared_with)} other identit{'ies' if len(shared_with) != 1 else 'y'}",
            "detail": f"A reused key is a shared point of failure (largest cluster: {max_cluster} identities).",
            "fix": "Rotate to a unique key per identity so a single compromise can’t cascade.",
        })
    if total_pages > 0 and single_sig == total_pages:
        title = ("The only key page is single-signature" if total_pages == 1
                 else f"All {total_pages} key pages are single-signature")
        findings.append({
            "id": "single-sig", "severity": "high",
            "title": title,
            "detail": "One stolen or lost key means total compromise — no multi-party check.",
            "fix": "Raise the threshold to require multiple signatures (M-of-N multi-sig).",
        })
    elif single_sig > 0:
        findings.append({
            "id": "single-sig", "severity": "medium",
            "title": f"{single_sig} of {total_pages} key pages are single-signature",
            "detail": "Single-signature pages are a single point of failure.",
            "fix": "Raise the threshold on critical pages to require multiple signatures.",
        })
    if zero_credit > 0:
        findings.append({
            "id": "zero-credit", "severity": "medium",
            "title": f"{zero_credit} key page{'s' if zero_credit != 1 else ''} cannot pay fees (0 credits)",
            "detail": "A page with no credits cannot submit any transaction — it is effectively frozen.",
            "fix": "Add credits (buy by burning ACME) so the page can sign again.",
        })
    if implied_only > 0:
        findings.append({
            "id": "implied-only", "severity": "medium",
            "title": f"{implied_only} account{'s' if implied_only != 1 else ''} rely only on implied authority",
            "detail": "Control rests on the default key book rather than an explicit grant, so it can shift and is harder to audit.",
            "fix": "Assign an explicit authority (key book) to pin down who controls the account.",
        })
    if cross_adi_count > 0:
        findings.append({
            "id": "cross-adi", "severity": "low",
            "title": f"Governed by {cross_adi_count} external key book{'s' if cross_adi_count != 1 else ''}",
            "detail": "A key book in a different identity can authorize this one — control crosses an identity boundary.",
            "fix": "Confirm the external authority is intentional; remove it if not.",
        })
    if disabled > 0:
        findings.append({
            "id": "disabled-authority", "severity": "low",
            "title": f"{disabled} disabled authorit{'ies' if disabled != 1 else 'y'}",
            "detail": "A disabled authority can no longer sign — control may have moved, or this may be a misconfiguration.",
            "fix": "Re-enable it, or confirm control was intentionally delegated elsewhere.",
        })
    if not findings:
        findings.append({
            "id": "clean", "severity": "ok",
            "title": "No security issues detected",
            "detail": "This identity has no reused keys, single-sig-only pages, unfunded pages, or implied-only authorities in the snapshot.",
            "fix": "",
        })

    order = {"high": 0, "medium": 1, "low": 2, "ok": 3}
    findings.sort(key=lambda f: order[f["severity"]])
    score = max(0, 100 - sum(_SEVERITY_WEIGHT[f["severity"]] for f in findings))
    counts = {s: sum(1 for f in findings if f["severity"] == s) for s in ("high", "medium", "low")}
    if counts["high"]:
        summary = "Action recommended — high-severity issues found."
    elif counts["medium"]:
        summary = "Review recommended — some weaknesses found."
    elif counts["low"]:
        summary = "Mostly healthy — minor items to confirm."
    else:
        summary = "Healthy — no issues detected in this snapshot."

    my_multi_rate = round(multi_sig / total_pages * 100, 1) if total_pages else 0.0

    return {
        "adi_url": url,
        "score": score,
        "grade": _grade(score),
        "summary": summary,
        "findings": findings,
        "metrics": {
            "total_pages": total_pages,
            "single_sig": single_sig,
            "multi_sig": multi_sig,
            "zero_credit": zero_credit,
            "avg_threshold": avg_threshold,
            "shared_keys": shared_keys,
            "shared_with": sorted(shared_with),
            "max_cluster": max_cluster,
            "implied_only": implied_only,
            "cross_adi": cross_adi_count,
            "disabled_authorities": disabled,
            "delegates_out": delegates_out,
            "delegated_in": delegated_in,
            "token_accounts": token_count,
            "data_accounts": data_count,
            "key_books": book_count,
        },
        "benchmarks": {
            "multi_sig_rate": my_multi_rate,
            "network_multi_sig_rate": net_multi_rate,
        },
    }
