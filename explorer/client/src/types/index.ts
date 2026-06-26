export interface Authority {
  url: string;
  disabled: boolean;
}

export interface ADI {
  url: string;
  parent_url: string | null;
  authorities_json: Authority[];
  entry_count: number;
  crawl_status: string;
  error_message: string | null;
  children?: ADI[];
  token_accounts?: TokenAccount[];
  data_accounts?: DataAccount[];
  key_books?: KeyBook[];
  token_issuers?: TokenIssuer[];
  authorities?: AuthorityRecord[];
}

export interface TreeNode extends ADI {
  children: TreeNode[];
  token_count: number;
  data_count: number;
  book_count: number;
  depth: number;
}

export interface TokenAccount {
  url: string;
  adi_url: string;
  token_url: string;
  authorities_json: Authority[];
  authorities?: AuthorityRecord[];
}

export interface DataAccount {
  url: string;
  adi_url: string;
  authorities_json: Authority[];
}

export interface TokenIssuer {
  url: string;
  adi_url: string;
  symbol: string;
  precision: number;
  issued: string;
  supply_limit: string;
  authorities_json: Authority[];
}

export interface KeyBook {
  url: string;
  adi_url: string;
  page_count: number;
  authorities_json: Authority[];
  pages?: KeyPage[];
  authorities?: AuthorityRecord[];
}

export interface KeyPage {
  url: string;
  key_book_url: string;
  adi_url: string;
  version: number;
  threshold: number;
  accept_threshold: number;
  credit_balance: number;
  crawl_status: string;
  keys: KeyEntry[];
}

export interface KeyEntry {
  id: number;
  key_page_url: string;
  public_key_hash: string | null;
  public_key: string | null;
  delegate: string | null;
  last_used_on: number | null;
}

