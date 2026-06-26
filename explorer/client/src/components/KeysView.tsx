import { useState, useMemo, useRef, useEffect, useCallback, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api, ApiError } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { StatOrb } from './ui/StatOrb';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { ExportButton, toCSV } from './ui/ExportButton';
import { PageLoader } from './ui/PageLoader';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';
import { getEntityColor } from '../hooks/useEntityColor';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import { InfoTip, TermLabel } from './ui/InfoTip';
import { RiskNote } from './ui/RiskNote';
import type { KeyBook, KeyPage, LiteCrossSurfaceKey } from '../types';

function shortUrl(url: string) { return url.replace('acc://', ''); }

// Deterministic FNV-1a string hash → stable float in [0,1).
// Used so graph nodes always get the same radial offset (no Math.random teleport on mount/resize).
function hashUnit(str: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  // Map the 32-bit unsigned result into [0,1)
  return (h >>> 0) / 0x100000000;
}

/* ─── Main Component ─────────────────────────── */

export function KeysView() {
  const [page, setPage] = useState(1);
  const [searchFilter, setSearchFilter] = useState('');
  const perPage = 50;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['key-books-list', page],
    queryFn: () => api.listKeyBooks({ page, per_page: perPage }),
  });

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, staleTime: 120000 });
  const { data: intel } = useQuery({ queryKey: ['intelligence'], queryFn: api.getIntelligence, staleTime: 300000 });

  // Compute security metrics
  const securityMetrics = useMemo(() => {
    if (!intel) return null;
    const ks = intel.key_security;
    // C2: use the backend-provided true mean M across all key pages
    // (already rounded to 2 dp) instead of the old fabricated formula
    // that counted every multi-sig page as exactly 2.
    const avgThreshold = ks.avg_threshold ?? 0;
    return {
      totalBooks: stats?.counts.key_books || 0,
      totalPages: ks.total_pages,
      multiSig: ks.multi_sig,
      singleSig: ks.single_sig,
      multiSigRate: ks.total_pages > 0 ? ks.multi_sig / ks.total_pages : 0,
      zeroCreditPages: ks.zero_credit_pages,
      sharedKeyCount: intel.key_reuse.length,
      avgThreshold,
    };
  }, [intel, stats]);

  // Filter books by search
  const filteredBooks = useMemo(() => {
    if (!data) return [];
    if (!searchFilter) return data.items;
    const term = searchFilter.toLowerCase();
    return data.items.filter(b => b.url.toLowerCase().includes(term) || b.adi_url.toLowerCase().includes(term));
  }, [data, searchFilter]);

  const totalPages = data ? Math.ceil(data.total / perPage) : 1;

  return (
    <div className="key-vault">

      {/* ── View intro: plain-language framing for this view. ── */}
      <div className="view-intro">
        <div className="view-intro__title">Key Vault</div>
        <div className="view-intro__lead">
          The signing keys behind every identity — key books, their key pages, signing thresholds, and credit balances.
        </div>
        <div className="view-intro__audience">Security · for owners &amp; auditors</div>
      </div>

      {/* ── 5A. Security Dashboard Header ── */}
      {securityMetrics && (
        <div className="kv-security-header">
          <GlassCard gradientTop delay={0}>
            <div className="kv-metrics-strip">
              {/* Total Books/Pages */}
              <div className="kv-metric-card">
                <div className="kv-metric-top">
                  <StatOrb
                    value={securityMetrics.totalBooks}
                    label="Key Books"
                    {...getEntityColor('key')}
                    delay={0}
                  />
                  <InfoTip term="key-book" />
                </div>
                <div className="kv-metric-sub">
                  <AnimatedCounter value={securityMetrics.totalPages} /> <TermLabel term="key-page">pages</TermLabel>
                </div>
              </div>

              {/* Multi-sig Adoption */}
              <div className="kv-metric-card">
                <div className="kv-metric-top">
                  <RingGauge
                    value={securityMetrics.multiSigRate}
                    size={80}
                    strokeWidth={6}
                    color={securityMetrics.multiSigRate > 0.3 ? '#22c55e' : securityMetrics.multiSigRate > 0.1 ? '#f59e0b' : '#ef4444'}
                    valueLabel={`${(securityMetrics.multiSigRate * 100).toFixed(1)}%`}
                    label="Multi-sig"
                  />
                  <InfoTip term="multi-sig" />
                </div>
                <div className="kv-metric-detail">
                  <span style={{ color: '#22c55e' }}><AnimatedCounter value={securityMetrics.multiSig} /> multi</span>
                  <span style={{ color: '#f59e0b' }}><AnimatedCounter value={securityMetrics.singleSig} /> single</span>
                </div>
                {/* B3: denominator + honest band behind the ring's color. */}
                <div className="kv-metric-sub">
                  {securityMetrics.multiSig} of {securityMetrics.totalPages} pages · band: &lt;10% red, &lt;30% amber
                </div>
              </div>

              {/* Shared Keys */}
              <div className="kv-metric-card">
                <div className="kv-metric-big" style={{ color: securityMetrics.sharedKeyCount > 0 ? '#ef4444' : '#22c55e' }}>
                  <AnimatedCounter value={securityMetrics.sharedKeyCount} />
                </div>
                <div className="kv-metric-label"><TermLabel term="key-reuse">Shared Keys</TermLabel></div>
                {/* B3: context — these are keys reused across distinct identities. */}
                <div className="kv-metric-sub">keys shared across identities</div>
                {securityMetrics.sharedKeyCount > 0 && (
                  <GlowBadge variant="danger">security risk</GlowBadge>
                )}
              </div>

              {/* Average Threshold */}
              <div className="kv-metric-card">
                <div className="kv-metric-big" style={{ color: getEntityColor('adi').color }}>
                  {securityMetrics.avgThreshold}
                </div>
                <div className="kv-metric-label"><TermLabel term="threshold">Avg Threshold</TermLabel></div>
                <div className="kv-metric-sub">signatures required (avg)</div>
                <div className="kv-metric-detail">
                  <span style={{ color: getEntityColor('danger').color }}><AnimatedCounter value={securityMetrics.zeroCreditPages} /> zero-credit</span>
                </div>
                {/* B3: denominator behind the zero-credit detail. */}
                <div className="kv-metric-sub">
                  {securityMetrics.zeroCreditPages} of {securityMetrics.totalPages} pages can’t sign
                </div>
              </div>
            </div>

            {/* B1+B2: headline risk callouts (why it matters + Fix), shown only
                when the relevant risk is actually present. Kept to the 1–2 most
                relevant so the strip doesn't turn into a wall of callouts. */}
            {(securityMetrics.sharedKeyCount > 0 || securityMetrics.zeroCreditPages > 0
              || (securityMetrics.totalPages > 0 && securityMetrics.singleSig > securityMetrics.multiSig)) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
                {securityMetrics.sharedKeyCount > 0 && <RiskNote risk="key-reuse" compact />}
                {securityMetrics.sharedKeyCount === 0 && securityMetrics.totalPages > 0
                  && securityMetrics.singleSig > securityMetrics.multiSig && <RiskNote risk="single-sig" compact />}
                {securityMetrics.zeroCreditPages > 0 && <RiskNote risk="zero-credit" compact />}
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── 5B. Key Book Grid ── */}
      <GlassCard
        title={`Key Books${data ? ` (${data.total})` : ''}`}
        titleRight={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              placeholder="Search books..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="kv-search-input"
            />
            {data && data.items.length > 0 && (
              <ExportButton
                filename="key-books"
                onExportCSV={() => toCSV(data.items.map(b => ({ url: b.url, adi_url: b.adi_url, page_count: b.page_count })))}
              />
            )}
          </div>
        }
        delay={0.1}
      >
        {isError ? (
          <ErrorState title="Failed to load key books" onRetry={() => refetch()} />
        ) : isLoading ? (
          <PageLoader message="Loading key books..." />
        ) : filteredBooks.length === 0 ? (
          <EmptyState icon={'\u2B22'} title={searchFilter ? 'No matching key books' : 'No key books found'} description={searchFilter ? `No key books match your filter "${searchFilter}".` : 'No key books in the database. Key books hold the key pages that authorize an identity.'} compact />
        ) : (
          <>
            {/* Concept key: the page-card terms are defined once here (first
                occurrence) rather than repeated on every expanded page card. */}
            <div className="kv-concept-key" style={{
              display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12,
              fontSize: 11, color: 'var(--text-tertiary)',
            }}>
              <TermLabel term="threshold">Threshold</TermLabel>
              <TermLabel term="key-page-version">Version</TermLabel>
              <TermLabel term="multi-sig">Multi-sig / single-sig</TermLabel>
              <TermLabel term="credits">Credits</TermLabel>
              <TermLabel term="public-key-hash">Public key hash</TermLabel>
              <TermLabel term="delegation">Delegate</TermLabel>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: -4, marginBottom: 12, lineHeight: 1.3 }}>
              Credits are the fuel a page burns ACME for — they pay the fees a key page spends to sign and submit transactions.
            </div>
            <div className="kv-book-grid">
              {filteredBooks.map(book => (
                <KeyBookGridCard key={book.url} book={book} sharedKeys={intel?.key_reuse || []} />
              ))}
            </div>
            {data && (
              <div className="accounts-footer" style={{ marginTop: 12 }}>
                <span className="accounts-showing">
                  {searchFilter ? `${filteredBooks.length} matching` : `Page ${page} of ${totalPages} (${data.total} total)`}
                </span>
                {!searchFilter && (
                  <div className="pagination">
                    <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                    <span>Page {page} of {totalPages}</span>
                    <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </GlassCard>

      {/* ── 5C. Key Sharing Network ── */}
      {intel && intel.key_reuse.length > 0 && (
        <GlassCard title="Key Sharing Network" titleRight={<InfoTip term="key-reuse" />} delay={0.2}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            ADIs connected by shared cryptographic keys. Red intensity = more shared keys.
          </div>
          <KeySharingGraph keyReuse={intel.key_reuse} />
        </GlassCard>
      )}

      {/* ── 5C-2. Cross-Surface Key Reuse (Phase H) ── */}
      <CrossSurfaceKeys />

      {/* ── 5D. Key Timeline ── */}
      {intel && (
        <GlassCard title="Key Activity Timeline" delay={0.3}>
          <KeyTimeline />
        </GlassCard>
      )}
    </div>
  );
}

/* ─── Cross-Surface Keys (lite ⇄ ADI) ─────────── */

/* The same public key can secure an ADI key page AND a lite-account wallet. A
   lite address is the first 20 bytes of SHA-256(pubkey); an ADI key page stores
   the full 32-byte hash — so a shared key is detectable by the 40-hex prefix
   match (done server-side). This surfaces a compromise path invisible to either
   the ADI view or the lite view alone. */
function CrossSurfaceKeys() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['lite-cross-surface'],
    queryFn: api.getLiteCrossSurface,
    staleTime: 300000,
  });
  const [selected, setSelected] = useState<string | null>(null);

  if (isLoading) {
    return (
      <GlassCard title="Cross-Surface Key Reuse" delay={0.25}>
        <PageLoader message="Correlating lite and ADI keys..." />
      </GlassCard>
    );
  }
  if (!data || data.summary.lite_keys === 0) {
    return (
      <GlassCard title="Cross-Surface Key Reuse" titleRight={<InfoTip term="key-reuse" />} delay={0.25}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          No keys were found securing both an ADI key page and a lite account. Lite and ADI
          surfaces are cleanly separated on this network.
        </div>
      </GlassCard>
    );
  }

  const s = data.summary;
  const acme = s.acme_exposed / 1e8;
  const stats = [
    { label: 'Shared keys', value: s.lite_keys.toLocaleString(), color: '#ef4444' },
    { label: 'ADI key pages', value: s.adi_pages.toLocaleString(), color: getEntityColor('key').color },
    { label: 'Lite accounts', value: s.lite_accounts.toLocaleString(), color: getEntityColor('token').color },
    { label: 'ACME exposed', value: acme.toLocaleString(undefined, { maximumFractionDigits: 0 }), color: getEntityColor('authority').color },
  ];

  return (
    <GlassCard
      title="Cross-Surface Key Reuse"
      titleRight={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>lite ⇄ ADI</span>
        <InfoTip term="key-reuse" />
      </span>}
      delay={0.25}
    >
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
        Keys that secure <strong>both</strong> an ADI key page and a lite-account wallet. The same public key
        signs on two surfaces, so a compromise on either one drains the other — a path neither the ADI view nor
        the lite view shows on its own. Detected by matching the lite address (first 20 bytes of the key hash)
        against ADI key-page hashes.
      </div>

      {/* Summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 16 }}>
        {stats.map(st => (
          <div key={st.label} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: st.color, fontFamily: 'var(--font-mono)', lineHeight: 1.1 }}>{st.value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>{st.label}</div>
          </div>
        ))}
      </div>

      <RiskNote risk="key-reuse" compact />

      {/* Bipartite graph: ADI pages ⟷ key ⟷ lite accounts */}
      <div style={{ marginTop: 14 }}>
        <CrossSurfaceGraph keys={data.keys} onSelectKey={setSelected} selected={selected} />
      </div>

      {/* Table of reused keys */}
      <div style={{ overflowX: 'auto', marginTop: 14 }}>
        <table className="data-table" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th>Key hash</th>
              <th style={{ textAlign: 'right' }}>Lite accounts</th>
              <th style={{ textAlign: 'right' }}>ADI pages</th>
              <th style={{ textAlign: 'right' }}>ACME</th>
            </tr>
          </thead>
          <tbody>
            {data.keys.map(k => {
              const isSel = selected === k.key_hash;
              return (
                <Fragment key={k.key_hash}>
                  <tr
                    className="risk-row-clickable"
                    role="button" tabIndex={0}
                    onClick={() => setSelected(isSel ? null : k.key_hash)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(isSel ? null : k.key_hash); } }}
                    style={{ cursor: 'pointer', background: isSel ? 'rgba(239,68,68,0.06)' : undefined }}
                    title="Show this key's accounts and pages"
                  >
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>
                      {isSel ? '▾ ' : '▸ '}{k.key_hash.slice(0, 24)}…
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{k.account_count}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{k.page_count}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{k.acme ? (k.acme / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}</td>
                  </tr>
                  {isSel && (
                    <tr>
                      <td colSpan={4} style={{ background: 'var(--bg-elevated)', padding: 12 }}>
                        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>ADI key pages ({k.adi_pages.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {k.adi_pages.slice(0, 12).map(p => (
                                <span key={p} className="url-link" role="button" tabIndex={0}
                                  onClick={() => navigate('/tree?select=' + encodeURIComponent('acc://' + shortUrl(p).split('/')[0]))}
                                  onKeyDown={e => { if (e.key === 'Enter') navigate('/tree?select=' + encodeURIComponent('acc://' + shortUrl(p).split('/')[0])); }}
                                  style={{ fontSize: 10, fontFamily: 'var(--font-mono)', cursor: 'pointer' }} title={p}>
                                  {shortUrl(p)}
                                </span>
                              ))}
                              {k.adi_pages.length > 12 && <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>+{k.adi_pages.length - 12} more</span>}
                            </div>
                          </div>
                          <div style={{ flex: 1, minWidth: 220 }}>
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Lite accounts ({k.accounts.length})</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {k.accounts.map(a => (
                                <span key={a.url} className="url-link" role="button" tabIndex={0}
                                  onClick={() => navigate('/accounts?tab=lite&search=' + encodeURIComponent(k.key_hash))}
                                  onKeyDown={e => { if (e.key === 'Enter') navigate('/accounts?tab=lite&search=' + encodeURIComponent(k.key_hash)); }}
                                  style={{ fontSize: 10, fontFamily: 'var(--font-mono)', cursor: 'pointer' }} title={a.url}>
                                  {shortUrl(a.url).slice(0, 28)}… {a.token_url === 'acc://ACME' && a.balance ? `· ${(a.balance / 1e8).toLocaleString(undefined, { maximumFractionDigits: 0 })} ACME` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </GlassCard>
  );
}

/* Bipartite canvas: ADI key pages (left) ⟷ shared keys (center) ⟷ lite accounts
   (right). Bounded to the top keys returned by the API so node counts stay small. */
interface CrossSurfaceGraphProps {
  keys: LiteCrossSurfaceKey[];
  onSelectKey: (hash: string | null) => void;
  selected: string | null;
}

function CrossSurfaceGraph({ keys, onSelectKey, selected }: CrossSurfaceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const [dims, setDims] = useState({ width: 800, height: 380 });
  const [hover, setHover] = useState<string | null>(null);

  const TOP = 8;
  const topKeys = useMemo(() => keys.slice(0, TOP), [keys]);

  // Build three columns of nodes + edges.
  const model = useMemo(() => {
    const pad = 28;
    const xPage = dims.width * 0.16;
    const xKey = dims.width * 0.5;
    const xAcct = dims.width * 0.84;

    const pages: string[] = [];
    const accts: string[] = [];
    for (const k of topKeys) {
      for (const p of k.adi_pages) if (!pages.includes(p)) pages.push(p);
      for (const a of k.accounts) if (!accts.includes(a.url)) accts.push(a.url);
    }
    const colY = (i: number, n: number) =>
      n <= 1 ? dims.height / 2 : pad + (i * (dims.height - 2 * pad)) / (n - 1);

    const nodes = new Map<string, { id: string; x: number; y: number; type: 'page' | 'key' | 'acct'; r: number; label: string }>();
    pages.forEach((p, i) => nodes.set('p:' + p, { id: 'p:' + p, x: xPage, y: colY(i, pages.length), type: 'page', r: 4, label: shortUrl(p) }));
    accts.forEach((a, i) => nodes.set('a:' + a, { id: 'a:' + a, x: xAcct, y: colY(i, accts.length), type: 'acct', r: 4, label: shortUrl(a) }));
    const maxAcme = Math.max(1, ...topKeys.map(k => k.acme));
    topKeys.forEach((k, i) => nodes.set('k:' + k.key_hash, {
      id: 'k:' + k.key_hash, x: xKey, y: colY(i, topKeys.length), type: 'key',
      r: 6 + 8 * (k.acme / maxAcme), label: k.key_hash.slice(0, 10),
    }));

    const edges: { a: string; b: string; key: string }[] = [];
    for (const k of topKeys) {
      const kid = 'k:' + k.key_hash;
      for (const p of k.adi_pages) edges.push({ a: kid, b: 'p:' + p, key: k.key_hash });
      for (const a of k.accounts) edges.push({ a: kid, b: 'a:' + a.url, key: k.key_hash });
    }
    return { nodes, edges };
  }, [topKeys, dims]);

  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w > 0) setDims({ width: w, height: Math.max(300, Math.min(460, topKeys.length * 46 + 60)) });
      }
    }
    measure();
    let ro: ResizeObserver | null = null;
    if (containerRef.current) { ro = new ResizeObserver(measure); ro.observe(containerRef.current); }
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [topKeys.length]);

  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = themeColors.canvasBg;
    ctx.fillRect(0, 0, dims.width, dims.height);

    const active = hover || selected;
    // edges
    for (const e of model.edges) {
      const a = model.nodes.get(e.a); const b = model.nodes.get(e.b);
      if (!a || !b) continue;
      const lit = active && e.key === active;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      // gentle curve
      ctx.bezierCurveTo((a.x + b.x) / 2, a.y, (a.x + b.x) / 2, b.y, b.x, b.y);
      ctx.strokeStyle = lit ? 'rgba(239,68,68,0.55)' : `rgba(239,68,68,${active ? 0.05 : 0.14})`;
      ctx.lineWidth = lit ? 1.6 : 0.6;
      ctx.stroke();
    }
    // nodes
    for (const n of model.nodes.values()) {
      const isKey = n.type === 'key';
      const lit = active && (n.id === 'k:' + active || model.edges.some(e => e.key === active && (e.a === n.id || e.b === n.id)));
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI);
      const col = n.type === 'page' ? '#6c8cff' : n.type === 'acct' ? '#22d3ee' : '#ef4444';
      ctx.fillStyle = lit || !active ? col : (isDark ? 'rgba(120,130,160,0.35)' : 'rgba(120,130,160,0.4)');
      ctx.fill();
      if (isKey) { ctx.strokeStyle = themeColors.canvasText; ctx.lineWidth = lit ? 1.5 : 0.5; ctx.stroke(); }
      // label for keys, or hovered node
      if (isKey || lit) {
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = themeColors.canvasTextDim;
        ctx.textAlign = n.type === 'page' ? 'right' : n.type === 'acct' ? 'left' : 'center';
        const lx = n.type === 'page' ? n.x - n.r - 4 : n.type === 'acct' ? n.x + n.r + 4 : n.x;
        const ly = n.type === 'key' ? n.y - n.r - 4 : n.y + 3;
        ctx.fillText(n.label.slice(0, 22), lx, ly);
      }
    }
    // column headers
    ctx.font = '10px Inter, sans-serif';
    ctx.fillStyle = themeColors.canvasTextDim;
    ctx.textAlign = 'center';
    ctx.fillText('ADI key pages', dims.width * 0.16, 14);
    ctx.fillText('shared key', dims.width * 0.5, 14);
    ctx.fillText('lite accounts', dims.width * 0.84, 14);
  }, [model, dims, dpr, hover, selected, isDark, themeColors]);

  const onMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let found: string | null = null;
    for (const n of model.nodes.values()) {
      const dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < (n.r + 4) * (n.r + 4)) {
        if (n.type === 'key') found = n.id.slice(2);
        else { const e2 = model.edges.find(ed => ed.a === n.id || ed.b === n.id); found = e2?.key || null; }
        break;
      }
    }
    setHover(found);
  }, [model]);

  const label = `Cross-surface key graph: ${topKeys.length} keys linking ADI pages and lite accounts`;
  return (
    <div ref={containerRef} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={label}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onClick={() => onSelectKey(hover && hover === selected ? null : hover)}
        style={{ display: 'block', width: dims.width, height: dims.height, cursor: hover ? 'pointer' : 'default' }}
      />
      <div style={{ position: 'absolute', bottom: 8, left: 8, display: 'flex', gap: 12, fontSize: 9, color: 'var(--text-tertiary)', background: isDark ? 'rgba(17,22,40,0.85)' : 'rgba(255,255,255,0.9)', borderRadius: 6, padding: '4px 8px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#6c8cff' }} /> ADI page</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} /> shared key</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: '#22d3ee' }} /> lite account</span>
        <span>top {topKeys.length} keys · hover/click to isolate</span>
      </div>
    </div>
  );
}

