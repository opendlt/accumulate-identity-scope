import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { StatOrb } from './ui/StatOrb';
import { HeatStrip } from './ui/HeatStrip';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { ExportButton, toCSV } from './ui/ExportButton';
import { EmptyState } from './ui/EmptyState';
import { PageLoader } from './ui/PageLoader';
import { getEntityColor } from '../hooks/useEntityColor';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import { InfoTip, TermLabel } from './ui/InfoTip';
import { RiskNote } from './ui/RiskNote';
import type { AuthorityRecord } from '../types';

function shortUrl(url: string) { return url.replace('acc://', ''); }

/* ─── Authority Table Row (shared flat + grouped) ─── */

function AuthorityRow({ a, onOpenAccount }: { a: AuthorityRecord; onOpenAccount?: (accountUrl: string) => void }) {
  // B4: the account links into the Identity Explorer (/tree?select=...) so an
  // auditor can jump from an authority record straight to the governed identity.
  // The account_url is an account under the ADI; selecting it opens the ADI it
  // belongs to. Falls back to a plain label when no handler is provided.
  return (
    <tr className={a.is_implied ? 'af-row--implied' : 'af-row--explicit'}>
      <td>
        {onOpenAccount ? (
          <button
            type="button"
            className="url-link"
            style={{ fontSize: 11, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
            title={`Open ${shortUrl(a.account_url)} in the Identity Explorer`}
            onClick={() => onOpenAccount(a.account_url)}
          >
            {shortUrl(a.account_url)}
          </button>
        ) : (
          <span className="url-link" style={{ fontSize: 11 }}>{shortUrl(a.account_url)}</span>
        )}
      </td>
      <td><span className="url-link" style={{ fontSize: 11 }}>{shortUrl(a.authority_url)}</span></td>
      <td>
        <GlowBadge variant={a.is_implied ? 'authority' : 'adi'}>
          {a.is_implied ? 'implied' : 'explicit'}
        </GlowBadge>
      </td>
      <td>{a.disabled ? <GlowBadge variant="danger">disabled</GlowBadge> : '-'}</td>
    </tr>
  );
}

/* ─── Main Component ─────────────────────────── */

export function AuthoritiesView() {
  const navigate = useNavigate();
  const [tableFilter, setTableFilter] = useState('');
  const [tableImplied, setTableImplied] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const [groupBy, setGroupBy] = useState<'none' | 'account' | 'authority'>('none');
  const [sankeyFilter, setSankeyFilter] = useState<string | null>(null);
  const perPage = 100;

  // Debounce the table filter so typing doesn't fire a request per keystroke.
  // The input stays controlled (immediate); only the query uses the debounced value.
  const [debouncedFilter, setDebouncedFilter] = useState(tableFilter);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedFilter(tableFilter), 280);
    return () => clearTimeout(t);
  }, [tableFilter]);
  // Reset to first page whenever the debounced filter changes.
  useEffect(() => { setTablePage(1); }, [debouncedFilter]);

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: api.getStats, staleTime: 120000 });
  const { data: flows } = useQuery({ queryKey: ['authority-flows'], queryFn: api.getAuthorityFlows, staleTime: 300000 });

  const { data: tableData, isLoading: tableLoading } = useQuery({
    queryKey: ['authorities', tableImplied, sankeyFilter, debouncedFilter, tablePage],
    queryFn: () => api.listAuthorities({
      implied_only: tableImplied || undefined,
      account_url: sankeyFilter || debouncedFilter || undefined,
      page: tablePage,
      per_page: perPage,
    }),
  });

  // P2.2: Group the loaded page's authority rows by the selected dimension.
  // Grouping operates on the rows already loaded for the current page (server
  // pagination is unchanged); 'none' keeps the flat table below.
  const groupedRows = useMemo(() => {
    if (!tableData || groupBy === 'none') return null;
    const keyFor = (a: typeof tableData.items[number]) =>
      groupBy === 'account' ? a.account_url : a.authority_url;
    const map = new Map<string, typeof tableData.items>();
    for (const a of tableData.items) {
      const k = keyFor(a);
      const arr = map.get(k);
      if (arr) arr.push(a);
      else map.set(k, [a]);
    }
    // Largest groups first, then alphabetical for stable ordering.
    return [...map.entries()].sort((x, y) =>
      y[1].length - x[1].length || x[0].localeCompare(y[0])
    );
  }, [tableData, groupBy]);

  // B4: jump from an authority record to the governed identity in the tree.
  // account_url may be a sub-account (acc://adi/tokens); the Identity Explorer
  // selects ADIs, so resolve to the owning ADI (first path segment).
  const openAccountInTree = useCallback((accountUrl: string) => {
    const bare = accountUrl.replace('acc://', '');
    const adi = `acc://${bare.split('/')[0]}`;
    navigate(`/tree?select=${encodeURIComponent(adi)}`);
  }, [navigate]);

  return (
    <div className="authority-flows-view">

      {/* ── View intro: plain-language framing for this view. ── */}
      <div className="view-intro">
        <div className="view-intro__title">Authority Flows</div>
        <div className="view-intro__lead">
          Who can sign for whom — how each identity’s accounts are governed by key books, including delegated and cross-identity control.
        </div>
        <div className="view-intro__audience">Governance · for auditors</div>
      </div>

      {/* ── Summary Strip ── */}
      {stats && (
        <GlassCard gradientTop delay={0}>
          <div className="af-summary-strip">
            <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 2 }}>
              <StatOrb value={stats.authority_stats.explicit} label="Explicit" {...getEntityColor('adi')} delay={0} />
              <InfoTip term="implied-explicit" />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 2 }}>
              <StatOrb value={stats.authority_stats.implied} label="Implied" {...getEntityColor('authority')} delay={0.05} />
              <InfoTip term="implied-explicit" />
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 2 }}>
              <StatOrb value={stats.counts.account_authorities} label="Total Records" {...getEntityColor('authority')} delay={0.1} />
              <InfoTip term="authority" />
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <HeatStrip segments={[
              { value: stats.authority_stats.explicit, color: '#6c8cff', label: 'Explicit' },
              { value: stats.authority_stats.implied, color: '#f59e0b', label: 'Implied' },
            ]} height={8} />
            <div style={{ display: 'flex', gap: 16, marginTop: 6, justifyContent: 'center' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6c8cff' }} /> Explicit
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-tertiary)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} /> Implied
              </span>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── 6A. Authority Flow Diagram (Sankey-like) ── */}
      {flows && flows.sankey_flows.length > 0 && (
        <GlassCard title="Authority Flow" titleRight={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {sankeyFilter && (
              <>
                <GlowBadge variant="adi">Filtered: {shortUrl(sankeyFilter).slice(0, 20)}</GlowBadge>
                <button className="accounts-clear-btn" onClick={() => setSankeyFilter(null)}>Clear</button>
              </>
            )}
            <InfoTip term="authority" />
          </div>
        } delay={0.08}>
          <SankeyDiagram flows={flows.sankey_flows} onNodeClick={(url) => {
            setSankeyFilter(url);
            setTableFilter(url);
            setTablePage(1);
          }} />
        </GlassCard>
      )}

      {/* ── 6B + 6C. Chord + Table Row ── */}
      <div className="af-mid-row">
        {/* Chord Diagram */}
        {flows && flows.chord_data.length > 0 && (
          <GlassCard title="Cross-ADI Authority Web" titleRight={<InfoTip term="cross-adi" />} delay={0.15} style={{ flex: 1 }}>
            {/* B1: cross-identity control — only rendered when chord links exist. */}
            <RiskNote risk="cross-adi" compact />
            <ChordDiagram data={flows.chord_data} />
          </GlassCard>
        )}

        {/* Authority Table */}
        <GlassCard title="Authority Records" titleRight={
          <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
            {tableData?.total || 0} records
          </span>
        } delay={0.18} style={{ flex: 1.2 }}>
          <div className="af-table-toolbar">
            <input
              placeholder="Filter by URL..."
              value={tableFilter}
              onChange={e => { setTableFilter(e.target.value); setTablePage(1); }}
              className="accounts-filter-input"
            />
            <label className="af-checkbox-label">
              <input type="checkbox" checked={tableImplied} onChange={e => { setTableImplied(e.target.checked); setTablePage(1); }} />
              Implied only
            </label>
            <select value={groupBy} onChange={e => setGroupBy(e.target.value as 'none' | 'account' | 'authority')} className="accounts-filter-select">
              <option value="none">No grouping</option>
              <option value="account">Group by account</option>
              <option value="authority">Group by authority</option>
            </select>
            {tableData && tableData.items.length > 0 && (
              <ExportButton
                filename="authorities"
                onExportCSV={() => toCSV(tableData.items.map(a => ({
                  account_url: a.account_url,
                  authority_url: a.authority_url,
                  type: a.is_implied ? 'implied' : 'explicit',
                  disabled: a.disabled ? 'yes' : 'no',
                })))}
              />
            )}
          </div>

          {/* B2: disabled authorities are listed in this table — surface the
              risk only when the current page actually contains a disabled row. */}
          {!tableLoading && tableData && tableData.items.some(a => !!a.disabled) && (
            <div style={{ marginBottom: 10 }}>
              <RiskNote risk="disabled-authority" compact />
            </div>
          )}

          {tableLoading ? (
            <PageLoader message="Loading authority records..." />
          ) : tableData && tableData.items.length === 0 ? (
            <EmptyState icon={'\u2B21'} title="No authority records found" description={tableFilter ? `No results matching "${tableFilter}".` : 'No authority records in the database.'} compact />
          ) : tableData && (
            <>
              <div className="accounts-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th><TermLabel term="key-book">Key Book</TermLabel></th>
                      <th><TermLabel term="implied-explicit">Type</TermLabel></th>
                      <th><TermLabel term="authority">Disabled</TermLabel></th>
                    </tr>
                  </thead>
                  {groupedRows ? (
                    // Grouped view: one <tbody> per group, headed by the group
                    // key + its row count. Server pagination is unchanged, so
                    // this groups the rows loaded for the current page.
                    groupedRows.map(([groupKey, rows]) => (
                      <tbody key={groupKey} className="af-group">
                        <tr className="af-group-header">
                          <th colSpan={4}>
                            <span
                              className="url-link"
                              style={{ fontSize: 11, cursor: 'pointer' }}
                              onClick={() => {
                                setSankeyFilter(groupKey);
                                setTableFilter(groupKey);
                                setTablePage(1);
                              }}
                            >
                              {shortUrl(groupKey)}
                            </span>
                            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 400 }}>
                              {rows.length} {rows.length === 1 ? 'record' : 'records'}
                            </span>
                          </th>
                        </tr>
                        {rows.map((a, i) => (
                          <AuthorityRow key={`${groupKey}-${i}`} a={a} onOpenAccount={openAccountInTree} />
                        ))}
                      </tbody>
                    ))
                  ) : (
                    <tbody>
                      {tableData.items.map((a, i) => (
                        <AuthorityRow key={i} a={a} onOpenAccount={openAccountInTree} />
                      ))}
                    </tbody>
                  )}
                </table>
              </div>
              <div className="accounts-footer" style={{ marginTop: 8 }}>
                <span className="accounts-showing">
                  Showing {(tablePage - 1) * perPage + 1}-{Math.min(tablePage * perPage, tableData.total)} of {tableData.total}
                </span>
                <div className="pagination">
                  <button disabled={tablePage <= 1} onClick={() => setTablePage(tablePage - 1)}>Prev</button>
                  <span>{tablePage}/{Math.ceil(tableData.total / perPage)}</span>
                  <button disabled={tablePage >= Math.ceil(tableData.total / perPage)} onClick={() => setTablePage(tablePage + 1)}>Next</button>
                </div>
              </div>
            </>
          )}
        </GlassCard>
      </div>

      {/* ── 6D. Delegation Flow ── */}
      {flows && flows.delegations.length > 0 && (
        <GlassCard title="Delegation Chains" titleRight={<InfoTip term="delegation" />} delay={0.25}>
          <DelegationFlow delegations={flows.delegations} />
        </GlassCard>
      )}

      {/* ── Top Key Books (A5: renamed from "Authority Books"; data field is still authority_url) ── */}
      {flows && flows.top_books.length > 0 && (
        <GlassCard title="Top Key Books" titleRight={<InfoTip term="key-book" />} delay={0.3}>
          {/* B1+B2: authority concentration — these books govern a large share of
              accounts. Shown only when there are top books (panel guard). */}
          <RiskNote risk="concentration" compact />
          <div className="af-top-books">
            {flows.top_books.slice(0, 10).map((b, i) => (
              <div key={i} className="af-top-book">
                <div className="af-top-book-left">
                  {/* D5: surface the unit on the headline integer so it reads as
                      "{n} accounts governed" rather than a bare number. */}
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 28 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: '#f59e0b' }}>
                      <AnimatedCounter value={b.total_governed} />
                    </span>
                    <span style={{ fontSize: 8, color: 'var(--text-tertiary)', lineHeight: 1.1, textAlign: 'center' }}>
                      accounts governed
                    </span>
                  </span>
                  <div>
                    <div className="url-link" style={{ fontSize: 11 }}>{shortUrl(b.authority_url)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Owner: {shortUrl(b.owner_adi)}</div>
                  </div>
                </div>
                <div className="af-top-book-right">
                  <GlowBadge variant="adi">{b.explicit} explicit</GlowBadge>
                  <GlowBadge variant="authority">{b.implied} implied</GlowBadge>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}

/* ─── Sankey-like Flow Diagram (SVG) ─────────── */

interface SankeyFlow {
  source: string;
  target: string;
  value: number;
  is_implied: boolean;
}

function SankeyDiagram({ flows, onNodeClick }: { flows: SankeyFlow[]; onNodeClick: (url: string) => void }) {
  const { isDark } = useTheme();
  const tc = getThemeColors(isDark);
  const [hovered, setHovered] = useState<string | null>(null);

  // Derive unique sources (ADIs) and targets (authority books)
  const { sources, targets, maxValue } = useMemo(() => {
    const srcMap = new Map<string, number>();
    const tgtMap = new Map<string, number>();
    let maxVal = 0;
    for (const f of flows) {
      srcMap.set(f.source, (srcMap.get(f.source) || 0) + f.value);
      tgtMap.set(f.target, (tgtMap.get(f.target) || 0) + f.value);
      maxVal = Math.max(maxVal, f.value);
    }
    // Sort by total value descending
    const sources = [...srcMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    const targets = [...tgtMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    return { sources, targets, maxValue: maxVal };
  }, [flows]);

  const W = 900;
  const leftX = 180;
  const rightX = W - 180;
  const nodeH = 22;
  const padY = 6;

  const totalLeftH = sources.length * (nodeH + padY);
  const totalRightH = targets.length * (nodeH + padY);
  const H = Math.max(totalLeftH, totalRightH) + 60;

  const leftPositions = useMemo(() => {
    const map = new Map<string, number>();
    const startY = (H - totalLeftH) / 2;
    sources.forEach(([url], i) => {
      map.set(url, startY + i * (nodeH + padY) + nodeH / 2);
    });
    return map;
  }, [sources, H, totalLeftH]);

  const rightPositions = useMemo(() => {
    const map = new Map<string, number>();
    const startY = (H - totalRightH) / 2;
    targets.forEach(([url], i) => {
      map.set(url, startY + i * (nodeH + padY) + nodeH / 2);
    });
    return map;
  }, [targets, H, totalRightH]);

  // Filter flows to only those in our visible sources/targets
  const visibleSourceSet = new Set(sources.map(s => s[0]));
  const visibleTargetSet = new Set(targets.map(t => t[0]));
  const visibleFlows = flows.filter(f => visibleSourceSet.has(f.source) && visibleTargetSet.has(f.target));

  const sankeyAriaLabel = `Authority flow diagram: ${visibleFlows.length} flows from ${sources.length} ADIs to ${targets.length} key books, split by explicit and implied authority.`;

  return (
    <div className="af-sankey-container">
      {/* P3.7 mobile: the Sankey is a fixed-aspect diagram with small mono
          labels. On narrow viewports scale it down too far and the text is
          unreadable, so keep a sensible min-width and scroll horizontally
          instead of overflowing the card. */}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="af-sankey-svg" role="img" aria-label={sankeyAriaLabel}
        style={{ width: '100%', minWidth: 560, display: 'block' }}>
        {/* Flow paths */}
        {visibleFlows.map((f, i) => {
          const sy = leftPositions.get(f.source);
          const ty = rightPositions.get(f.target);
          if (sy == null || ty == null) return null;

          const thickness = Math.max(1, (f.value / maxValue) * 8);
          const isHigh = hovered === f.source || hovered === f.target;
          const isDim = hovered && !isHigh;
          const color = f.is_implied ? '#f59e0b' : '#6c8cff';

          const midX = (leftX + rightX) / 2;
          const path = `M ${leftX + 10} ${sy} C ${midX} ${sy}, ${midX} ${ty}, ${rightX - 10} ${ty}`;

          return (
            <path
              key={i}
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={thickness}
              // P3.4 color-blind safety: encode implied vs explicit with a
              // redundant non-hue cue. Implied flows are dashed; explicit flows
              // are solid. Color stays the primary channel. Dash scales with
              // stroke width so the pattern reads at every thickness.
              strokeDasharray={f.is_implied ? `${Math.max(3, thickness * 1.5)} ${Math.max(2, thickness)}` : undefined}
              opacity={isDim ? 0.06 : isHigh ? 0.6 : 0.15}
              className={isHigh ? 'af-sankey-flow--active' : ''}
            />
          );
        })}

        {/* Source nodes (ADIs) */}
        {sources.map(([url, total]) => {
          const y = leftPositions.get(url)!;
          const isHigh = hovered === url;
          return (
            <g key={`s-${url}`}
              onMouseEnter={() => setHovered(url)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick(url)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={10} y={y - nodeH / 2} width={leftX - 20} height={nodeH}
                rx={6} fill={isHigh ? 'rgba(108,140,255,0.15)' : 'rgba(108,140,255,0.06)'}
                stroke={isHigh ? '#6c8cff' : 'rgba(108,140,255,0.12)'} strokeWidth={0.8} />
              <text x={20} y={y + 4} fill={isHigh ? tc.canvasText : tc.canvasTextDim}
                fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(url).slice(0, 20)}
              </text>
              <text x={leftX - 16} y={y + 4} fill="#6c8cff" fontSize={8}
                textAnchor="end" fontWeight={600}>
                {total}
              </text>
            </g>
          );
        })}

        {/* Target nodes (Authority books) */}
        {targets.map(([url, total]) => {
          const y = rightPositions.get(url)!;
          const isHigh = hovered === url;
          return (
            <g key={`t-${url}`}
              onMouseEnter={() => setHovered(url)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick(url)}
              style={{ cursor: 'pointer' }}
            >
              <rect x={rightX - 10} y={y - nodeH / 2} width={W - rightX} height={nodeH}
                rx={6} fill={isHigh ? 'rgba(245,158,11,0.15)' : 'rgba(245,158,11,0.06)'}
                stroke={isHigh ? '#f59e0b' : 'rgba(245,158,11,0.12)'} strokeWidth={0.8} />
              <text x={rightX} y={y + 4} fill={isHigh ? tc.canvasText : tc.canvasTextDim}
                fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(url).slice(0, 22)}
              </text>
              <text x={W - 16} y={y + 4} fill="#f59e0b" fontSize={8}
                textAnchor="end" fontWeight={600}>
                {total}
              </text>
            </g>
          );
        })}

        {/* Column labels */}
        <text x={leftX / 2} y={16} textAnchor="middle" fill={tc.canvasTextMuted} fontSize={10} fontWeight={600}>
          ADIs
        </text>
        <text x={rightX + (W - rightX) / 2} y={16} textAnchor="middle" fill={tc.canvasTextMuted} fontSize={10} fontWeight={600}>
          Key Books
        </text>

        {/* Legend — P3.4: show both the color AND the solid/dashed cue so the
            explicit/implied distinction reads without relying on hue. */}
        <g transform={`translate(${W / 2 - 95}, ${H - 16})`}>
          <line x1={0} y1={4} x2={16} y2={4} stroke="#6c8cff" strokeWidth={2} />
          <text x={20} y={7} fill={tc.canvasTextDim} fontSize={9}>Explicit (solid)</text>
          <line x1={95} y1={4} x2={111} y2={4} stroke="#f59e0b" strokeWidth={2} strokeDasharray="4 2" />
          <text x={115} y={7} fill={tc.canvasTextDim} fontSize={9}>Implied (dashed)</text>
        </g>
      </svg>
      </div>

      {/* D2: plain-language "how to read this" caption, matching the
          Lorenz/radar caption styling on the Intelligence view. D5: the number
          beside each node is its governance-link count, labelled here so the
          bare integers in the diagram read in units. */}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
        Each ribbon is an ADI’s accounts flowing to the key book that governs them — thicker = more accounts. Solid = explicit, dashed = implied. The number beside each node is its total governance links.
      </div>

      {/* Visually-hidden data-table alternative for screen readers (P2.7). */}
      <table className="sr-only">
        <caption>{sankeyAriaLabel}</caption>
        <thead>
          <tr><th>ADI (source)</th><th>Key Book (target)</th><th>Value</th><th>Type</th></tr>
        </thead>
        <tbody>
          {visibleFlows.map((f, i) => (
            <tr key={i}>
              <td>{shortUrl(f.source)}</td>
              <td>{shortUrl(f.target)}</td>
              <td>{f.value}</td>
              <td>{f.is_implied ? 'implied' : 'explicit'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Chord Diagram (Canvas) ─────────────────── */

interface ChordLink {
  source: string;
  target: string;
  value: number;
}

function ChordDiagram({ data }: { data: ChordLink[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { isDark } = useTheme();
  const tc = getThemeColors(isDark);
  const [hovered, setHovered] = useState<string | null>(null);
  // P3.5: track the cursor position (in container/CSS-pixel coords) so the
  // tooltip can follow the pointer instead of being pinned to a fixed corner.
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dims, setDims] = useState({ width: 400, height: 400 });

  // Get unique ADIs
  const adis = useMemo(() => {
    const set = new Set<string>();
    for (const d of data) {
      set.add(d.source);
      set.add(d.target);
    }
    return [...set].sort();
  }, [data]);

  // Measure container with a ResizeObserver (mirrors NetworkGraph) so the
  // chord canvas tracks layout/responsive changes, not just the mount size.
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const w = Math.round(el.clientWidth);
        if (w > 0) {
          setDims({ width: w, height: Math.min(w, 400) });
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = dims;

    // devicePixelRatio scaling: size the backing store to physical pixels and
    // the element to CSS pixels, then scale the context so all draw logic below
    // stays in CSS-pixel coordinates (crisp on Retina). Mirrors NetworkGraph.
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = tc.canvasBg;
    ctx.fillRect(0, 0, width, height);

    if (adis.length === 0) return;

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.38;
    const arcGap = 0.02;
    const arcLen = (2 * Math.PI - arcGap * adis.length) / adis.length;

    // Position arcs
    const arcPositions = new Map<string, { startAngle: number; endAngle: number; midAngle: number }>();
    adis.forEach((adi, i) => {
      const start = i * (arcLen + arcGap) - Math.PI / 2;
      arcPositions.set(adi, {
        startAngle: start,
        endAngle: start + arcLen,
        midAngle: start + arcLen / 2,
      });
    });

    const maxVal = Math.max(1, ...data.map(d => d.value));

    // Draw chords
    for (const link of data) {
      const src = arcPositions.get(link.source);
      const tgt = arcPositions.get(link.target);
      if (!src || !tgt) continue;

      const isHigh = hovered === link.source || hovered === link.target;
      const isDim = hovered && !isHigh;

      const sx = cx + Math.cos(src.midAngle) * radius;
      const sy = cy + Math.sin(src.midAngle) * radius;
      const tx = cx + Math.cos(tgt.midAngle) * radius;
      const ty = cy + Math.sin(tgt.midAngle) * radius;

      const alpha = isDim ? 0.03 : isHigh ? 0.35 : 0.1;
      const thickness = Math.max(1, (link.value / maxVal) * 5);

      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, tx, ty);
      ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
      ctx.lineWidth = thickness;
      ctx.stroke();
    }

    // Draw arcs
    adis.forEach((adi) => {
      const pos = arcPositions.get(adi)!;
      const isHigh = hovered === adi;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, pos.startAngle, pos.endAngle);
      ctx.strokeStyle = isHigh ? '#f59e0b' : '#6c8cff';
      ctx.lineWidth = isHigh ? 5 : 3;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Label
      const labelAngle = pos.midAngle;
      const labelR = radius + 14;
      const lx = cx + Math.cos(labelAngle) * labelR;
      const ly = cy + Math.sin(labelAngle) * labelR;
      const flip = labelAngle > Math.PI / 2 && labelAngle < Math.PI * 1.5;

      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(flip ? (labelAngle + Math.PI) : labelAngle);
      ctx.font = `${isHigh ? '600 ' : ''}9px Inter, sans-serif`;
      ctx.fillStyle = isHigh ? tc.canvasText : tc.canvasTextMuted;
      ctx.textAlign = flip ? 'end' : 'start';
      ctx.textBaseline = 'middle';
      ctx.fillText(shortUrl(adi).slice(0, 16), 0, 0);
      ctx.restore();
    });
  }, [adis, data, hovered, dims, tc]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setMousePos({ x: mx, y: my });
    const cx = dims.width / 2;
    const cy = dims.height / 2;
    const radius = Math.min(dims.width, dims.height) * 0.38;

    const dist = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
    if (dist < radius - 15 || dist > radius + 25) {
      setHovered(null);
      return;
    }

    let angle = Math.atan2(my - cy, mx - cx);
    if (angle < -Math.PI / 2) angle += 2 * Math.PI;

    const arcGap = 0.02;
    const arcLen = (2 * Math.PI - arcGap * adis.length) / adis.length;

    for (let i = 0; i < adis.length; i++) {
      const start = i * (arcLen + arcGap) - Math.PI / 2;
      const end = start + arcLen;
      if (angle >= start && angle <= end) {
        setHovered(adis[i]);
        return;
      }
    }
    setHovered(null);
  }, [adis, dims]);

  const chordAriaLabel = `Authority chord diagram: ${adis.length} ADIs with ${data.length} cross-ADI authority relationships.`;

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={chordAriaLabel}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        style={{ display: 'block', borderRadius: 12, cursor: hovered ? 'pointer' : 'default' }}
      />
      {hovered && (() => {
        // P3.5: cursor-anchored tooltip. Offset from the pointer, then clamp
        // so the box stays inside the canvas container at all edges.
        const TW = 180, TH = 46, OFF = 14;
        const left = Math.max(4, Math.min(mousePos.x + OFF, dims.width - TW - 4));
        const top = Math.max(4, Math.min(mousePos.y + OFF, dims.height - TH - 4));
        return (
        <div style={{
          position: 'absolute', left, top,
          background: isDark ? 'rgba(17,22,40,0.92)' : 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8,
          padding: '6px 10px', fontSize: 11, pointerEvents: 'none',
          maxWidth: TW,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>
            {shortUrl(hovered)}
          </div>
          <div style={{ color: 'var(--text-secondary)' }}>
            {data.filter(d => d.source === hovered || d.target === hovered).length} cross-ADI links
          </div>
        </div>
        );
      })()}
      <div style={{
        position: 'absolute', bottom: 6, left: 6,
        fontSize: 9, color: 'var(--text-tertiary)', opacity: 0.6,
      }}>
        {adis.length} ADIs &middot; {data.length} cross-authority links
      </div>

      {/* Visually-hidden data-table alternative for screen readers (P2.7). */}
      <table className="sr-only">
        <caption>{chordAriaLabel}</caption>
        <thead>
          <tr><th>Source ADI</th><th>Target ADI</th><th>Shared authority links</th></tr>
        </thead>
        <tbody>
          {data.map((d, i) => (
            <tr key={i}>
              <td>{shortUrl(d.source)}</td>
              <td>{shortUrl(d.target)}</td>
              <td>{d.value}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* D2: plain-language "how to read this" caption, matching the
          Lorenz/radar caption styling on the Intelligence view. */}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
        Each arc links two identities where one’s accounts are governed by the other’s key book — i.e. control that crosses an identity boundary.
      </div>
    </div>
  );
}

/* ─── Delegation Flow (SVG) ──────────────────── */

interface Delegation {
  delegator_adi: string;
  key_page: string;
  delegate_book: string;
  key_hash: string | null;
}

function DelegationFlow({ delegations }: { delegations: Delegation[] }) {
  const { isDark } = useTheme();
  const tc = getThemeColors(isDark);
  const [hoveredChain, setHoveredChain] = useState<number | null>(null);

  if (delegations.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
        No delegation chains found
      </div>
    );
  }

  const nodeW = 160;
  const nodeH = 32;
  const rowH = 70;
  const W = 760;
  const H = delegations.length * rowH + 40;

  const col1 = 30;
  const col2 = (W - nodeW) / 2;
  const col3 = W - nodeW - 30;

  const delegationAriaLabel = `Delegation chains diagram: ${delegations.length} chains, each flowing Delegator ADI to Key Page to Delegate Book.`;

  return (
    <div className="af-delegation-container">
      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 8 }}>
        {delegations.length} delegation chains: Delegator ADI {'\u2192'} Key Page {'\u2192'} Delegate Book
      </div>
      {/* D2: plain-language "how to read this" caption, matching the
          Lorenz/radar caption styling on the Intelligence view. */}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>
        Each row traces signing power passed from an identity\u2019s key page to another key book.
      </div>
      {/* P3.7 mobile: keep a readable min-width and scroll horizontally on
          narrow viewports rather than crushing the three-column layout. */}
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="af-delegation-svg" role="img" aria-label={delegationAriaLabel}
        style={{ width: '100%', minWidth: 560, display: 'block' }}>
        {/* Column headers */}
        <text x={col1 + nodeW / 2} y={16} textAnchor="middle" fill={tc.canvasTextMuted} fontSize={10} fontWeight={600}>Delegator ADI</text>
        <text x={col2 + nodeW / 2} y={16} textAnchor="middle" fill={tc.canvasTextMuted} fontSize={10} fontWeight={600}>Key Page</text>
        <text x={col3 + nodeW / 2} y={16} textAnchor="middle" fill={tc.canvasTextMuted} fontSize={10} fontWeight={600}>Delegate Book</text>

        {delegations.map((d, i) => {
          const y = 30 + i * rowH + nodeH / 2;
          const isHigh = hoveredChain === i;

          return (
            <g key={i}
              onMouseEnter={() => setHoveredChain(i)}
              onMouseLeave={() => setHoveredChain(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Arrows */}
              <line x1={col1 + nodeW + 4} y1={y} x2={col2 - 4} y2={y}
                stroke={isHigh ? '#34d399' : 'rgba(52,211,153,0.25)'} strokeWidth={isHigh ? 2 : 1}
                markerEnd="url(#arrowGreen)" />
              <line x1={col2 + nodeW + 4} y1={y} x2={col3 - 4} y2={y}
                stroke={isHigh ? '#34d399' : 'rgba(52,211,153,0.25)'} strokeWidth={isHigh ? 2 : 1}
                markerEnd="url(#arrowGreen)" />

              {/* Animated dot on hover */}
              {isHigh && (
                <>
                  <circle r={3} fill="#34d399">
                    <animateMotion dur="1.5s" repeatCount="indefinite"
                      path={`M ${col1 + nodeW + 4} ${y} L ${col3 + nodeW} ${y}`} />
                  </circle>
                </>
              )}

              {/* Delegator ADI */}
              <rect x={col1} y={y - nodeH / 2} width={nodeW} height={nodeH}
                rx={6} fill={isHigh ? 'rgba(108,140,255,0.12)' : 'rgba(108,140,255,0.05)'}
                stroke={isHigh ? '#6c8cff' : 'rgba(108,140,255,0.12)'} strokeWidth={0.8} />
              <text x={col1 + 8} y={y + 4} fill={isHigh ? tc.canvasText : tc.canvasTextDim}
                fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(d.delegator_adi).slice(0, 20)}
              </text>

              {/* Key Page */}
              <rect x={col2} y={y - nodeH / 2} width={nodeW} height={nodeH}
                rx={6} fill={isHigh ? 'rgba(52,211,153,0.12)' : 'rgba(52,211,153,0.05)'}
                stroke={isHigh ? '#34d399' : 'rgba(52,211,153,0.12)'} strokeWidth={0.8} />
              <text x={col2 + 8} y={y + 4} fill={isHigh ? tc.canvasText : tc.canvasTextDim}
                fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(d.key_page).slice(0, 20)}
              </text>

              {/* Delegate Book */}
              <rect x={col3} y={y - nodeH / 2} width={nodeW} height={nodeH}
                rx={6} fill={isHigh ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.05)'}
                stroke={isHigh ? '#f59e0b' : 'rgba(245,158,11,0.12)'} strokeWidth={0.8} />
              <text x={col3 + 8} y={y + 4} fill={isHigh ? tc.canvasText : tc.canvasTextDim}
                fontSize={9} fontFamily="var(--font-mono)">
                {shortUrl(d.delegate_book).slice(0, 20)}
              </text>
            </g>
          );
        })}

        {/* Arrow marker */}
        <defs>
          <marker id="arrowGreen" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 Z" fill="#34d399" />
          </marker>
        </defs>
      </svg>
      </div>

      {/* Visually-hidden data-table alternative for screen readers (P2.7). */}
      <table className="sr-only">
        <caption>{delegationAriaLabel}</caption>
        <thead>
          <tr><th>Delegator ADI</th><th>Key Page</th><th>Delegate Book</th></tr>
        </thead>
        <tbody>
          {delegations.map((d, i) => (
            <tr key={i}>
              <td>{shortUrl(d.delegator_adi)}</td>
              <td>{shortUrl(d.key_page)}</td>
              <td>{shortUrl(d.delegate_book)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