export interface AuthorityRecord {
  id: number;
  account_url: string;
  authority_url: string;
  is_implied: number;
  disabled: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface Stats {
  counts: Record<string, number>;
  adi_status: Record<string, number>;
  root_count: number;
  sub_count: number;
  token_distribution: { token_url: string; count: number }[];
  authority_stats: { explicit: number; implied: number };
  threshold_distribution: { threshold: number; count: number }[];
  top_adis: { url: string; entry_count: number; token_count: number; data_count: number }[];
  depth_distribution: { depth: number; count: number }[];
  meta?: { data_as_of: string | null; network: string };
}

export interface SearchResults {
  query: string;
  total: number;
  adis: ADI[];
  token_accounts: TokenAccount[];
  data_accounts: DataAccount[];
  key_books: KeyBook[];
  token_issuers: TokenIssuer[];
  lite_accounts?: { url: string; account_type?: string; token_url?: string | null }[];
}

export interface GraphData {
  nodes: { id: string; type: string }[];
  edges: { source: string; target: string; is_implied: boolean; disabled: boolean }[];
}

export interface NetworkSummary {
  counts: Record<string, number>;
  adi_status: Record<string, number>;
  root_count: number;
  sub_count: number;
  security: {
    total_pages: number;
    multi_sig: number;
    single_sig: number;
    zero_credit_pages: number;
    shared_key_count: number;
  };
  authority: {
    explicit: number;
    implied: number;
    cross_adi_books: number;
    delegation_count: number;
  };
  token_distribution: { token_url: string; count: number }[];
  top_key_reuse: { key_hash: string; adi_count: number }[];
  top_authority_books: { authority_url: string; governed_count: number }[];
  depth_distribution: { depth: number; count: number }[];
  top_adis: { url: string; entry_count: number; token_count: number; data_count: number }[];
  key_activity: { date: string; count: number }[];
}

export interface TopologyNode {
  id: string;
  parent_url: string | null;
  entry_count: number;
  crawl_status: string;
  token_count: number;
  data_count: number;
  book_count: number;
  account_total: number;
  /** Distinct other ADIs this node shares a signing key with (key-reuse degree). */
  shared_key_count?: number;
}

export interface TopologyEdge {
  source: string;
  target: string;
  type: 'hierarchy' | 'authority' | 'key_sharing' | 'delegation';
}

export interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

export interface Intelligence {
  key_reuse: { key_hash: string; adi_count: number; adi_urls: string[] }[];
  cross_authority: { authority_url: string; book_owner: string; governed_count: number; foreign_count: number }[];
  delegations: { delegate: string; delegator_adi: string; key_page: string; key_hash: string | null }[];
  token_economy: { url: string; symbol: string; precision: number; issued: string; supply_limit: string; adi_url: string; holder_count: number }[];
  acme_distribution: { total_acme_accounts: number; top_adis: { adi_url: string; acme_accounts: number }[] };
  authority_concentration: { authority_url: string; total_accounts: number; implied_count: number; explicit_count: number }[];
  key_security: { total_pages: number; single_sig: number; multi_sig: number; zero_credit_pages: number; avg_threshold: number };
  adi_security: { adi_url: string; total_pages: number; single_sig: number; multi_sig: number; no_credits: number }[];
  empty_adis: number;
  accounts_per_adi: { bucket: string; adi_count: number }[];
}

// Canonical lite type, derived server-side from the on-chain confirmed_type
// (falling back to URL-shape account_type). Prefer this over account_type.
export type LiteType = 'lite_identity' | 'lite_token_account' | 'lite_data_account';

export interface LiteAccount {
  url: string;
  account_type: 'lite_identity' | 'lite_token_account' | string;
  lite_type: LiteType | string;
  key_hash: string | null;
  token_url: string | null;
  lite_identity: string | null;
  source: string;
  balance?: number | null;
  credits?: number | null;
  confirmed_type?: string | null;
  enrich_status?: string | null;
}

export interface LiteSummary {
  total: number;
  by_type: Record<string, number>;
  top_tokens: { token_url: string; count: number }[];
  system_accounts: number;
  enriched?: number;
  total_acme_balance?: number;
  total_credits?: number;
  active?: number;
  dormant?: number;
}

export interface LiteIntelligence {
  acme: {
    gini: number;
    lorenz: { x: number; y: number }[];
    top_holders: { url: string; balance: number; lite_identity: string | null }[];
    holder_count: number;
    total: number;
  };
  credits: {
    gini: number;
    top_holders: { url: string; credits: number }[];
    holder_count: number;
    total: number;
  };
  wallets: {
    multi_account_keys: number;
    multi_token_keys: number;
    max_accounts: number;
    top: { key_hash: string; accounts: number; tokens: number; acme: number }[];
  };
  composition: { active: number; dormant: number; by_type: Record<string, number> };
  vs_adi: Record<string, number>;
}

export interface LiteCrossSurfaceKey {
  key_hash: string;
  acme: number;
  account_count: number;
  page_count: number;
  accounts: { url: string; lite_type: string; token_url: string | null; balance: number | null }[];
  adi_pages: string[];
}

export interface LiteCrossSurface {
  summary: { lite_keys: number; adi_pages: number; lite_accounts: number; acme_exposed: number };
  keys: LiteCrossSurfaceKey[];
}

export interface LiteSibling {
  url: string;
  lite_type: LiteType | string;
  token_url: string | null;
  balance?: number | null;
  credits?: number | null;
}

export interface LiteDetail {
  account: (LiteAccount & {
    first_seen_block?: number | null;
    enriched_at?: string | null;
  }) | null;
  siblings: LiteSibling[];
}

export interface AdiReportFinding {
  id: string;
  severity: 'high' | 'medium' | 'low' | 'ok';
  title: string;
  detail: string;
  fix: string;
}

export interface AdiReport {
  adi_url: string;
  score: number;
  grade: string;
  summary: string;
  findings: AdiReportFinding[];
  metrics: {
    total_pages: number; single_sig: number; multi_sig: number; zero_credit: number;
    avg_threshold: number; shared_keys: number; shared_with: string[]; max_cluster: number;
    implied_only: number; cross_adi: number; disabled_authorities: number;
    delegates_out: number; delegated_in: number;
    token_accounts: number; data_accounts: number; key_books: number;
  };
  benchmarks: { multi_sig_rate: number; network_multi_sig_rate: number };
}

export interface KeyActivityTimeline {
  total: number;
  recent: number;
  old: number;
  never: number;
  recent_window_days: number;
}

export interface AuthorityFlows {
  sankey_flows: { source: string; target: string; value: number; is_implied: boolean }[];
  chord_data: { source: string; target: string; value: number }[];
  delegations: { delegator_adi: string; key_page: string; delegate_book: string; key_hash: string | null }[];
  top_books: { authority_url: string; owner_adi: string; total_governed: number; implied: number; explicit: number }[];
}
