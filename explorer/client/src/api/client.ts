const BASE = '/api';

/** Error thrown by the API client, carrying the HTTP status (e.g. 404). */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `API error: ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.detail === 'string') detail = body.detail;
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail);
  }
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
  Intelligence, NetworkSummary, TopologyData, AuthorityFlows, KeyActivityTimeline, AdiReport,
  LiteAccount, LiteSummary, LiteDetail, LiteIntelligence, LiteCrossSurface
} from '../types';

export const api = {
  getStats: () => fetchJson<Stats>(`${BASE}/stats`),

  listAdis: (params: { root_only?: boolean; parent_url?: string; search?: string; page?: number; per_page?: number } = {}) =>
    fetchJson<PaginatedResponse<ADI>>(`${BASE}/adis${qs(params)}`),

  getAdi: (url: string) => fetchJson<ADI & { children: ADI[]; token_accounts: TokenAccount[]; data_accounts: DataAccount[]; key_books: KeyBook[]; token_issuers: TokenIssuer[]; authorities: AuthorityRecord[] }>(`${BASE}/adis/${encodeURIComponent(url)}`),

  getTree: (rootUrl?: string, maxDepth = 10) =>
    fetchJson<TreeNode[]>(`${BASE}/adis/tree${qs({ root_url: rootUrl, max_depth: maxDepth })}`),

  listTokenAccounts: (params: { adi_url?: string; token_url?: string; search?: string; page?: number; per_page?: number; sort?: string; dir?: 'asc' | 'desc' } = {}) =>
    fetchJson<PaginatedResponse<TokenAccount>>(`${BASE}/token-accounts${qs(params)}`),

  listDataAccounts: (params: { adi_url?: string; search?: string; page?: number; per_page?: number; sort?: string; dir?: 'asc' | 'desc' } = {}) =>
    fetchJson<PaginatedResponse<DataAccount>>(`${BASE}/data-accounts${qs(params)}`),

  listLiteAccounts: (params: { account_type?: string; token_url?: string; search?: string; page?: number; per_page?: number; sort?: string; dir?: 'asc' | 'desc' } = {}) =>
    fetchJson<PaginatedResponse<LiteAccount>>(`${BASE}/lite-accounts${qs(params)}`),

  getLiteSummary: () => fetchJson<LiteSummary>(`${BASE}/lite-accounts/summary`),

  getLiteDetail: (url: string) =>
    fetchJson<LiteDetail>(`${BASE}/lite-accounts/detail${qs({ url })}`),

  getLiteIntelligence: () =>
    fetchJson<LiteIntelligence>(`${BASE}/lite-accounts/intelligence`),

  getLiteCrossSurface: () =>
    fetchJson<LiteCrossSurface>(`${BASE}/lite-accounts/cross-surface`),

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

  getKeyTimeline: () => fetchJson<KeyActivityTimeline>(`${BASE}/key-activity-timeline`),

  getAdiReport: (url: string) => fetchJson<AdiReport>(`${BASE}/intelligence/adi-report${qs({ url })}`),

  getNetworkSummary: () => fetchJson<NetworkSummary>(`${BASE}/network/summary`),
  getTopology: (activeOnly = true) => fetchJson<TopologyData>(`${BASE}/network/topology${activeOnly ? '?active_only=true' : ''}`),
};
