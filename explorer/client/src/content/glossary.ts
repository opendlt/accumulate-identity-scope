/**
 * Canonical Accumulate glossary — the single source of truth for every
 * definition surfaced in the UI (InfoTips, the Glossary drawer, term labels).
 * Plain-language `short` definition + a `why` ("why it matters") hook.
 *
 * Definitions verified against the Accumulate docs:
 *   https://docs.accumulatenetwork.io/
 *   https://docs.accumulatenetwork.io/accumulate/deep-dive/signatures-and-authorities
 */

export type GlossaryCategory =
  | 'Identities'
  | 'Accounts & tokens'
  | 'Keys & signing'
  | 'Authority & delegation'
  | 'Analytics';

export interface GlossaryEntry {
  id: string;
  term: string;
  category: GlossaryCategory;
  short: string;
  why: string;
  /** Other glossary ids worth cross-linking. */
  see?: string[];
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  adi: {
    id: 'adi',
    term: 'ADI (Accumulate Digital Identifier)',
    category: 'Identities',
    short: 'A human-readable on-chain identity addressed by URL (acc://name.acme) that owns accounts, keys, and authorities.',
    why: 'The root container for everything on Accumulate — the "who". Every account and key belongs to an ADI.',
    see: ['sub-adi', 'directory-entries'],
  },
  'sub-adi': {
    id: 'sub-adi',
    term: 'Sub-ADI',
    category: 'Identities',
    short: 'An identity nested beneath a parent ADI (acc://parent.acme/child), created and governed under it.',
    why: 'Lets an organization structure identities hierarchically. Deep nesting means more complex delegation and governance.',
    see: ['adi'],
  },
  'directory-entries': {
    id: 'directory-entries',
    term: 'Directory entries',
    category: 'Identities',
    short: "The records (accounts, key books, sub-ADIs) listed under an identity's directory.",
    why: "A proxy for how large or busy an identity is — more entries means more on-chain activity under that ADI.",
  },
  'token-account': {
    id: 'token-account',
    term: 'Token account',
    category: 'Accounts & tokens',
    short: 'An account that holds a fungible token balance (for example ACME).',
    why: 'Where value lives. A token account can send and receive a specific token.',
    see: ['data-account', 'token-issuer'],
  },
  'data-account': {
    id: 'data-account',
    term: 'Data account',
    category: 'Accounts & tokens',
    short: 'An account that stores immutable on-chain data entries. It holds no token balance.',
    why: 'Used for on-chain records, attestations, and audit trails — not for moving value.',
    see: ['token-account'],
  },
  'token-issuer': {
    id: 'token-issuer',
    term: 'Token issuer',
    category: 'Accounts & tokens',
    short: 'The ADI-owned contract that mints a token and defines its symbol, precision, and supply.',
    why: 'Defines a token’s economics — how much can exist and how divisible it is.',
    see: ['precision', 'token-account'],
  },
  acme: {
    id: 'acme',
    term: 'ACME',
    category: 'Accounts & tokens',
    short: "Accumulate's native token. Burning ACME produces the credits used to pay transaction fees.",
    why: 'The base asset of the network; most token accounts hold ACME.',
    see: ['credits'],
  },
  precision: {
    id: 'precision',
    term: 'Precision',
    category: 'Accounts & tokens',
    short: 'The number of decimal places a token supports. Precision 8 means the smallest unit is 0.00000001.',
    why: 'Determines how finely the token can be divided when transferred.',
  },
  'lite-account': {
    id: 'lite-account',
    term: 'Lite account',
    category: 'Accounts & tokens',
    short: 'A key-hash-addressed account (acc://<keyhash>[/token]) not registered under any ADI — created implicitly by its first transaction. Covers lite identities, lite token accounts, and lite data accounts.',
    why: 'The default wallet primitive and the largest account class on Accumulate — anyone can hold tokens or write data without registering an ADI. The explorer was previously blind to these.',
    see: ['adi', 'token-account'],
  },
  'key-book': {
    id: 'key-book',
    term: 'Key book',
    category: 'Keys & signing',
    short: 'A container of key pages that governs an identity — the ADI’s set of authorities.',
    why: 'The "lockset" for an identity: it decides who is allowed to sign for it.',
    see: ['key-page', 'authority'],
  },
  'key-page': {
    id: 'key-page',
    term: 'Key page',
    category: 'Keys & signing',
    short: 'An ordered signer set inside a key book, with its own threshold and credit balance.',
    why: 'The actual list of keys that can authorize transactions, prioritized within the book.',
    see: ['key-book', 'threshold', 'credits', 'key-page-version'],
  },
  threshold: {
    id: 'threshold',
    term: 'Threshold (M-of-N)',
    category: 'Keys & signing',
    short: 'The minimum number of keys (M) out of the page’s keys (N) required to authorize a transaction. Shown as 2/3.',
    why: 'A 1/N page is a single point of failure — one stolen key gives full control. Higher M is harder to compromise.',
    see: ['multi-sig'],
  },
  'multi-sig': {
    id: 'multi-sig',
    term: 'Multi-sig vs single-sig',
    category: 'Keys & signing',
    short: 'Multi-sig = threshold of 2 or more keys must approve. Single-sig = threshold of 1.',
    why: 'Single-sig means one compromised key = full control. Multi-sig spreads control and limits the blast radius.',
    see: ['threshold'],
  },
  credits: {
    id: 'credits',
    term: 'Credits',
    category: 'Keys & signing',
    short: 'Non-transferable "fuel" (made by burning ACME) that a key page must hold to pay transaction fees.',
    why: 'A key page with zero credits cannot submit any transaction until it is funded.',
    see: ['acme', 'key-page'],
  },
  'key-page-version': {
    id: 'key-page-version',
    term: 'Key page version',
    category: 'Keys & signing',
    short: 'A counter that increments every time the page’s keys or threshold change.',
    why: 'High version churn can indicate active key rotation — or, unexpectedly, tampering worth investigating.',
  },
  'public-key-hash': {
    id: 'public-key-hash',
    term: 'Public key hash',
    category: 'Keys & signing',
    short: 'The on-chain hash of a public key registered in a key page (the key’s identity on the ledger).',
    why: 'Two pages holding the same public key hash are controlled by the same key — see key reuse.',
    see: ['key-reuse'],
  },
  authority: {
    id: 'authority',
    term: 'Authority',
    category: 'Authority & delegation',
    short: 'Who is permitted to sign for an account — the key book that governs it.',
    why: 'Authority is control. Auditing authorities reveals who can actually move an account’s assets.',
    see: ['key-book', 'implied-explicit'],
  },
  'implied-explicit': {
    id: 'implied-explicit',
    term: 'Implied vs explicit authority',
    category: 'Authority & delegation',
    short: "Implied = the account is governed by its ADI’s default key book (none separately attached). Explicit = a specific key book was deliberately assigned.",
    why: 'Implied control can shift as the directory changes; explicit grants are recorded directly and are easier to audit.',
    see: ['authority'],
  },
  delegation: {
    id: 'delegation',
    term: 'Delegation',
    category: 'Authority & delegation',
    short: 'A key page defers its signing power to another key book’s signers. Each delegation layer adds +0.01 credit per signature.',
    why: 'Enables shared or hierarchical control, but lengthens the trust chain — every link is another place a compromise can enter.',
    see: ['cross-adi'],
  },
  'cross-adi': {
    id: 'cross-adi',
    term: 'Cross-ADI authority',
    category: 'Authority & delegation',
    short: 'A key book in one ADI governs accounts owned by a different ADI.',
    why: 'Control crosses an identity boundary — powerful and legitimate for shared governance, but worth confirming it is intentional.',
    see: ['authority', 'delegation'],
  },
  'key-reuse': {
    id: 'key-reuse',
    term: 'Key reuse / shared key',
    category: 'Analytics',
    short: 'The same public key registered across multiple ADIs or key pages.',
    why: 'One compromised key compromises every identity that shares it. Independent keys per identity are far safer.',
    see: ['public-key-hash'],
  },
  gini: {
    id: 'gini',
    term: 'Gini coefficient & Lorenz curve',
    category: 'Analytics',
    short: 'Gini (0–1) summarizes how unequally account control is spread across authority books; the Lorenz curve plots it. 0 = perfectly even, 1 = one book controls everything.',
    why: 'High concentration means a few keyholders hold outsized control. Not inherently bad — but the top books deserve extra scrutiny.',
  },
  'crawl-coverage': {
    id: 'crawl-coverage',
    term: 'Crawl coverage',
    category: 'Analytics',
    short: 'The share of ADIs the crawler successfully scanned (done) versus those it could not (error).',
    why: 'A data-completeness measure for this snapshot — NOT a measure of the identities’ security or health.',
  },
};

export function getGlossary(id: string): GlossaryEntry | undefined {
  return GLOSSARY[id];
}

export const GLOSSARY_CATEGORIES: GlossaryCategory[] = [
  'Identities',
  'Accounts & tokens',
  'Keys & signing',
  'Authority & delegation',
  'Analytics',
];
