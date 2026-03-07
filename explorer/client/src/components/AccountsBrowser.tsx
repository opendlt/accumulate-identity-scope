import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
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

function shortUrl(url: string) { return url.replace('acc://', ''); }

/* ─── Main Component ─────────────────────────── */

export function AccountsBrowser() {
  const [params, setParams] = useSearchParams();
  const initialTab = (['token', 'data', 'issuers'] as const).includes(params.get('tab') as any)
    ? (params.get('tab') as 'token' | 'data' | 'issuers') : 'token';
  const [tab, setTabState] = useState<'token' | 'data' | 'issuers'>(initialTab);
  const setTab = useCallback((t: 'token' | 'data' | 'issuers') => {
    setTabState(t);
    setParams(prev => { prev.set('tab', t); return prev; }, { replace: true });
  }, [setParams]);
  const [page, setPage] = useState(1);
  const [dataPage, setDataPage] = useState(1);
  const [tokenFilter, setTokenFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState(params.get('search') || '');
  const [adiFilter, setAdiFilter] = useState('');
  const [sortCol, setSortCol] = useState<string>('url');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const perPage = 50;
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, staleTime: 120000 });
  const { data: issuers } = useQuery({ queryKey: ['token-issuers'], queryFn: api.listTokenIssuers });
  const { data: intel } = useQuery({ queryKey: ['intelligence'], queryFn: api.getIntelligence, staleTime: 300000 });

  const { data: tokenData, isLoading: tokensLoading } = useQuery({
    queryKey: ['token-accounts', tokenFilter, searchFilter, page],
    queryFn: () => api.listTokenAccounts({
      token_url: tokenFilter || undefined,
      search: searchFilter || undefined,
      page, per_page: perPage,
    }),
    enabled: tab === 'token',
  });

  const { data: dataData, isLoading: dataLoading } = useQuery({
    queryKey: ['data-accounts', searchFilter, dataPage],
    queryFn: () => api.listDataAccounts({ search: searchFilter || undefined, page: dataPage, per_page: perPage }),
    enabled: tab === 'data',
  });

  // Build treemap-like data: top ADIs by token account count
  const adiDistribution = useMemo(() => {
    if (!intel) return [];
    return intel.acme_distribution.top_adis.slice(0, 12).map(a => ({
      name: shortUrl(a.adi_url).slice(0, 18),
      fullUrl: a.adi_url,
      count: a.acme_accounts,
    }));
  }, [intel]);

  const handleTreemapClick = useCallback((adiUrl: string) => {
    setAdiFilter(adiUrl);
    setSearchFilter(adiUrl);
    setPage(1);
    setTab('token');
  }, []);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) setSortDir(d => d === 1 ? -1 : 1);
    else { setSortCol(col); setSortDir(1); }
  }, [sortCol]);

  const tabCounts = {
    token: tokenData?.total ?? stats?.counts.token_accounts ?? 0,
    data: dataData?.total ?? stats?.counts.data_accounts ?? 0,
    issuers: issuers?.length ?? stats?.counts.token_issuers ?? 0,
  };

  return (
    <div className="accounts-observatory">

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

      {/* ── 4B. ADI Distribution Treemap (simplified as bar chart) ── */}
      {adiDistribution.length > 0 && tab === 'token' && (
        <GlassCard title="Token Accounts by ADI" delay={0.08}>
          <div className="accounts-treemap">
            {adiDistribution.map((item, i) => {
              const maxCount = adiDistribution[0]?.count || 1;
              const pct = (item.count / maxCount) * 100;
              return (
                <div
                  key={item.fullUrl}
                  className="treemap-bar"
                  onClick={() => handleTreemapClick(item.fullUrl)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="treemap-bar-label">
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>{item.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 600, color: '#22d3ee' }}>{item.count}</span>
                  </div>
                  <div className="treemap-bar-track">
                    <motion.div
                      className="treemap-bar-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, delay: i * 0.04 }}
                      style={{ background: `linear-gradient(90deg, #22d3ee, ${pct > 60 ? '#6c8cff' : '#22d3ee88'})` }}
                    />
                  </div>
                </div>
              );
            })}
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
          { id: 'token' as const, label: 'Token Accounts', icon: '\u25CF', color: '#22d3ee' },
          { id: 'data' as const, label: 'Data Accounts', icon: '\u25A0', color: '#a78bfa' },
          { id: 'issuers' as const, label: 'Token Issuers', icon: '\u25C6', color: '#f472b6' },
        ]).map(t => (
          <button
            key={t.id}
            className={`accounts-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span style={{ color: tab === t.id ? t.color : undefined }}>{t.icon}</span>
            {t.label}
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
                <EmptyState icon={'\u25A3'} title="No token accounts found" description={searchFilter ? `No results matching "${searchFilter}".` : 'No token accounts in the database.'} compact />
              ) : tokenData && (
                <>
                  <div className="accounts-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th className="sortable-th" onClick={() => handleSort('url')}>
                            Account URL {sortCol === 'url' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
                          </th>
                          <th className="sortable-th" onClick={() => handleSort('adi')}>
                            ADI {sortCol === 'adi' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
                          </th>
                          <th className="sortable-th" onClick={() => handleSort('token')}>
                            Token Type {sortCol === 'token' && (sortDir === 1 ? '\u25B2' : '\u25BC')}
                          </th>
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
                <EmptyState icon={'\u25A2'} title="No data accounts found" description={searchFilter ? `No results matching "${searchFilter}".` : 'No data accounts in the database.'} compact />
              ) : dataData && (
                <>
                  <div className="accounts-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Account URL</th>
                          <th>ADI</th>
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
    </div>
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
          <div className="issuer-obs-gauge">
            {limit > 0 ? (
              <RingGauge
                value={utilization}
                size={72}
                strokeWidth={5}
                color={utilization > 0.8 ? '#ef4444' : utilization > 0.5 ? '#f59e0b' : '#22c55e'}
                valueLabel={`${(utilization * 100).toFixed(0)}%`}
                label="Supply"
              />
            ) : (
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', fontSize: 10, color: 'var(--text-tertiary)',
              }}>
                <div style={{ fontSize: 18 }}>{'\u221E'}</div>
                <div>No limit</div>
              </div>
            )}
          </div>
          <div className="issuer-obs-stats">
            <div className="issuer-obs-stat-row">
              <span>Precision</span>
              <strong>{issuer.precision}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <span>Issued</span>
              <strong>{Number(issued).toLocaleString()}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <span>Supply Limit</span>
              <strong>{limit > 0 ? Number(limit).toLocaleString() : 'Unlimited'}</strong>
            </div>
            <div className="issuer-obs-stat-row">
              <span>Holders</span>
              <strong style={{ color: '#22d3ee' }}><AnimatedCounter value={holderCount} /></strong>
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

        {/* View All Holders button */}
        <button
          className="issuer-obs-view-btn"
          onClick={() => onViewHolders(issuer.url)}
        >
          View All Holders
        </button>
      </div>
    </GlassCard>
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