/* ─── Key Book Grid Card ─────────────────────── */

function KeyBookGridCard({ book, sharedKeys }: {
  book: KeyBook;
  sharedKeys: { key_hash: string; adi_count: number; adi_urls: string[] }[];
}) {
  const [expanded, setExpanded] = useState(false);
  // P3.6: the backend now returns HTTP 404 (not 200 + {error}) for a missing
  // key book, so surface the query's error state instead of relying on an
  // 'error' field in the payload. A 404 (ApiError.status === 404) renders an
  // inline "not found" notice rather than spinning forever.
  const { data: detail, isError, error } = useQuery({
    queryKey: ['key-book-detail', book.url],
    queryFn: () => api.getKeyBook(book.url),
    enabled: expanded,
    retry: (failureCount, err) =>
      err instanceof ApiError && err.status === 404 ? false : failureCount < 2,
  });
  const notFound = isError && error instanceof ApiError && error.status === 404;

  // Check if any keys from this book's ADI appear in shared keys
  const hasSharedKeys = sharedKeys.some(kr => kr.adi_urls.includes(book.adi_url));

  return (
    <div className={`kv-book-card ${hasSharedKeys ? 'kv-book-card--warning' : ''}`}>
      <div className="kv-book-card-header" onClick={() => setExpanded(!expanded)}>
        <div className="kv-book-card-top">
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: hasSharedKeys ? '#ef4444' : '#34d399',
            boxShadow: `0 0 8px ${hasSharedKeys ? 'rgba(239,68,68,0.3)' : 'rgba(52,211,153,0.3)'}`,
            flexShrink: 0,
          }} />
          <span className="kv-book-url">{shortUrl(book.url)}</span>
          <span className="tree-toggle" style={{
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s',
            marginLeft: 'auto',
          }}>{'\u25BC'}</span>
        </div>
        <div className="kv-book-card-meta">
          <span className="url-link" style={{ fontSize: 10 }}>{shortUrl(book.adi_url)}</span>
          <div className="kv-book-card-badges">
            <GlowBadge variant="key">{book.page_count} {book.page_count === 1 ? 'page' : 'pages'}</GlowBadge>
            {hasSharedKeys && <GlowBadge variant="danger">shared keys</GlowBadge>}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{ overflow: 'hidden' }}
          >
            {isError ? (
              <div style={{
                margin: 10, padding: '10px 12px', borderRadius: 8,
                fontSize: 11, color: 'var(--text-secondary)',
                border: '1px solid rgba(239,68,68,0.2)',
                background: 'rgba(239,68,68,0.06)',
              }}>
                {notFound ? 'Key book not found' : 'Failed to load key book'}
              </div>
            ) : !detail?.pages ? (
              <div className="shimmer" style={{ height: 60, margin: 10, borderRadius: 8 }} />
            ) : (
              <div className="kv-book-pages">
                {detail.pages.map(pg => (
                  <KeyPageVaultCard key={pg.url} page={pg} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Key Page Card (Vault version) ──────────── */

function KeyPageVaultCard({ page }: { page: KeyPage }) {
  const isMultiSig = page.threshold > 1;
  const keyCount = page.keys.length;
  const thresholdLabel = `${page.threshold}/${keyCount || 1}`;

  return (
    <div className="kv-page-card">
      <div className="kv-page-header">
        <RingGauge
          value={Math.min(page.threshold / Math.max(keyCount, 1), 1)}
          size={40}
          strokeWidth={3.5}
          color={isMultiSig ? '#22c55e' : '#f59e0b'}
          valueLabel={thresholdLabel}
        />
        <div className="kv-page-info">
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--text-primary)' }}>
            {shortUrl(page.url)}
          </div>
          <div className="kv-page-meta">
            <GlowBadge variant="adi">v{page.version}</GlowBadge>
            <GlowBadge variant={isMultiSig ? 'success' : 'warning'}>
              {isMultiSig ? 'multi-sig' : 'single-sig'}
            </GlowBadge>
            <span style={{
              fontSize: 10,
              color: page.credit_balance > 0 ? '#22c55e' : '#ef4444',
            }}>
              {page.credit_balance.toLocaleString()} credits
            </span>
          </div>
        </div>
        <div className="kv-page-key-count">
          <span style={{ fontSize: 16, fontWeight: 700, color: '#34d399' }}>{keyCount}</span>
          <span style={{ fontSize: 9, color: 'var(--text-tertiary)' }}>keys</span>
        </div>
      </div>

      {keyCount > 0 && (
        <div className="kv-key-list">
          {page.keys.map((k, i) => (
            <div key={i} className="kv-key-entry">
              <div className="kv-key-hash">
                {k.public_key_hash || k.public_key || 'No key hash'}
              </div>
              <div className="kv-key-meta">
                {k.delegate && (
                  <GlowBadge variant="authority">
                    {'\u2192'} {shortUrl(k.delegate).slice(0, 22)}
                  </GlowBadge>
                )}
                <span className="kv-key-time">
                  {k.last_used_on
                    ? `Used ${new Date(k.last_used_on * 1000).toLocaleDateString()}`
                    : 'Never used'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Key Sharing Network (Canvas Graph) ─────── */

interface KeyReuseItem {
  key_hash: string;
  adi_count: number;
  adi_urls: string[];
}

function KeySharingGraph({ keyReuse }: { keyReuse: KeyReuseItem[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  // P3.5: track cursor position (CSS-pixel coords in the container) so the
  // tooltip follows the pointer instead of sitting in a fixed corner.
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dims, setDims] = useState({ width: 800, height: 350 });
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // Build graph data
  const graphData = useMemo(() => {
    const nodeSet = new Set<string>();
    // Accumulate edges in a Map keyed by a canonical pair key so dedupe/weighting
    // is O(1) per pair (avoids O(E^2) edges.find scans inside the nested loops).
    const edgeMap = new Map<string, { source: string; target: string; weight: number }>();

    for (const kr of keyReuse) {
      for (const adi of kr.adi_urls) {
        nodeSet.add(adi);
      }
      // Connect all ADIs sharing this key
      for (let i = 0; i < kr.adi_urls.length; i++) {
        for (let j = i + 1; j < kr.adi_urls.length; j++) {
          const a = kr.adi_urls[i];
          const b = kr.adi_urls[j];
          const key = a < b ? `${a}|${b}` : `${b}|${a}`;
          const existing = edgeMap.get(key);
          if (existing) existing.weight++;
          else edgeMap.set(key, { source: a, target: b, weight: 1 });
        }
      }
    }

    const edges = Array.from(edgeMap.values());

    // Count shared keys per node
    const sharedCount = new Map<string, number>();
    for (const kr of keyReuse) {
      for (const adi of kr.adi_urls) {
        sharedCount.set(adi, (sharedCount.get(adi) || 0) + 1);
      }
    }

    const nodes = Array.from(nodeSet).map(id => ({
      id,
      sharedKeys: sharedCount.get(id) || 0,
    }));

    return { nodes, edges };
  }, [keyReuse]);

  // Simple force layout
  const positions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const { nodes } = graphData;
    const centerX = dims.width / 2;
    const centerY = dims.height / 2;
    const radius = Math.min(dims.width, dims.height) * 0.35;

    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      // Deterministic radial factor in [0.6, 1.0) derived from the node's stable id,
      // so the same node always lands at the same spot (no teleport on mount/resize).
      const factor = 0.6 + hashUnit(n.id) * 0.4;
      pos.set(n.id, {
        x: centerX + Math.cos(angle) * radius * factor,
        y: centerY + Math.sin(angle) * radius * factor,
      });
    });
    return pos;
  }, [graphData, dims]);

  // Measure container with a ResizeObserver (mirrors NetworkGraph) so the graph
  // stays sized to its container on layout changes — not just at mount.
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const w = Math.round(el.getBoundingClientRect().width);
        if (w > 0) {
          setDims({ width: w, height: 350 });
        }
      }
    }

    measure();
    let ro: ResizeObserver | null = null;
    if (containerRef.current) {
      ro = new ResizeObserver(() => measure());
      ro.observe(containerRef.current);
    }
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // devicePixelRatio scaling so the canvas is crisp on Retina / HiDPI displays.
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size the backing store by dpr, then scale the context so all drawing
    // commands continue to use CSS-pixel (dims) coordinates.
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = themeColors.canvasBg;
    ctx.fillRect(0, 0, dims.width, dims.height);

    // Draw edges
    for (const edge of graphData.edges) {
      const s = positions.get(edge.source);
      const t = positions.get(edge.target);
      if (!s || !t) continue;

      const isHigh = hovered && (edge.source === hovered || edge.target === hovered);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.strokeStyle = isHigh
        ? `rgba(239,68,68,${0.3 + edge.weight * 0.15})`
        : `rgba(239,68,68,${0.06 + edge.weight * 0.04})`;
      ctx.lineWidth = isHigh ? 1.5 : 0.6 + edge.weight * 0.3;
      ctx.stroke();
    }

    // Draw nodes
    for (const node of graphData.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;

      const size = 3 + node.sharedKeys * 1.5;
      const intensity = Math.min(1, node.sharedKeys / 5);
      const isHov = hovered === node.id;

      // Glow for hovered
      if (isHov) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size + 6, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(239,68,68,0.2)';
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, 2 * Math.PI);
      ctx.fillStyle = `rgb(${Math.round(34 + 205 * intensity)}, ${Math.round(197 - 129 * intensity)}, ${Math.round(94 - 26 * intensity)})`;
      ctx.fill();

      // P3.4 color-blind safety: add a redundant non-hue severity cue. Higher
      // sharing (the same thing the green→red hue encodes) gets a progressively
      // heavier ring stroke, so severity reads from the outline even when the
      // fill hue is indistinguishable. Color stays the primary channel.
      if (intensity > 0) {
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, size + 1.5, 0, 2 * Math.PI);
        ctx.strokeStyle = themeColors.canvasText;
        ctx.lineWidth = 0.5 + intensity * 2;
        ctx.stroke();
      }

      // Label
      if (isHov || node.sharedKeys > 3) {
        const label = shortUrl(node.id).slice(0, 18);
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = themeColors.canvasText;
        ctx.textAlign = 'center';
        // P3.4: annotate high-sharing nodes with the explicit count as a second
        // non-hue cue (the size + ring already encode severity visually).
        const suffix = node.sharedKeys > 3 ? ` (${node.sharedKeys})` : '';
        ctx.fillText(label + suffix, pos.x, pos.y + size + 12);
      }
    }
  }, [graphData, positions, hovered, dims, dpr, isDark, themeColors]);

  // Handle hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });

    let found: string | null = null;
    for (const node of graphData.nodes) {
      const pos = positions.get(node.id);
      if (!pos) continue;
      const dx = mx - pos.x;
      const dy = my - pos.y;
      const size = 3 + node.sharedKeys * 1.5;
      if (dx * dx + dy * dy < (size + 4) * (size + 4)) {
        found = node.id;
        break;
      }
    }
    setHovered(found);
  }, [graphData, positions]);

  const graphLabel = `Key sharing graph: ${keyReuse.length} shared ${keyReuse.length === 1 ? 'key' : 'keys'} across ${graphData.nodes.length} ${graphData.nodes.length === 1 ? 'ADI' : 'ADIs'}`;

  return (
    <div ref={containerRef} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={graphLabel}
        width={dims.width * dpr}
        height={dims.height * dpr}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        style={{ display: 'block', width: dims.width, height: dims.height, cursor: hovered ? 'pointer' : 'default' }}
      />

      {/* Visually-hidden data-table alternative for screen readers / non-visual access. */}
      <div className="sr-only">
        <table>
          <caption>{graphLabel}</caption>
          <thead>
            <tr>
              <th scope="col">ADI</th>
              <th scope="col">Shared keys</th>
            </tr>
          </thead>
          <tbody>
            {graphData.nodes.map(node => (
              <tr key={node.id}>
                <td>{shortUrl(node.id)}</td>
                <td>{node.sharedKeys}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table>
          <caption>Shared-key connections between ADIs</caption>
          <thead>
            <tr>
              <th scope="col">ADI A</th>
              <th scope="col">ADI B</th>
              <th scope="col">Shared keys</th>
            </tr>
          </thead>
          <tbody>
            {graphData.edges.map(edge => (
              <tr key={`${edge.source}|${edge.target}`}>
                <td>{shortUrl(edge.source)}</td>
                <td>{shortUrl(edge.target)}</td>
                <td>{edge.weight}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hover tooltip — P3.5: cursor-anchored (offset + clamped to container). */}
      {hovered && (() => {
        const shared = graphData.nodes.find(n => n.id === hovered)?.sharedKeys || 0;
        // P3.4: a plain-text severity label as a redundant, hue-independent cue.
        const severity = shared >= 5 ? 'high' : shared >= 3 ? 'medium' : 'low';
        const TW = 200, TH = 56, OFF = 14;
        const left = Math.max(4, Math.min(mousePos.x + OFF, dims.width - TW - 4));
        const top = Math.max(4, Math.min(mousePos.y + OFF, dims.height - TH - 4));
        return (
        <div style={{
          position: 'absolute', left, top,
          background: isDark ? 'rgba(17,22,40,0.92)' : 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8,
          padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)',
          pointerEvents: 'none', maxWidth: TW,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            {shortUrl(hovered)}
          </div>
          <div>Shared keys: <strong style={{ color: '#ef4444' }}>
            {shared}
          </strong> <span style={{ color: 'var(--text-tertiary)' }}>({severity} sharing)</span></div>
        </div>
        );
      })()}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: isDark ? 'rgba(17,22,40,0.85)' : 'rgba(255,255,255,0.90)', borderRadius: 6,
        padding: '4px 8px', fontSize: 9, color: 'var(--text-tertiary)',
        display: 'flex', gap: 10,
      }}>
        {/* P3.4: legend shows the non-hue cues too — bigger + ringed = more
            sharing — so severity reads without relying on the green→red hue. */}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
          Low sharing (small)
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#ef4444', border: '1.5px solid var(--text-primary)' }} />
          High sharing (large, ringed)
        </span>
        <span>{graphData.nodes.length} nodes &middot; {graphData.edges.length} edges</span>
      </div>
    </div>
  );
}

/* ─── Key Timeline ───────────────────────────── */

function KeyTimeline() {
  // P2.3: Use the server-side, non-truncated, unit-correct timeline endpoint.
  // This replaces the old listKeyPages({ per_page: 500 }) fetch + client-side
  // bucketing (which silently truncated at 500 pages and mis-handled the
  // microsecond last_used_on unit).
  const { data: timeline } = useQuery({
    queryKey: ['key-timeline'],
    queryFn: () => api.getKeyTimeline(),
    staleTime: 300000,
  });

  if (!timeline || !timeline.total) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
        No key activity data available
      </div>
    );
  }

  const { total, recent, old, never, recent_window_days } = timeline;

  return (
    <div className="kv-timeline">
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.3 }}>
        When each key was last used to sign — recently active, older, or never.
      </div>
      <div className="kv-timeline-bars">
        {[
          { label: `Recent (< ${recent_window_days} days)`, count: recent, color: '#22c55e' },
          { label: 'Older', count: old, color: '#f59e0b' },
          { label: 'Never used', count: never, color: '#ef4444' },
        ].map(item => (
          <div key={item.label} className="kv-timeline-bar-item">
            <div className="kv-timeline-bar-header">
              <span>{item.label}</span>
              <strong style={{ color: item.color }}><AnimatedCounter value={item.count} /></strong>
            </div>
            <div className="kv-timeline-bar-track">
              <motion.div
                className="kv-timeline-bar-fill"
                initial={{ width: 0 }}
                animate={{ width: `${total > 0 ? (item.count / total) * 100 : 0}%` }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                style={{ background: item.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8 }}>
        {total} total key entries
      </div>
    </div>
  );
}
