/**
 * Canonical risk copy — the single source of truth for "why it matters" + "what
 * to do" on every security signal the Scope surfaces. Keeps the threat model and
 * remediation consistent everywhere (Dashboard, Intelligence, Key Vault, Tree,
 * Authorities). Grounded in Accumulate's key-book security model.
 */

export type RiskTone = 'danger' | 'warning' | 'info';

export interface RiskInfo {
  id: string;
  /** Short threat-model statement: what an attacker does with this. */
  why: string;
  /** Concrete remediation. */
  fix: string;
  tone: RiskTone;
}

export const RISKS: Record<string, RiskInfo> = {
  'key-reuse': {
    id: 'key-reuse',
    why: 'The same signing key controls multiple identities — one stolen key compromises every identity that shares it.',
    fix: 'Rotate to a unique key per identity so a single compromise can’t cascade.',
    tone: 'danger',
  },
  'zero-credit': {
    id: 'zero-credit',
    why: 'A key page with no credits cannot submit any transaction — the identity is effectively frozen.',
    fix: 'Add credits (buy by burning ACME) so the page can sign again.',
    tone: 'warning',
  },
  'single-sig': {
    id: 'single-sig',
    why: 'A single key fully controls the page — one stolen or lost key means total compromise (a single point of failure).',
    fix: 'Raise the threshold to require multiple signatures (M-of-N multi-sig).',
    tone: 'warning',
  },
  'implied-only': {
    id: 'implied-only',
    why: 'Control rests on the identity’s default key book rather than an explicit grant, so it can shift as the directory changes and is harder to audit.',
    fix: 'Assign an explicit authority (key book) to the account to pin down who controls it.',
    tone: 'warning',
  },
  concentration: {
    id: 'concentration',
    why: 'A few key books govern a large share of all accounts — compromising one top book affects many identities at once.',
    fix: 'Review the most powerful books; distribute authority where it makes sense.',
    tone: 'info',
  },
  'cross-adi': {
    id: 'cross-adi',
    why: 'A key book in a different identity can authorize this one — control crosses an identity boundary.',
    fix: 'Confirm the external authority is intentional; remove it if not.',
    tone: 'info',
  },
  'disabled-authority': {
    id: 'disabled-authority',
    why: 'A disabled authority can no longer sign for the account — control may have been moved, or this may be a misconfiguration.',
    fix: 'Re-enable it, or confirm control was intentionally delegated elsewhere.',
    tone: 'warning',
  },
  'empty-adi': {
    id: 'empty-adi',
    why: 'A registered identity with no accounts, sub-identities, or data — likely abandoned or reserved. Not a security risk by itself.',
    fix: 'No action needed unless you expected this identity to be in use.',
    tone: 'info',
  },
};

export function getRisk(id: string): RiskInfo | undefined {
  return RISKS[id];
}

/**
 * The meaning of the 1–3 severity tiers used by the Risk Heatmap and clusters —
 * surfaced so users don't read "3/3" as "maximum danger".
 */
export const SEVERITY_SCALE_NOTE =
  'Severity reflects how many instances an identity has relative to the worst identity in that column — it ranks prevalence, not impact.';
