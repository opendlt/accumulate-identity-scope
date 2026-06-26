"""Lite account endpoints — Accumulate lite identities / token / data accounts.

Lite accounts are key-hash-addressed accounts (acc://<keyhash>[/token]) that are
not registered under any ADI. They are the largest account class on the network
and were previously absent from the explorer. Populated by load_lite_accounts.py
and enriched with live on-chain state by enrich_lite_accounts.py.

Type note: the genesis loader can only classify by URL *shape*, which cannot tell
a bare lite identity from a lite *data* account (both are acc://<hex> with no
path). The enrichment pass records the real on-chain `confirmed_type`, so this
module derives a CANONICAL type from confirmed_type when available, falling back
to the URL-shape `account_type` only for accounts that never resolved on-chain.
Without this, ~93k lite data accounts masquerade as lite identities.
"""

from fastapi import APIRouter, Query
from typing import Optional
from ..database import get_db, table_columns
from ..cache import cached

router = APIRouter(prefix="/api/lite-accounts", tags=["lite"])

_SORTABLE = {"url", "account_type", "token_url", "key_hash", "balance", "credits"}

# Canonical lite types (stable API/UI vocabulary), and the on-chain confirmed_type
# strings they map from.
_CANONICAL_TYPES = {"lite_identity", "lite_token_account", "lite_data_account"}
_CONFIRMED_TO_CANONICAL = {
    "liteDataAccount": "lite_data_account",
    "liteTokenAccount": "lite_token_account",
    "liteIdentity": "lite_identity",
}


def _type_expr(cols) -> str:
    """SQL expression yielding the canonical lite type for a row.

    Prefers the enriched on-chain `confirmed_type`; falls back to the genesis
    URL-shape `account_type` when the account never resolved (confirmed_type NULL).
    """
    if "confirmed_type" not in cols:
        return "account_type"
    return (
        "CASE confirmed_type "
        "WHEN 'liteDataAccount' THEN 'lite_data_account' "
        "WHEN 'liteTokenAccount' THEN 'lite_token_account' "
        "WHEN 'liteIdentity' THEN 'lite_identity' "
        "ELSE account_type END"
    )


def _has_table(conn, name: str = "lite_accounts") -> bool:
    return name in {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }


@router.get("/summary")
@cached()
def lite_summary():
    """Counts by canonical type, top tokens, and the lite-account economy
    (ACME held, credits held, active vs dormant)."""
    with get_db() as conn:
        if not _has_table(conn):
            return {
                "total": 0, "by_type": {}, "top_tokens": [], "system_accounts": 0,
                "enriched": 0, "total_acme_balance": 0, "total_credits": 0,
                "active": 0, "dormant": 0,
            }

        cols = table_columns("lite_accounts")
        type_expr = _type_expr(cols)

        total = conn.execute("SELECT COUNT(*) FROM lite_accounts").fetchone()[0]
        by_type = {r["t"]: r["c"] for r in conn.execute(
            f"SELECT {type_expr} t, COUNT(*) c FROM lite_accounts GROUP BY t")}
        top_tokens = [
            {"token_url": r["token_url"], "count": r["c"]}
            for r in conn.execute(
                "SELECT token_url, COUNT(*) c FROM lite_accounts "
                "WHERE token_url IS NOT NULL GROUP BY token_url ORDER BY c DESC LIMIT 10")
        ]
        system_count = conn.execute("SELECT COUNT(*) FROM system_accounts").fetchone()[0] \
            if _has_table(conn, "system_accounts") else 0

        enriched = total_acme = total_credits = active = dormant = 0
        if "balance" in cols:
            enriched = conn.execute(
                "SELECT COUNT(*) FROM lite_accounts WHERE enriched_at IS NOT NULL").fetchone()[0]
            total_acme = conn.execute(
                "SELECT COALESCE(SUM(balance),0) FROM lite_accounts "
                "WHERE token_url='acc://ACME'").fetchone()[0]
            total_credits = conn.execute(
                "SELECT COALESCE(SUM(credits),0) FROM lite_accounts").fetchone()[0]
            # "Active" = holds value (a token balance OR credits); "dormant" = an
            # enriched account that resolved on-chain but holds nothing.
            active = conn.execute(
                "SELECT COUNT(*) FROM lite_accounts "
                "WHERE COALESCE(balance,0) > 0 OR COALESCE(credits,0) > 0").fetchone()[0]
            dormant = conn.execute(
                "SELECT COUNT(*) FROM lite_accounts "
                "WHERE enriched_at IS NOT NULL "
                "AND COALESCE(balance,0) = 0 AND COALESCE(credits,0) = 0").fetchone()[0]
    return {
        "total": total, "by_type": by_type, "top_tokens": top_tokens,
        "system_accounts": system_count, "enriched": enriched,
        "total_acme_balance": total_acme, "total_credits": total_credits,
        "active": active, "dormant": dormant,
    }


