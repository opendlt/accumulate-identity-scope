import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { ResponsiveTreeMap } from '@nivo/treemap';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { StatOrb } from './ui/StatOrb';
import { RingGauge } from './ui/RingGauge';
import { PageLoader } from './ui/PageLoader';
import { HeatStrip } from './ui/HeatStrip';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { ExportButton, toCSV } from './ui/ExportButton';
import { EmptyState } from './ui/EmptyState';
import { getEntityColor } from '../hooks/useEntityColor';
import { useTheme } from '../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../hooks/useThemeColors';
import { InfoTip, TermLabel } from './ui/InfoTip';

function shortUrl(url: string) { return url.replace('acc://', ''); }
/* Lite-account URLs are long hex key hashes — middle-truncate for the table so
   they stay on one line; the full (acc://-stripped) value goes in the title. */
function shortLite(url: string) {
  const s = shortUrl(url);
  return s.length > 28 ? `${s.slice(0, 14)}…${s.slice(-10)}` : s;
}

/* ─── Lite-type presentation ──────────────────── */
/* Drives label + badge color from the CANONICAL lite_type (which already folds
   the on-chain confirmed_type in — so lite data accounts read correctly instead
   of masquerading as identities). */
const LITE_TYPE_META: Record<string, { label: string; variant: 'token' | 'data' | 'key'; dot: string }> = {
  lite_identity:      { label: 'Lite identity',      variant: 'key',   dot: '#34d399' },
  lite_token_account: { label: 'Lite token',         variant: 'token', dot: '#22d3ee' },
  lite_data_account:  { label: 'Lite data',          variant: 'data',  dot: '#a78bfa' },
};
function liteMeta(t: string | undefined) {
  return (t && LITE_TYPE_META[t]) || { label: t || 'Lite', variant: 'key' as const, dot: '#34d399' };
}

/* Denomination-aware balance string. ACME has precision 8 (raw/1e8); other
   tokens have unknown precision, so their raw integer balance is shown verbatim
   with the token symbol. Credits (lite identities) are shown when there is no
   token balance. Returns '—' when there is nothing to show. */
function formatLiteValue(a: { token_url?: string | null; balance?: number | null; credits?: number | null }): string {
  if (a.balance !== undefined && a.balance !== null) {
    if (a.token_url === 'acc://ACME') {
      return `${(a.balance / 1e8).toLocaleString(undefined, { maximumFractionDigits: 4 })} ACME`;
    }
    const sym = a.token_url ? ` ${shortUrl(a.token_url).split('/').pop()}` : '';
    return `${a.balance.toLocaleString()}${sym}`;
  }
  if (a.credits !== undefined && a.credits !== null && a.credits > 0) {
    return `${a.credits.toLocaleString()} credits`;
  }
  return '—';
}

/* ─── Main Component ─────────────────────────── */

/* Leaf datum carried through nivo so click/tooltip can recover the full ADI url. */
interface TreemapLeaf { id: string; fullUrl: string; count: number; color: string }
interface TreemapRoot { id: string; children: TreemapLeaf[] }

