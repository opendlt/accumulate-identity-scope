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
}

export interface SearchResults {
  query: string;
  total: number;
  adis: ADI[];
  token_accounts: TokenAccount[];
  data_accounts: DataAccount[];
  key_books: KeyBook[];
  token_issuers: TokenIssuer[];
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
  key_security: { total_pages: number; single_sig: number; multi_sig: number; zero_credit_pages: number };
  empty_adis: number;
  accounts_per_adi: { bucket: string; adi_count: number }[];
}

export interface AuthorityFlows {
  sankey_flows: { source: string; target: string; value: number; is_implied: boolean }[];
  chord_data: { source: string; target: string; value: number }[];
  delegations: { delegator_adi: string; key_page: string; delegate_book: string; key_hash: string | null }[];
  top_books: { authority_url: string; owner_adi: string; total_governed: number; implied: number; explicit: number }[];
}