def _gini(values: list) -> float:
    """Gini coefficient over a list of non-negative values (closed form,
    O(n log n)). 0 = perfectly equal, →1 = one holder owns everything."""
    xs = sorted(v for v in values if v is not None and v > 0)
    n = len(xs)
    if n == 0:
        return 0.0
    total = sum(xs)
    if total == 0:
        return 0.0
    weighted = sum((2 * (i + 1) - n - 1) * x for i, x in enumerate(xs))
    return weighted / (n * n * (total / n))


def _lorenz(values: list, points: int = 120) -> list:
    """Lorenz curve points [{x,y}] (cumulative share of holders vs share of
    value), downsampled to at most `points` vertices for the chart."""
    xs = sorted(v for v in values if v is not None and v > 0)
    n = len(xs)
    total = sum(xs)
    if n == 0 or total == 0:
        return [{"x": 0.0, "y": 0.0}, {"x": 100.0, "y": 100.0}]
    step = max(1, n // points)
    out = [{"x": 0.0, "y": 0.0}]
    cum = 0
    for i, x in enumerate(xs):
        cum += x
        if (i + 1) % step == 0 or i == n - 1:
            out.append({"x": (i + 1) / n * 100, "y": cum / total * 100})
    return out


@router.get("/intelligence")
@cached()
def lite_intelligence():
    """Analytics over the lite-account population: wealth concentration (ACME),
    credit distribution, key-reuse "wallets", and a lite-vs-ADI comparison."""
    empty = {
        "acme": {"gini": 0, "lorenz": [], "top_holders": [], "holder_count": 0, "total": 0},
        "credits": {"gini": 0, "top_holders": [], "holder_count": 0, "total": 0},
        "wallets": {"multi_account_keys": 0, "max_accounts": 0, "multi_token_keys": 0, "top": []},
        "composition": {"active": 0, "dormant": 0, "by_type": {}},
        "vs_adi": {},
    }
    with get_db() as conn:
        if not _has_table(conn):
            return empty
        cols = table_columns("lite_accounts")
        if "balance" not in cols:
            return empty
        type_expr = _type_expr(cols)

        # ── ACME wealth concentration (lite token accounts holding ACME) ──
        acme_balances = [r[0] for r in conn.execute(
            "SELECT balance FROM lite_accounts "
            "WHERE token_url='acc://ACME' AND COALESCE(balance,0) > 0")]
        acme_top = [
            {"url": r["url"], "balance": r["balance"], "lite_identity": r["lite_identity"]}
            for r in conn.execute(
                "SELECT url, balance, lite_identity FROM lite_accounts "
                "WHERE token_url='acc://ACME' AND COALESCE(balance,0) > 0 "
                "ORDER BY balance DESC LIMIT 15")
        ]

        # ── Credit distribution (lite identities hold credits) ──
        credit_balances = [r[0] for r in conn.execute(
            "SELECT credits FROM lite_accounts WHERE COALESCE(credits,0) > 0")]
        credit_top = [
            {"url": r["url"], "credits": r["credits"]}
            for r in conn.execute(
                "SELECT url, credits FROM lite_accounts WHERE COALESCE(credits,0) > 0 "
                "ORDER BY credits DESC LIMIT 15")
        ]

        # ── Key-reuse "wallets": one key hash → many accounts (identity + token
        #    + data). A key controlling many accounts (or many token types) is a
        #    single point of compromise for a whole wallet. ──
        wallet_rows = conn.execute(
            "SELECT key_hash, COUNT(*) n, "
            "COUNT(DISTINCT token_url) tokens, "
            "COALESCE(SUM(CASE WHEN token_url='acc://ACME' THEN balance END),0) acme "
            "FROM lite_accounts WHERE key_hash IS NOT NULL "
            "GROUP BY key_hash HAVING n > 1 ORDER BY n DESC LIMIT 15").fetchall()
        multi_account_keys = conn.execute(
            "SELECT COUNT(*) FROM (SELECT key_hash FROM lite_accounts "
            "WHERE key_hash IS NOT NULL GROUP BY key_hash HAVING COUNT(*) > 1)").fetchone()[0]
        # multi-token: a key whose accounts span >1 distinct token (a multi-asset wallet)
        multi_token_keys = conn.execute(
            "SELECT COUNT(*) FROM (SELECT key_hash FROM lite_accounts "
            "WHERE token_url IS NOT NULL AND key_hash IS NOT NULL "
            "GROUP BY key_hash HAVING COUNT(DISTINCT token_url) > 1)").fetchone()[0]
        max_accounts = conn.execute(
            "SELECT COALESCE(MAX(n),0) FROM (SELECT COUNT(*) n FROM lite_accounts "
            "WHERE key_hash IS NOT NULL GROUP BY key_hash)").fetchone()[0]

        # ── Composition ──
        by_type = {r["t"]: r["c"] for r in conn.execute(
            f"SELECT {type_expr} t, COUNT(*) c FROM lite_accounts GROUP BY t")}
        active = conn.execute(
            "SELECT COUNT(*) FROM lite_accounts "
            "WHERE COALESCE(balance,0) > 0 OR COALESCE(credits,0) > 0").fetchone()[0]
        dormant = conn.execute(
            "SELECT COUNT(*) FROM lite_accounts WHERE enriched_at IS NOT NULL "
            "AND COALESCE(balance,0) = 0 AND COALESCE(credits,0) = 0").fetchone()[0]

        # ── Lite vs ADI comparison (the network's two account models) ──
        def _count(table):
            return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] \
                if _has_table(conn, table) else 0
        vs_adi = {
            "adis": _count("adis"),
            "adi_token_accounts": _count("token_accounts"),
            "adi_data_accounts": _count("data_accounts"),
            "lite_identities": by_type.get("lite_identity", 0),
            "lite_token_accounts": by_type.get("lite_token_account", 0),
            "lite_data_accounts": by_type.get("lite_data_account", 0),
        }

    return {
        "acme": {
            "gini": round(_gini(acme_balances), 4),
            "lorenz": _lorenz(acme_balances),
            "top_holders": acme_top,
            "holder_count": len(acme_balances),
            "total": sum(acme_balances),
        },
        "credits": {
            "gini": round(_gini(credit_balances), 4),
            "top_holders": credit_top,
            "holder_count": len(credit_balances),
            "total": sum(credit_balances),
        },
        "wallets": {
            "multi_account_keys": multi_account_keys,
            "multi_token_keys": multi_token_keys,
            "max_accounts": max_accounts,
            "top": [
                {"key_hash": r["key_hash"], "accounts": r["n"],
                 "tokens": r["tokens"], "acme": r["acme"]}
                for r in wallet_rows
            ],
        },
        "composition": {"active": active, "dormant": dormant, "by_type": by_type},
        "vs_adi": vs_adi,
    }


