const BASE = '/api';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') parts.push(`${k}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

import type {
  Stats, ADI, TreeNode, TokenAccount, DataAccount, TokenIssuer,
  KeyBook, KeyPage, PaginatedResponse, SearchResults, GraphData, AuthorityRecord,
  Intelligence, NetworkSummary, TopologyData, AuthorityFlows
} from '../types';

export const api = {
  getStats: () => fetchJson<Stats>(`${BASE}/stats`),

  listAdis: (params: { root_only?: boolean; parent_url?: string; search?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<ADI>>(`${BASE}/adis${qs(params)}`),

  getAdi: (url: string) => fetchJson<ADI & { children: ADI[]; token_accounts: TokenAccount[]; data_accounts: DataAccount[]; key_books: KeyBook[]; token_issuers: TokenIssuer[]; authorities: AuthorityRecord[] }>(`${BASE}/adis/${encodeURIComponent(url)}`),

  getTree: (rootUrl?: string, maxDepth = 10) =>
    fetchJson<TreeNode[]>(`${BASE}/adis/tree${qs({ root_url: rootUrl, max_depth: maxDepth })}`),

  listTokenAccounts: (params: { adi_url?: string; token_url?: string; search?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<TokenAccount>>(`${BASE}/token-accounts${qs(params)}`),

  listDataAccounts: (params: { adi_url?: string; search?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<DataAccount>>(`${BASE}/data-accounts${qs(params)}`),

  listTokenIssuers: () => fetchJson<TokenIssuer[]>(`${BASE}/token-issuers`),

  listKeyBooks: (params: { adi_url?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<KeyBook>>(`${BASE}/key-books${qs(params)}`),

  getKeyBook: (url: string) => fetchJson<KeyBook & { pages: KeyPage[]; authorities: AuthorityRecord[] }>(`${BASE}/key-books/${encodeURIComponent(url)}`),

  listKeyPages: (params: { key_book_url?: string; adi_url?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<KeyPage>>(`${BASE}/key-pages${qs(params)}`),

  listAuthorities: (params: { account_url?: string; authority_url?: string; implied_only?: boolean; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<AuthorityRecord>>(`${BASE}/authorities${qs(params)}`),

  getAuthorityGraph: (adiUrl?: string) =>
    fetchJson<GraphData>(`${BASE}/authorities/graph${qs({ adi_url: adiUrl })}`),

  getAuthorityFlows: () => fetchJson<AuthorityFlows>(`${BASE}/authorities/flows`),

  search: (q: string) => fetchJson<SearchResults>(`${BASE}/search${qs({ q })}`),

  getIntelligence: () => fetchJson<Intelligence>(`${BASE}/intelligence`),

  getNetworkSummary: () => fetchJson<NetworkSummary>(`${BASE}/network/summary`),
  getTopology: () => fetchJson<TopologyData>(`${BASE}/network/topology`),
};
