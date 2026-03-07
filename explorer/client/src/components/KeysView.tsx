import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { StatOrb } from './ui/StatOrb';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { ExportButton, toCSV } from './ui/ExportButton';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';
import { getEntityColor } from '../hooks/useEntityColor';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import type { KeyBook, KeyPage } from '../types';

function shortUrl(url: string) { return url.replace('acc://', ''); }

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
    const avgThreshold = ks.total_pages > 0
      ? ((ks.multi_sig * 2 + ks.single_sig * 1) / ks.total_pages).toFixed(1)
      : '0';
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
                </div>
                <div className="kv-metric-sub">
                  <AnimatedCounter value={securityMetrics.totalPages} /> pages
                </div>
              </div>

              {/* Multi-sig Adoption */}
              <div className="kv-metric-card">
                <RingGauge
                  value={securityMetrics.multiSigRate}
                  size={80}
                  strokeWidth={6}
                  color={securityMetrics.multiSigRate > 0.3 ? '#22c55e' : securityMetrics.multiSigRate > 0.1 ? '#f59e0b' : '#ef4444'}
                  valueLabel={`${(securityMetrics.multiSigRate * 100).toFixed(1)}%`}
                  label="Multi-sig"
                />
                <div className="kv-metric-detail">
                  <span style={{ color: '#22c55e' }}><AnimatedCounter value={securityMetrics.multiSig} /> multi</span>
                  <span style={{ color: '#f59e0b' }}><AnimatedCounter value={securityMetrics.singleSig} /> single</span>
                </div>
              </div>

              {/* Shared Keys */}
              <div className="kv-metric-card">
                <div className="kv-metric-big" style={{ color: securityMetrics.sharedKeyCount > 0 ? '#ef4444' : '#22c55e' }}>
                  <AnimatedCounter value={securityMetrics.sharedKeyCount} />
                </div>
                <div className="kv-metric-label">Shared Keys</div>
                {securityMetrics.sharedKeyCount > 0 && (
                  <GlowBadge variant="danger">security risk</GlowBadge>
                )}
              </div>

              {/* Average Threshold */}
              <div className="kv-metric-card">
                <div className="kv-metric-big" style={{ color: '#6c8cff' }}>
                  {securityMetrics.avgThreshold}
                </div>
                <div className="kv-metric-label">Avg Threshold</div>
                <div className="kv-metric-detail">
                  <span style={{ color: '#ef4444' }}><AnimatedCounter value={securityMetrics.zeroCreditPages} /> zero-credit</span>
                </div>
              </div>
            </div>
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
          <div className="kv-book-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="shimmer" style={{ height: 100, borderRadius: 10 }} />
            ))}
          </div>
        ) : filteredBooks.length === 0 ? (
          <EmptyState icon={'\u2B22'} title="No key books found" description={searchFilter ? `No results matching "${searchFilter}".` : 'No key books in the database.'} compact />
        ) : (
          <>
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
        <GlassCard title="Key Sharing Network" delay={0.2}>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            ADIs connected by shared cryptographic keys. Red intensity = more shared keys.
          </div>
          <KeySharingGraph keyReuse={intel.key_reuse} />
        </GlassCard>
      )}

      {/* ── 5D. Key Timeline ── */}
      {intel && (
        <GlassCard title="Key Activity Timeline" delay={0.3}>
          <KeyTimeline />
        </GlassCard>
      )}
    </div>
  );
}

/* ─── Key Book Grid Card ─────────────────────── */