@router.get("/cross-surface")
@cached()
def lite_cross_surface(limit: int = Query(50, ge=1, le=200)):
    """Keys that secure BOTH an ADI key page and a lite account.

    A lite address is the first 20 bytes (40 hex) of SHA-256(public key); an ADI
    key page stores the full 32-byte SHA-256 of the same key. So a 40-hex prefix
    match between a (key-derived, 48-hex) lite hash and an ADI key-entry hash means
    the SAME public key controls both surfaces — a cross-surface compromise path
    that neither the ADI view nor the lite view shows on its own. (No raw public
    key needed: the hash truncation gives us the link directly.)
    """
    empty = {"summary": {"lite_keys": 0, "adi_pages": 0, "lite_accounts": 0, "acme_exposed": 0}, "keys": []}
    with get_db() as conn:
        if not _has_table(conn) or not _has_table(conn, "key_entries"):
            return empty
        cols = table_columns("lite_accounts")
        if "key_hash" not in cols:
            return empty
        type_expr = _type_expr(cols)
        bal = "l.balance" if "balance" in cols else "NULL"

        rows = conn.execute(
            f"""SELECT l.key_hash AS lk, l.url AS lurl, {type_expr} AS ltype,
                       l.token_url AS token, {bal} AS bal, k.key_page_url AS page
                FROM lite_accounts l
                JOIN key_entries k
                  ON substr(k.public_key_hash, 1, 40) = substr(l.key_hash, 1, 40)
                WHERE LENGTH(l.key_hash) = 48"""
        ).fetchall()

        keys: dict = {}
        for r in rows:
            e = keys.setdefault(r["lk"], {
                "key_hash": r["lk"], "accounts": {}, "pages": set(), "acme": 0,
            })
            if r["lurl"] not in e["accounts"]:
                e["accounts"][r["lurl"]] = {
                    "url": r["lurl"], "lite_type": r["ltype"],
                    "token_url": r["token"], "balance": r["bal"],
                }
                if r["token"] == "acc://ACME" and r["bal"]:
                    e["acme"] += r["bal"]
            e["pages"].add(r["page"])

        lite_accounts_total = sum(len(e["accounts"]) for e in keys.values())
        adi_pages_total = len(set().union(*[e["pages"] for e in keys.values()])) if keys else 0
        acme_exposed = sum(e["acme"] for e in keys.values())

        # Most significant first: by ACME exposed, then by breadth of reuse.
        ordered = sorted(
            keys.values(),
            key=lambda e: (e["acme"], len(e["pages"]), len(e["accounts"])),
            reverse=True,
        )[:limit]
        detail = [{
            "key_hash": e["key_hash"],
            "acme": e["acme"],
            "account_count": len(e["accounts"]),
            "page_count": len(e["pages"]),
            "accounts": list(e["accounts"].values()),
            "adi_pages": sorted(e["pages"]),
        } for e in ordered]

    return {
        "summary": {
            "lite_keys": len(keys),
            "adi_pages": adi_pages_total,
            "lite_accounts": lite_accounts_total,
            "acme_exposed": acme_exposed,
        },
        "keys": detail,
    }