export function AccountsBrowser() {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const [params, setParams] = useSearchParams();
  const initialTab = (['token', 'data', 'issuers', 'lite'] as const).includes(params.get('tab') as any)
    ? (params.get('tab') as 'token' | 'data' | 'issuers' | 'lite') : 'token';
  const [tab, setTabState] = useState<'token' | 'data' | 'issuers' | 'lite'>(initialTab);
  const setTab = useCallback((t: 'token' | 'data' | 'issuers' | 'lite') => {
    setTabState(t);
    // Switching tabs can otherwise leave you on a stale high page.
    setPage(1);
    setDataPage(1);
    setLitePage(1);
    setParams(prev => { prev.set('tab', t); return prev; }, { replace: true });
  }, [setParams]);
  const [page, setPage] = useState(1);
  const [dataPage, setDataPage] = useState(1);
  const [litePage, setLitePage] = useState(1);
  const [liteType, setLiteType] = useState('');
  const [liteTokenFilter, setLiteTokenFilter] = useState('');
  // Full URL of the lite account whose detail drawer is open (null = closed).
  const [liteDetailUrl, setLiteDetailUrl] = useState<string | null>(null);
  const [tokenFilter, setTokenFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState(params.get('search') || '');
  const [adiFilter, setAdiFilter] = useState('');
  const [sortCol, setSortCol] = useState<string>('url');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const perPage = 50;

  // Map clickable header keys to real DB column names accepted by the API.
  const TOKEN_SORT_COLS: Record<string, string> = { url: 'url', adi: 'adi_url', token: 'token_url' };
  const DATA_SORT_COLS: Record<string, string> = { url: 'url', adi: 'adi_url' };
  const LITE_SORT_COLS: Record<string, string> = { url: 'url', token: 'token_url', balance: 'balance' };
  const sortDirStr: 'asc' | 'desc' = sortDir === 1 ? 'asc' : 'desc';
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, staleTime: 120000 });
  const { data: issuers } = useQuery({ queryKey: ['token-issuers'], queryFn: api.listTokenIssuers });
  const { data: intel } = useQuery({ queryKey: ['intelligence'], queryFn: api.getIntelligence, staleTime: 300000 });
  const { data: liteSummary } = useQuery({ queryKey: ['lite-summary'], queryFn: api.getLiteSummary, staleTime: 300000 });

  const { data: tokenData, isLoading: tokensLoading } = useQuery({
    queryKey: ['token-accounts', tokenFilter, searchFilter, page, sortCol, sortDir],
    queryFn: () => api.listTokenAccounts({
      token_url: tokenFilter || undefined,
      search: searchFilter || undefined,
      page, per_page: perPage,
      sort: TOKEN_SORT_COLS[sortCol] || 'url',
      dir: sortDirStr,
    }),
    enabled: tab === 'token',
  });

  const { data: dataData, isLoading: dataLoading } = useQuery({
    queryKey: ['data-accounts', searchFilter, dataPage, sortCol, sortDir],
    queryFn: () => api.listDataAccounts({
      search: searchFilter || undefined,
      page: dataPage, per_page: perPage,
      sort: DATA_SORT_COLS[sortCol] || 'url',
      dir: sortDirStr,
    }),
    enabled: tab === 'data',
  });

  const { data: liteData, isLoading: liteLoading } = useQuery({
    queryKey: ['lite-accounts', liteType, liteTokenFilter, searchFilter, litePage, sortCol, sortDir],
    queryFn: () => api.listLiteAccounts({
      account_type: liteType || undefined,
      token_url: liteTokenFilter || undefined,
      search: searchFilter || undefined,
      page: litePage, per_page: perPage,
      sort: LITE_SORT_COLS[sortCol] || 'url',
      dir: sortDirStr,
    }),
    enabled: tab === 'lite',
  });

  // Build treemap data: top ADIs by token account count. Tiles are colored
  // from the on-theme entity palette (CSS-var driven via getEntityColor) so the
  // chart stays dark/light aware. Cycled so adjacent tiles stay distinguishable.
  const TREEMAP_PALETTE = useMemo(
    () => (['token', 'adi', 'data', 'issuer', 'authority', 'key', 'danger', 'success'] as const)
      .map(e => getEntityColor(e).color),
    [],
  );

  const treemapRoot = useMemo<TreemapRoot>(() => {
    if (!intel) return { id: 'ADIs', children: [] };
    const children: TreemapLeaf[] = intel.acme_distribution.top_adis.slice(0, 12).map((a, i) => ({
      id: shortUrl(a.adi_url).slice(0, 18),
      fullUrl: a.adi_url,
      count: a.acme_accounts,
      color: TREEMAP_PALETTE[i % TREEMAP_PALETTE.length],
    }));
    return { id: 'ADIs', children };
  }, [intel, TREEMAP_PALETTE]);

  const hasTreemap = treemapRoot.children.length > 0;

  const handleTreemapClick = useCallback((adiUrl: string) => {
    setAdiFilter(adiUrl);
    setSearchFilter(adiUrl);
    setPage(1);
    setTab('token');
  }, []);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(1); }
    // Sort changed → return to first page on all tables.
    setPage(1);
    setDataPage(1);
    setLitePage(1);
  }, [sortCol]);

  const tabCounts = {
    token: tokenData?.total ?? stats?.counts.token_accounts ?? 0,
    data: dataData?.total ?? stats?.counts.data_accounts ?? 0,
    issuers: issuers?.length ?? stats?.counts.token_issuers ?? 0,
    lite: liteSummary?.total ?? stats?.counts.lite_accounts ?? 0,
  };

  return (
    <div className="accounts-observatory">

      {/* ── View intro: plain-language framing for this view. ── */}
      <div className="view-intro">
        <div className="view-intro__title">Accounts</div>
        <div className="view-intro__lead">
          Every token, data, and lite account on the network, plus the issuers that mint each token.
        </div>
        <div className="view-intro__audience">for builders &amp; analysts</div>
      </div>

      {/* ── 4A. Summary Strip ── */}
      {stats && (
        <GlassCard gradientTop delay={0}>
          <div className="accounts-summary-strip">
            <StatOrb value={stats.counts.token_accounts} label="Token Accounts"
              {...getEntityColor('token')} delay={0} />
            <StatOrb value={stats.counts.data_accounts} label="Data Accounts"
              {...getEntityColor('data')} delay={0.05} />
            <StatOrb value={stats.counts.token_issuers || 0} label="Token Issuers"
              {...getEntityColor('issuer')} delay={0.1} />
            {/* Lite accounts are the largest account class — show them here too,
                not just as a tab, so the summary reflects the full picture. */}
            <StatOrb value={liteSummary?.total ?? stats.counts.lite_accounts ?? 0} label="Lite Accounts"
              {...getEntityColor('key')} delay={0.15} />
          </div>
          {stats.token_distribution.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Token Distribution
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                  {stats.token_distribution.length} types
                </span>
              </div>
              <HeatStrip segments={stats.token_distribution.map((t, i) => ({
                value: t.count,
                color: ['#22d3ee', '#6c8cff', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#ef4444'][i % 7],
                label: shortUrl(t.token_url),
              }))} height={10} />
              <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                {stats.token_distribution.map((t, i) => (
                  <span key={t.token_url} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: ['#22d3ee', '#6c8cff', '#a78bfa', '#f472b6', '#f59e0b', '#34d399', '#ef4444'][i % 7],
                    }} />
                    {shortUrl(t.token_url)} ({t.count})
                  </span>
                ))}
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* ── 4B. ADI Distribution Treemap (top ADIs by token-account count) ── */}
      {hasTreemap && tab === 'token' && (
        <GlassCard title="Token Accounts by ADI" delay={0.08}>
          {/* Real treemap: tiles sized by token-account count, colored from the
              theme entity palette. Clicking a tile filters the table by that ADI. */}
          <div className="accounts-treemap" style={{ height: 220 }}>
            <ResponsiveTreeMap<TreemapRoot | TreemapLeaf>
              data={treemapRoot}
              identity="id"
              value="count"
              valueFormat=">-,"
              leavesOnly
              tile="squarify"
              innerPadding={3}
              outerPadding={0}
              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              label={(node) => `${node.id} (${node.value})`}
              labelSkipSize={26}
              orientLabel={false}
              colors={(node: any) => node.data.color}
              borderWidth={1}
              borderColor={{ from: 'color', modifiers: [['darker', isDark ? 0.6 : 0.2]] }}
              nodeOpacity={isDark ? 0.85 : 0.9}
              labelTextColor={{ from: 'color', modifiers: [['darker', 2.6]] }}
              theme={{
                text: { fontFamily: 'var(--font-mono)', fontSize: 10, fill: themeColors.canvasText },
                tooltip: { container: getTooltipStyle(isDark) },
              }}
              tooltip={({ node }) => (
                <div style={{ ...getTooltipStyle(isDark), padding: '6px 10px' }}>
                  <strong>{shortUrl((node.data as TreemapLeaf).fullUrl ?? node.id)}</strong>
                  {' '}— {node.value} accounts
                </div>
              )}
              onClick={(node) => {
                const leaf = node.data as TreemapLeaf;
                if (leaf.fullUrl) handleTreemapClick(leaf.fullUrl);
              }}
              role="application"
              ariaLabel="Token accounts by ADI treemap. Click a tile to filter the table by that ADI."
            />
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.3 }}>
            Tile size = number of token accounts under that identity. Click a tile to filter the table.
          </div>
          {adiFilter && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <GlowBadge variant="token">Filtered: {shortUrl(adiFilter)}</GlowBadge>
              <button className="accounts-clear-btn" onClick={() => { setAdiFilter(''); setSearchFilter(''); }}>
                Clear filter
              </button>
            </div>
          )}
        </GlassCard>
      )}

      {/* ── Tabs ── */}
      <div className="accounts-tabs">
        {([
          { id: 'token' as const, label: 'Token Accounts', term: 'token-account', icon: '\u25CF', color: '#22d3ee' },
          { id: 'data' as const, label: 'Data Accounts', term: 'data-account', icon: '\u25A0', color: '#a78bfa' },
          { id: 'issuers' as const, label: 'Token Issuers', term: 'token-issuer', icon: '\u25C6', color: '#f472b6' },
          { id: 'lite' as const, label: 'Lite Accounts', term: 'lite-account', icon: '\u25C8', color: '#34d399' },
        ]).map(t => (
          <button
            key={t.id}
            className={`accounts-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span style={{ color: tab === t.id ? t.color : undefined }}>{t.icon}</span>
            {t.label}
            <InfoTip term={t.term} />
            <span className="accounts-tab-count">{tabCounts[t.id]}</span>
          </button>
        ))}
      </div>

      {/* ── Filter Bar ── */}
      <div className="accounts-filter-bar">
        <input
          placeholder="Search by URL..."
          value={searchFilter}
          onChange={e => { setSearchFilter(e.target.value); setPage(1); setDataPage(1); }}
          className="accounts-filter-input"
        />
        {tab === 'token' && tokenData && tokenData.items.length > 0 && (
          <ExportButton
            filename="token-accounts"
            onExportCSV={() => toCSV(tokenData.items.map(a => ({ url: a.url, adi_url: a.adi_url, token_url: a.token_url })))}
          />
        )}
        {tab === 'data' && dataData && dataData.items.length > 0 && (
          <ExportButton
            filename="data-accounts"
            onExportCSV={() => toCSV(dataData.items.map(a => ({ url: a.url, adi_url: a.adi_url })))}
          />
        )}
        {tab === 'lite' && liteData && liteData.items.length > 0 && (
          <ExportButton
            filename="lite-accounts"
            onExportCSV={() => toCSV(liteData.items.map(a => ({ url: a.url, account_type: a.account_type, token_url: a.token_url })))}
          />
        )}
        {tab === 'token' && (
          <select
            value={tokenFilter}
            onChange={e => { setTokenFilter(e.target.value); setPage(1); }}
            className="accounts-filter-select"
          >
            <option value="">All token types</option>
            <option value="acc://ACME">ACME</option>
            {issuers?.map(i => (
              <option key={i.url} value={i.url}>{i.symbol} ({shortUrl(i.url)})</option>
            ))}
          </select>
        )}
        {tab === 'lite' && (
          <>
            <select
              value={liteType}
              onChange={e => { setLiteType(e.target.value); setLitePage(1); }}
              className="accounts-filter-select"
            >
              <option value="">All lite accounts</option>
              <option value="lite_identity">Lite identities</option>
              <option value="lite_token_account">Lite token accounts</option>
              <option value="lite_data_account">Lite data accounts</option>
            </select>
            <select
              value={liteTokenFilter}
              onChange={e => { setLiteTokenFilter(e.target.value); setLitePage(1); }}
              className="accounts-filter-select"
              title="Scope to one token so a Balance sort ranks true holdings"
            >
              <option value="">All tokens</option>
              <option value="acc://ACME">ACME</option>
              {issuers?.map(i => (
                <option key={i.url} value={i.url}>{i.symbol} ({shortUrl(i.url)})</option>
              ))}
            </select>
          </>
        )}
      </div>

      {/* ── Tab Content ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'token' && (
            <GlassCard delay={0.1}>
              {tokensLoading ? (
                <PageLoader message="Loading token accounts..." />
              ) : tokenData && tokenData.items.length === 0 ? (
                <EmptyState icon={'\u25A3'} title={searchFilter ? 'No matching token accounts' : 'No token accounts found'} description={searchFilter ? `No token accounts match your filter "${searchFilter}".` : 'No token accounts in the database. Token accounts hold a balance of a specific token.'} compact />
              ) : tokenData && (
                <>
                  <div className="accounts-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <SortableHeader col="url" label="Account URL" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortableHeader col="adi" label="ADI" term="adi" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortableHeader col="token" label="Token Type" term="token-account" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {tokenData.items.map(a => (
                          <tr key={a.url} className="accounts-row accounts-row--token">
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="accounts-type-dot" style={{ background: '#22d3ee' }} />
                                <span className="url-link">{shortUrl(a.url)}</span>
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                              {shortUrl(a.adi_url)}
                            </td>
                            <td><GlowBadge variant="token">{shortUrl(a.token_url)}</GlowBadge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="accounts-footer">
                    <span className="accounts-showing">
                      Showing {(page - 1) * perPage + 1}-{Math.min(page * perPage, tokenData.total)} of {tokenData.total}
                    </span>
                    <Pagination page={page} total={tokenData.total} perPage={perPage} onChange={setPage} />
                  </div>
                </>
              )}
            </GlassCard>
          )}

          {tab === 'data' && (
            <GlassCard delay={0.1}>
              {dataLoading ? (
                <PageLoader message="Loading data accounts..." />
              ) : dataData && dataData.items.length === 0 ? (
                <EmptyState icon={'\u25A2'} title={searchFilter ? 'No matching data accounts' : 'No data accounts found'} description={searchFilter ? `No data accounts match your filter "${searchFilter}".` : 'No data accounts found \u2014 data accounts store on-chain records and hold no token balance.'} compact />
              ) : dataData && (
                <>
                  <div className="accounts-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <SortableHeader col="url" label="Account URL" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortableHeader col="adi" label="ADI" term="adi" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {dataData.items.map(a => (
                          <tr key={a.url} className="accounts-row accounts-row--data">
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span className="accounts-type-dot" style={{ background: '#a78bfa' }} />
                                <span className="url-link">{shortUrl(a.url)}</span>
                              </div>
                            </td>
                            <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                              {shortUrl(a.adi_url)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="accounts-footer">
                    <span className="accounts-showing">
                      Showing {(dataPage - 1) * perPage + 1}-{Math.min(dataPage * perPage, dataData.total)} of {dataData.total}
                    </span>
                    <Pagination page={dataPage} total={dataData.total} perPage={perPage} onChange={setDataPage} />
                  </div>
                </>
              )}
            </GlassCard>
          )}

          {tab === 'lite' && (
            <GlassCard delay={0.1}>
              {/* One-line framing; the InfoTip on the tab carries the full definition. */}
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                Key-hash-addressed accounts not registered under any ADI — the default wallet primitive and the largest account class on Accumulate.
              </div>

              {/* Live-balance enrichment progress, shown only once the enricher has
                  populated some on-chain balances (may be partial / in progress). */}
              {liteSummary && liteSummary.enriched !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
                  {liteSummary.enriched.toLocaleString()} of {liteSummary.total.toLocaleString()} enriched with live state
                  {liteSummary.total_acme_balance !== undefined && (
                    <> · <strong style={{ color: 'var(--text-secondary)' }}>{(liteSummary.total_acme_balance / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 })} ACME</strong> held</>
                  )}
                  {liteSummary.total_credits ? (
                    <> · <strong style={{ color: 'var(--text-secondary)' }}>{liteSummary.total_credits.toLocaleString()}</strong> credits</>
                  ) : null}
                  {liteSummary.active !== undefined && (
                    <> · {liteSummary.active.toLocaleString()} active / {(liteSummary.dormant ?? 0).toLocaleString()} dormant</>
                  )}
                </div>
              )}

              {/* Optional: top-token distribution from the lite summary, rendered
                  with the same heat-strip + legend treatment as the token strip above. */}
              {liteSummary && liteSummary.top_tokens.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Lite Token Accounts by Token
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                      {liteSummary.top_tokens.length} tokens
                    </span>
                  </div>
                  <HeatStrip segments={liteSummary.top_tokens.map((t, i) => ({
                    value: t.count,
                    color: ['#34d399', '#22d3ee', '#6c8cff', '#a78bfa', '#f472b6', '#f59e0b', '#ef4444'][i % 7],
                    label: shortUrl(t.token_url),
                  }))} height={10} />
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                    {liteSummary.top_tokens.map((t, i) => (
                      <span key={t.token_url} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                        <span style={{
                          width: 6, height: 6, borderRadius: '50%',
                          background: ['#34d399', '#22d3ee', '#6c8cff', '#a78bfa', '#f472b6', '#f59e0b', '#ef4444'][i % 7],
                        }} />
                        {shortUrl(t.token_url)} ({t.count})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Honest caption: a Balance sort across mixed tokens isn't
                  apples-to-apples (raw integer balances differ by token precision).
                  Nudge the user to scope to one token; ACME holdings dominate value. */}
              {sortCol === 'balance' && !liteTokenFilter && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8, lineHeight: 1.4 }}>
                  Balances span multiple tokens with different precision — pick a token above to rank true holdings.
                </div>
              )}

              {liteLoading ? (
                <PageLoader message="Loading lite accounts..." />
              ) : liteData && liteData.items.length === 0 ? (
                <EmptyState icon={'◈'} title={searchFilter || liteType || liteTokenFilter ? 'No matching lite accounts' : 'No lite accounts found'} description={searchFilter || liteType || liteTokenFilter ? 'No lite accounts match your filter.' : 'No lite accounts in the database. Lite accounts are key-hash-addressed accounts not registered under any ADI.'} compact />
              ) : liteData && (
                <>
                  <div className="accounts-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <SortableHeader col="url" label="Account URL" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <th>Type</th>
                          <SortableHeader col="token" label="Token" term="token-account" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                          <SortableHeader col="balance" label="Balance / Credits" align="right" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {liteData.items.map(a => {
                          const meta = liteMeta(a.lite_type);
                          const open = () => setLiteDetailUrl(a.url);
                          return (
                            <tr
                              key={a.url}
                              className="accounts-row accounts-row--lite risk-row-clickable"
                              role="button"
                              tabIndex={0}
                              aria-label={`Inspect ${shortUrl(a.url)}`}
                              title="Click to inspect this account and the others under its key"
                              style={{ cursor: 'pointer' }}
                              onClick={open}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
                            >
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span className="accounts-type-dot" style={{ background: meta.dot }} />
                                  <span className="url-link" title={shortUrl(a.url)}>{shortLite(a.url)}</span>
                                </div>
                              </td>
                              <td>
                                <GlowBadge variant={meta.variant}>{meta.label}</GlowBadge>
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>
                                {a.token_url ? shortUrl(a.token_url) : '—'}
                              </td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
                                {formatLiteValue(a)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="accounts-footer">
                    <span className="accounts-showing">
                      Showing {(litePage - 1) * perPage + 1}-{Math.min(litePage * perPage, liteData.total)} of {liteData.total}
                    </span>
                    <Pagination page={litePage} total={liteData.total} perPage={perPage} onChange={setLitePage} />
                  </div>
                </>
              )}
            </GlassCard>
          )}

          {tab === 'issuers' && issuers && (
            <div className="issuers-observatory-grid">
              {issuers.map(t => (
                <IssuerCard key={t.url} issuer={t} intel={intel} onViewHolders={(tokenUrl) => {
                  setTokenFilter(tokenUrl);
                  setTab('token');
                  setPage(1);
                }} />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Lite-account detail drawer (Phase F): full state + the sibling accounts
          sharing this account's key hash (one key = one "wallet"). */}
      <LiteDetailDrawer
        url={liteDetailUrl}
        onClose={() => setLiteDetailUrl(null)}
        onSelect={setLiteDetailUrl}
      />
    </div>
  );
}

/* ─── Lite Account Detail Drawer ──────────────── */

function DrawerFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>{children}</span>
    </div>
  );
}

function LiteDetailDrawer({ url, onClose, onSelect }: {
  url: string | null;
  onClose: () => void;
  onSelect: (u: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['lite-detail', url],
    queryFn: () => api.getLiteDetail(url!),
    enabled: !!url,
  });

  // Escape closes the drawer.
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, onClose]);

  const account = data?.account ?? null;
  const siblings = data?.siblings ?? [];
  const meta = account ? liteMeta(account.lite_type) : null;

  return (
    <AnimatePresence>
      {url && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(2px)', zIndex: 200,
            }}
          />
          <motion.div
            role="dialog"
            aria-label="Lite account detail"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={{
              position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(440px, 92vw)',
              background: 'var(--bg-surface)', borderLeft: '1px solid var(--border-subtle)',
              boxShadow: '-16px 0 48px rgba(0,0,0,0.4)', zIndex: 201,
              display: 'flex', flexDirection: 'column', overflowY: 'auto',
            }}
          >
            {/* Header */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)',
              position: 'sticky', top: 0, background: 'var(--bg-surface)', zIndex: 1,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Lite Account
              </span>
              <button className="accounts-clear-btn" onClick={onClose} aria-label="Close">Close ✕</button>
            </div>

            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {isLoading ? (
                <PageLoader message="Loading account state…" />
              ) : !account ? (
                <EmptyState icon={'◈'} title="Account not found" description="This lite account is not in the explorer database." compact />
              ) : (
                <>
                  {/* Identity block */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="accounts-type-dot" style={{ background: meta!.dot }} />
                      <GlowBadge variant={meta!.variant}>{meta!.label}</GlowBadge>
                      {account.confirmed_type && account.confirmed_type !== account.lite_type && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>on-chain: {account.confirmed_type}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                      {account.url}
                    </div>
                  </div>

                  {/* Headline value */}
                  <div style={{
                    padding: '14px 16px', borderRadius: 12, background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      {formatLiteValue(account)}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {account.lite_type === 'lite_identity' ? 'credit balance' : account.lite_type === 'lite_data_account' ? 'data account — holds no token balance' : 'token balance'}
                    </div>
                  </div>

                  {/* Facts grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                    {account.token_url && <DrawerFact label="Token">{shortUrl(account.token_url)}</DrawerFact>}
                    {account.credits != null && account.credits > 0 && (
                      <DrawerFact label="Credits">{account.credits.toLocaleString()}</DrawerFact>
                    )}
                    {account.first_seen_block != null && (
                      <DrawerFact label="First seen block">{account.first_seen_block.toLocaleString()}</DrawerFact>
                    )}
                    {account.enrich_status && <DrawerFact label="Enrich status">{account.enrich_status}</DrawerFact>}
                    <DrawerFact label="Source">{account.source}</DrawerFact>
                    {account.key_hash && <DrawerFact label="Key hash">{account.key_hash}</DrawerFact>}
                  </div>

                  {/* Siblings — the rest of this key's "wallet" */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                      {siblings.length > 0
                        ? `${siblings.length} other account${siblings.length === 1 ? '' : 's'} under this key`
                        : 'No other accounts under this key'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', lineHeight: 1.4, marginTop: -4 }}>
                      A lite key hash addresses one identity plus any token and data accounts it controls — together, one wallet.
                    </div>
                    {siblings.map(s => {
                      const sm = liteMeta(s.lite_type);
                      return (
                        <button
                          key={s.url}
                          onClick={() => onSelect(s.url)}
                          style={{
                            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-subtle)',
                          }}
                        >
                          <span className="accounts-type-dot" style={{ background: sm.dot }} />
                          <GlowBadge variant={sm.variant}>{sm.label}</GlowBadge>
                          <span style={{ flex: 1, fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                            {shortLite(s.url)}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>
                            {formatLiteValue(s)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─── Issuer Card ─────────────────────────────── */

interface IssuerCardProps {
  issuer: { url: string; adi_url: string; symbol: string; precision: number; issued: string; supply_limit: string };
  intel: any;
  onViewHolders: (tokenUrl: string) => void;
}

function IssuerCard({ issuer, intel, onViewHolders }: IssuerCardProps) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const issued = parseFloat(issuer.issued) || 0;
  const limit = parseFloat(issuer.supply_limit) || 0;
  const utilization = limit > 0 ? issued / limit : 0;

  // Get holder data from intelligence
  const holderData = intel?.token_economy?.find((t: any) => t.url === issuer.url);
  const holderCount = holderData?.holder_count || 0;

  // Top ADIs holding this token
  const topHolders = intel?.acme_distribution?.top_adis?.slice(0, 5) || [];

  return (
    <GlassCard delay={0.15} style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Accent stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 3,
        background: 'linear-gradient(90deg, #f472b6, #a78bfa)',
        borderRadius: '16px 16px 0 0',
      }} />

      <div style={{ padding: '8px 0 0' }}>
        {/* Header */}
        <div className="issuer-obs-header">
          <div className="issuer-obs-symbol-wrap">
            <span className="issuer-obs-symbol">{issuer.symbol}</span>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
              {shortUrl(issuer.url)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
              Owner: {shortUrl(issuer.adi_url)}
            </div>
          </div>
          <GlowBadge variant="issuer">{issuer.symbol}</GlowBadge>
        </div>

        {/* Stats + Gauge */}
        <div className="issuer-obs-body">
          <div className="issuer-obs-gauge" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            {limit > 0 ? (
              <>
                <RingGauge
                  value={utilization}
                  size={72}
                  strokeWidth={5}
                  /* Minting toward max supply is scarcity, not danger \u2014 use a
                     neutral brand ramp (token\u2192adi) instead of green/amber/red. */
                  color={utilization > 0.5 ? getEntityColor('token').color : getEntityColor('adi').color}
                  valueLabel={`${(utilization * 100).toFixed(0)}%`}
                  label="minted"
                />
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', textAlign: 'center', lineHeight: 1.2 }}>
                  % of max supply minted
                </div>
              </>
            ) : (
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', fontSize: 10, color: 'var(--text-tertiary)',
              }}>
                <div style={{ fontSize: 18 }}>{'\u221E'}</div>
                <div>No cap</div>
              </div>
            )}
          </div>
          <div className="issuer-obs-stats">
            <div className="issuer-obs-stat-row">
              <TermLabel term="precision">Precision</TermLabel>
              <strong>{issuer.precision}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <TermLabel term="token-issuer">Issued ({issuer.symbol})</TermLabel>
              <strong>{Number(issued).toLocaleString()}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <TermLabel term="token-issuer">Supply Limit</TermLabel>
              <strong>{limit > 0 ? Number(limit).toLocaleString() : 'Unlimited'}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <TermLabel term="token-account">Holder accounts</TermLabel>
              <strong style={{ color: '#22d3ee' }}><AnimatedCounter value={holderCount} /></strong>
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-tertiary)', lineHeight: 1.3, marginTop: 2 }}>
              Distinct token accounts holding a balance of this token.
            </div>
          </div>
        </div>

        {/* Top holders bar chart */}
        {holderCount > 0 && topHolders.length > 0 && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Top ADIs by Token Holdings
            </div>
            <ResponsiveContainer width="100%" height={80} minWidth={0}>
              <BarChart data={topHolders.slice(0, 5).map((h: any) => ({
                name: shortUrl(h.adi_url).slice(0, 14),
                count: h.acme_accounts,
              }))} layout="vertical">
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: themeColors.canvasTextDim, fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={getTooltipStyle(isDark)} />
                <Bar dataKey="count" fill="#f472b6" radius={[0, 4, 4, 0]} barSize={8} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Jumps to the Token Accounts tab filtered to this token — i.e. it
            shows that token's accounts, not a verified non-zero holder set. */}
        <button
          className="issuer-obs-view-btn"
          onClick={() => onViewHolders(issuer.url)}
        >
          View token accounts
        </button>
      </div>
    </GlassCard>
  );
}

/* ─── Sortable Table Header ───────────────────── */

/**
 * A keyboard-operable sortable column header. Renders a real <button> inside
 * the <th> (so Enter/Space activate it natively) and exposes `aria-sort` on the
 * cell for screen readers. Shared by the token and data tables.
 */
function SortableHeader({ col, label, term, align, sortCol, sortDir, onSort }: {
  col: string;
  label: string;
  term?: string;
  align?: 'left' | 'right';
  sortCol: string;
  sortDir: 1 | -1;
  onSort: (col: string) => void;
}) {
  const active = sortCol === col;
  const ariaSort: 'ascending' | 'descending' | 'none' =
    active ? (sortDir === 1 ? 'ascending' : 'descending') : 'none';
  return (
    <th className="sortable-th" aria-sort={ariaSort} style={align === 'right' ? { textAlign: 'right' } : undefined}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          onClick={() => onSort(col)}
          aria-label={`Sort by ${label}${active ? (sortDir === 1 ? ', ascending' : ', descending') : ''}`}
          style={{
            all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'center',
            gap: 4, font: 'inherit', color: 'inherit', letterSpacing: 'inherit',
          }}
        >
          {label} {active && (sortDir === 1 ? '▲' : '▼')}
        </button>
        {term && <InfoTip term={term} />}
      </span>
    </th>
  );
}

/* ─── Pagination ──────────────────────────────── */

function Pagination({ page, total, perPage, onChange }: {
  page: number; total: number; perPage: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / perPage);
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      <span>Page {page} of {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}