function KeyBookGridCard({ book, sharedKeys }: {
  book: KeyBook;
  sharedKeys: { key_hash: string; adi_count: number; adi_urls: string[] }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const { data: detail } = useQuery({
    queryKey: ['key-book-detail', book.url],
    queryFn: () => api.getKeyBook(book.url),
    enabled: expanded,
  });

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
            {!detail?.pages ? (
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
  const [dims, setDims] = useState({ width: 800, height: 350 });
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // Build graph data
  const graphData = useMemo(() => {
    const nodeSet = new Set<string>();
    const edges: { source: string; target: string; weight: number }[] = [];

    for (const kr of keyReuse) {
      for (const adi of kr.adi_urls) {
        nodeSet.add(adi);
      }
      // Connect all ADIs sharing this key
      for (let i = 0; i < kr.adi_urls.length; i++) {
        for (let j = i + 1; j < kr.adi_urls.length; j++) {
          const existing = edges.find(
            e => (e.source === kr.adi_urls[i] && e.target === kr.adi_urls[j]) ||
                 (e.source === kr.adi_urls[j] && e.target === kr.adi_urls[i])
          );
          if (existing) existing.weight++;
          else edges.push({ source: kr.adi_urls[i], target: kr.adi_urls[j], weight: 1 });
        }
      }
    }

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
      pos.set(n.id, {
        x: centerX + Math.cos(angle) * radius * (0.6 + Math.random() * 0.4),
        y: centerY + Math.sin(angle) * radius * (0.6 + Math.random() * 0.4),
      });
    });
    return pos;
  }, [graphData, dims]);

  // Measure container
  useEffect(() => {
    if (containerRef.current) {
      setDims({ width: containerRef.current.clientWidth, height: 350 });
    }
  }, []);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dims.width;
    canvas.height = dims.height;

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

      // Label
      if (isHov || node.sharedKeys > 3) {
        const label = shortUrl(node.id).slice(0, 18);
        ctx.font = '9px Inter, sans-serif';
        ctx.fillStyle = themeColors.canvasText;
        ctx.textAlign = 'center';
        ctx.fillText(label, pos.x, pos.y + size + 12);
      }
    }
  }, [graphData, positions, hovered, dims, isDark, themeColors]);

  // Handle hover
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

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

  return (
    <div ref={containerRef} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        width={dims.width}
        height={dims.height}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHovered(null)}
        style={{ display: 'block', cursor: hovered ? 'pointer' : 'default' }}
      />

      {/* Hover tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 10, right: 10,
          background: isDark ? 'rgba(17,22,40,0.92)' : 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
          border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8,
          padding: '8px 12px', fontSize: 11, color: 'var(--text-secondary)',
          pointerEvents: 'none',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            {shortUrl(hovered)}
          </div>
          <div>Shared keys: <strong style={{ color: '#ef4444' }}>
            {graphData.nodes.find(n => n.id === hovered)?.sharedKeys || 0}
          </strong></div>
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 8, left: 8,
        background: isDark ? 'rgba(17,22,40,0.85)' : 'rgba(255,255,255,0.90)', borderRadius: 6,
        padding: '4px 8px', fontSize: 9, color: 'var(--text-tertiary)',
        display: 'flex', gap: 10,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
          Low sharing
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
          High sharing
        </span>
        <span>{graphData.nodes.length} nodes &middot; {graphData.edges.length} edges</span>
      </div>
    </div>
  );
}

/* ─── Key Timeline ───────────────────────────── */

function KeyTimeline() {
  const { data: keyPages } = useQuery({
    queryKey: ['key-pages-timeline'],
    queryFn: () => api.listKeyPages({ per_page: 500 }),
    staleTime: 300000,
  });

  const timelineData = useMemo(() => {
    if (!keyPages) return { total: 0, recent: 0, old: 0, never: 0 };

    // Collect all key entries with last_used_on
    const entries: { hash: string; lastUsed: number | null; pageUrl: string }[] = [];
    for (const page of keyPages.items) {
      for (const key of page.keys) {
        entries.push({
          hash: key.public_key_hash || key.public_key || 'unknown',
          lastUsed: key.last_used_on,
          pageUrl: page.url,
        });
      }
    }

    // Group by activity status
    const now = Date.now() / 1000;
    let recent = 0, old = 0, never = 0;
    for (const e of entries) {
      if (!e.lastUsed) { never++; continue; }
      const age = now - e.lastUsed;
      if (age < 86400 * 90) recent++;
      else old++;
    }

    return { total: entries.length, recent, old, never };
  }, [keyPages]);

  if (!keyPages || !timelineData.total) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 12 }}>
        No key activity data available
      </div>
    );
  }

  const { total, recent, old, never } = timelineData;

  return (
    <div className="kv-timeline">
      <div className="kv-timeline-bars">
        {[
          { label: 'Recent (< 90 days)', count: recent, color: '#22c55e' },
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
        {total} total key entries across {keyPages.items.length} pages
      </div>
    </div>
  );
}