@router.get("/detail")
def lite_account_detail(url: str = Query(..., description="full acc:// lite account URL")):
    """One lite account's full state plus every sibling account sharing its key
    hash (the lite identity + the token/data accounts under the same key)."""
    with get_db() as conn:
        if not _has_table(conn):
            return {"account": None, "siblings": []}
        cols = table_columns("lite_accounts")
        type_expr = _type_expr(cols)
        extra = ", balance, credits, confirmed_type, enrich_status, enriched_at" \
            if "balance" in cols else ""
        first_seen = ", first_seen_block" if "first_seen_block" in cols else ""

        row = conn.execute(
            f"SELECT url, account_type, {type_expr} AS lite_type, key_hash, token_url, "
            f"lite_identity, source{first_seen}{extra} "
            f"FROM lite_accounts WHERE url = ?", (url,)).fetchone()
        if row is None:
            return {"account": None, "siblings": []}
        account = dict(row)

        siblings = []
        key_hash = account.get("key_hash")
        if key_hash:
            sib_rows = conn.execute(
                f"SELECT url, {type_expr} AS lite_type, token_url"
                f"{', balance, credits' if 'balance' in cols else ''} "
                f"FROM lite_accounts WHERE key_hash = ? AND url != ? "
                f"ORDER BY lite_type, url",
                (key_hash, url)).fetchall()
            siblings = [dict(r) for r in sib_rows]
    return {"account": account, "siblings": siblings}


@router.get("")
def list_lite_accounts(
    account_type: Optional[str] = None,
    token_url: Optional[str] = None,
    search: Optional[str] = None,
    sort: Optional[str] = None,
    dir: Optional[str] = None,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=500),
):
    with get_db() as conn:
        if not _has_table(conn):
            return {"items": [], "total": 0, "page": page, "per_page": per_page}

        cols = table_columns("lite_accounts")
        type_expr = _type_expr(cols)

        conditions, params = [], []
        if account_type:
            # Filter on the CANONICAL type (so "lite_data_account" actually works,
            # even though the stored account_type column predates that distinction).
            if account_type in _CANONICAL_TYPES and "confirmed_type" in cols:
                conditions.append(f"{type_expr} = ?")
            else:
                conditions.append("account_type = ?")
            params.append(account_type)
        if token_url:
            conditions.append("token_url = ?")
            params.append(token_url)
        if search:
            conditions.append("url LIKE ?")
            params.append(f"%{search}%")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        total = conn.execute(f"SELECT COUNT(*) FROM lite_accounts {where}", params).fetchone()[0]

        col = sort if sort in (_SORTABLE & cols) else "url"
        direction = "DESC" if (dir or "").lower() == "desc" else "ASC"
        # Sort NULL balances/credits last regardless of direction, then by the
        # column, then a stable url tiebreak.
        if col in ("balance", "credits"):
            order = f"ORDER BY ({col} IS NULL), {col} {direction}, url ASC"
        else:
            order = f"ORDER BY {col} {direction}" + ("" if col == "url" else ", url ASC")

        extra = ", balance, credits, confirmed_type, enrich_status" if "balance" in cols else ""
        offset = (page - 1) * per_page
        rows = conn.execute(
            f"SELECT url, account_type, {type_expr} AS lite_type, key_hash, token_url, "
            f"lite_identity, source{extra} "
            f"FROM lite_accounts {where} {order} LIMIT ? OFFSET ?",
            params + [per_page, offset],
        ).fetchall()
    return {"items": [dict(r) for r in rows], "total": total, "page": page, "per_page": per_page}
