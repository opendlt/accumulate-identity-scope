import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { HeatStrip } from './ui/HeatStrip';
import { ErrorState } from './ui/ErrorState';
import { PageLoader } from './ui/PageLoader';
import { InfoTip } from './ui/InfoTip';
import { RiskNote } from './ui/RiskNote';
import { SEVERITY_SCALE_NOTE } from '../content/risks';
import type { Intelligence } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../hooks/useThemeColors';
function shortUrl(url: string) { return url.replace('acc://', ''); }

/* Mobile responsiveness (P3.7): a matchMedia-driven flag so multi-column
   sections can collapse to one column on narrow screens without editing
   globals.css. Desktop layout is untouched (flag is false above the breakpoint). */
function useIsNarrow(maxWidth = 680) {
  const query = `(max-width: ${maxWidth}px)`;
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(query);
    const onChange = () => setIsNarrow(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return isNarrow;
}

/* ═══════════════════════════════════════════════
   7A. INSIGHT FEED
   ═══════════════════════════════════════════════ */

// Maps an insight `link` to the human-readable action described in its aria-label.
const LINK_ACTION_LABEL: Record<string, string> = {
  keys: 'Go to Key Reuse Clusters',
  authority: 'Go to Authority Concentration',
  delegations: 'Go to Authority Concentration',
  concentration: 'Go to Authority Concentration',
};

function InsightFeed({ data, onNavigate }: { data: Intelligence; onNavigate: (link: string) => void }) {
  const insights: { severity: string; icon: string; text: string; detail: string; link?: string }[] = [];

  if (data.key_reuse.length > 0) {
    const top = data.key_reuse[0];
    insights.push({
      severity: 'danger', icon: '\u26A0',
      text: `1 key controls ${top.adi_count} ADIs — centralization risk`,
      detail: top.key_hash.slice(0, 16) + '...',
      link: 'keys',
    });
  }
  const multiPct = data.key_security.total_pages > 0
    ? (data.key_security.multi_sig / data.key_security.total_pages * 100) : 0;
  if (multiPct < 10) {
    insights.push({
      severity: 'warning', icon: '\u25B2',
      text: `${multiPct.toFixed(1)}% multi-sig adoption — low security posture`,
      detail: `${data.key_security.multi_sig} of ${data.key_security.total_pages} pages`,
    });
  }
  if (data.empty_adis > 0) {
    insights.push({
      severity: 'adi', icon: '\u25C8',
      text: `${data.empty_adis} empty root ADIs — possible abandoned identities`,
      detail: 'No accounts, no sub-ADIs, no directory entries',
    });
  }
  if (data.cross_authority.length > 0) {
    const top = data.cross_authority[0];
    insights.push({
      severity: 'authority', icon: '\u2B2A',
      text: `${shortUrl(top.authority_url).slice(0, 22)} governs ${top.foreign_count} foreign accounts`,
      detail: `Cross-ADI authority from ${shortUrl(top.book_owner)}`,
      link: 'authority',
    });
  }
  if (data.delegations.length > 0) {
    insights.push({
      severity: 'key', icon: '\u2192',
      text: `${data.delegations.length} key delegation chains active`,
      detail: 'Multi-party governance on the network',
      link: 'delegations',
    });
  }
  if (data.key_security.zero_credit_pages > 0) {
    insights.push({
      severity: 'warning', icon: '\u25CB',
      text: `${data.key_security.zero_credit_pages} key pages with zero credits`,
      detail: 'Unable to process transactions without credits',
    });
  }

  // Concentration insight
  if (data.authority_concentration.length > 0) {
    const top5Total = data.authority_concentration.slice(0, 5).reduce((s, a) => s + a.total_accounts, 0);
    const allTotal = data.authority_concentration.reduce((s, a) => s + a.total_accounts, 0);
    const pct = allTotal > 0 ? (top5Total / allTotal * 100).toFixed(0) : '0';
    insights.push({
      severity: 'authority', icon: '\u25A3',
      text: `Top 5 authority books control ${pct}% of all governed accounts`,
      detail: 'Authority concentration analysis',
      link: 'concentration',
    });
  }

  return (
    <div className="intel-feed">
      {/* Feed heading carries the definitions for the recurring terms surfaced
          in the dynamic insight strings below (multi-sig, key reuse, cross-ADI,
          delegation, zero credits, concentration). */}
      <div className="intel-feed-heading" style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 4,
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Insight Feed</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Multi-sig <InfoTip term="multi-sig" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Key reuse <InfoTip term="key-reuse" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Cross-ADI <InfoTip term="cross-adi" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Delegation <InfoTip term="delegation" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Credits <InfoTip term="credits" />
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          Concentration <InfoTip term="gini" />
        </span>
      </div>
      {insights.map((ins, i) => {
        const link = ins.link;
        const interactive = !!link;
        const activate = () => { if (link) onNavigate(link); };
        return (
          <motion.div
            key={i}
            className="intel-feed-card"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06, duration: 0.35 }}
            {...(interactive ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': `${(link && LINK_ACTION_LABEL[link]) || 'View details'}: ${ins.text}`,
              style: { cursor: 'pointer' },
              onClick: activate,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activate();
                }
              },
            } : {})}
          >
            <div className={`intel-feed-accent intel-feed-accent--${ins.severity}`} />
            <div className="intel-feed-body">
              <GlowBadge variant={ins.severity as any}>{ins.icon}</GlowBadge>
              <div className="intel-feed-text">
                <div className="intel-feed-title">{ins.text}</div>
                <div className="intel-feed-detail">{ins.detail}</div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   7B. RISK HEATMAP
   ═══════════════════════════════════════════════ */

function RiskHeatmap({ data }: { data: Intelligence }) {
  const navigate = useNavigate();
  const [hoveredCell, setHoveredCell] = useState<{ adi: string; dim: string } | null>(null);

  // Build risk matrix
  const matrix = useMemo(() => {
    // Dimensions: shared_keys, single_sig, implied_only, no_credits, empty
    const adiRisks = new Map<string, Record<string, number>>();
    const emptyRisks = () => ({ shared_keys: 0, single_sig: 0, implied_only: 0, no_credits: 0 });

    // Per-ADI security map keyed by adi_url for single_sig / no_credits dimensions
    const securityByAdi = new Map<string, { single_sig: number; no_credits: number }>();
    for (const sec of data.adi_security) {
      securityByAdi.set(sec.adi_url, { single_sig: sec.single_sig, no_credits: sec.no_credits });
    }

    // Shared keys
    for (const kr of data.key_reuse) {
      for (const adi of kr.adi_urls) {
        if (!adiRisks.has(adi)) adiRisks.set(adi, emptyRisks());
        adiRisks.get(adi)!.shared_keys += 1;
      }
    }

    // Authority concentration — implied only
    for (const ac of data.authority_concentration) {
      const adi = ac.authority_url.split('/').slice(0, 1).join('/');
      const fullUrl = 'acc://' + adi;
      if (!adiRisks.has(fullUrl)) adiRisks.set(fullUrl, emptyRisks());
      if (ac.implied_count > 0 && ac.explicit_count === 0) {
        adiRisks.get(fullUrl)!.implied_only = 1;
      }
    }

    // (a) Populate single_sig / no_credits for every ADI already in the matrix
    for (const [adi, risks] of adiRisks) {
      const sec = securityByAdi.get(adi);
      if (sec) {
        risks.single_sig = sec.single_sig;
        risks.no_credits = sec.no_credits;
      }
    }

    // (b) Merge in ADIs from adi_security that carry single_sig or no_credits risk
    //     even if they aren't otherwise represented, so the heatmap is honest.
    for (const sec of data.adi_security) {
      if (sec.single_sig > 0 || sec.no_credits > 0) {
        if (!adiRisks.has(sec.adi_url)) adiRisks.set(sec.adi_url, emptyRisks());
        const risks = adiRisks.get(sec.adi_url)!;
        risks.single_sig = sec.single_sig;
        risks.no_credits = sec.no_credits;
      }
    }

    // Sort by total risk score
    const entries = [...adiRisks.entries()]
      .map(([adi, risks]) => ({
        adi,
        risks,
        totalRisk: Object.values(risks).reduce((s, v) => s + v, 0),
      }))
      .sort((a, b) => b.totalRisk - a.totalRisk)
      .slice(0, 20);

    return entries;
  }, [data]);

  const dimensions: { key: string; label: string; term: string }[] = [
    { key: 'shared_keys', label: 'Shared Keys', term: 'key-reuse' },
    { key: 'single_sig', label: 'Single-sig', term: 'multi-sig' },
    { key: 'implied_only', label: 'Implied Only', term: 'implied-explicit' },
    { key: 'no_credits', label: 'No Credits', term: 'credits' },
  ];

  if (matrix.length === 0) {
    return (
      <GlassCard title="Risk Heatmap" titleRight={<InfoTip term="key-reuse" />} delay={0.1}>
        <div className="intel-empty">No risk data to display</div>
      </GlassCard>
    );
  }

  // Per-column normalization: scale each dimension by that dimension's own max
  // across the matrix (min 1), so a column with large page counts (e.g. no_credits)
  // doesn't wash out columns with small magnitudes.
  const columnMax = useMemo(() => {
    const maxes: Record<string, number> = {};
    for (const dim of dimensions) {
      maxes[dim.key] = Math.max(1, ...matrix.map(m => m.risks[dim.key] || 0));
    }
    return maxes;
  }, [matrix]);

  return (
    <GlassCard title="Risk Heatmap" titleRight={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
          {matrix.length} ADIs with identified risks
        </span>
        <InfoTip term="key-reuse" />
      </span>
    } delay={0.1}>
      <div className="intel-heatmap-container">
        <div className="intel-heatmap">
          {/* Header row */}
          <div className="intel-heatmap-row intel-heatmap-header">
            <div className="intel-heatmap-adi-label" />
            {dimensions.map(d => (
              <div key={d.key} className="intel-heatmap-dim-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                {d.label}<InfoTip term={d.term} />
              </div>
            ))}
          </div>

          {/* Data rows */}
          {matrix.map((entry, i) => {
            const openInTree = () => navigate('/tree?select=' + encodeURIComponent(entry.adi));
            return (
            <motion.div
              key={entry.adi}
              className="intel-heatmap-row risk-row-clickable"
              role="button"
              tabIndex={0}
              aria-label={`Open ${shortUrl(entry.adi)} in the tree`}
              title={`Open ${shortUrl(entry.adi)} in the tree`}
              onClick={openInTree}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openInTree();
                }
              }}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <div className="intel-heatmap-adi-label" title={entry.adi}>
                {shortUrl(entry.adi).slice(0, 18)}
              </div>
              {dimensions.map(dim => {
                const val = entry.risks[dim.key] || 0;
                const intensity = val / (columnMax[dim.key] || 1);
                const isHov = hoveredCell?.adi === entry.adi && hoveredCell?.dim === dim.key;
                // Color-blind redundant cue (P3.4): a left border-weight that scales
                // with intensity (1\u20134px) PLUS a severity tier (1\u20133) that drives a
                // corner-tick dot count. Color stays the primary channel; these read
                // without relying on red-vs-green hue.
                const severityTier = val === 0 ? 0 : intensity > 0.66 ? 3 : intensity > 0.33 ? 2 : 1;
                const leftWeight = val === 0 ? 0 : 1 + Math.round(intensity * 3);
                return (
                  <div
                    key={dim.key}
                    className={`intel-heatmap-cell ${isHov ? 'intel-heatmap-cell--hover' : ''}`}
                    style={{
                      position: 'relative',
                      background: val === 0
                        ? 'rgba(34,197,94,0.08)'
                        : `rgba(239,68,68,${0.1 + intensity * 0.4})`,
                      borderColor: val > 0 ? `rgba(239,68,68,${0.15 + intensity * 0.2})` : 'var(--border-subtle)',
                      borderLeftWidth: val > 0 ? leftWeight : undefined,
                      borderLeftColor: val > 0 ? `rgba(239,68,68,${0.5 + intensity * 0.4})` : undefined,
                    }}
                    title={val > 0 ? `${dim.label}: ${val} (severity ${severityTier}/3)` : `${dim.label}: safe`}
                    onMouseEnter={() => setHoveredCell({ adi: entry.adi, dim: dim.key })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {val > 0 ? val : '\u2713'}
                    {/* Redundant non-color severity glyph: corner dots (1\u20133) that
                        scale with intensity, so risk reads without hue. */}
                    {severityTier > 0 && (
                      <span
                        aria-hidden="true"
                        style={{
                          position: 'absolute', top: 2, right: 3,
                          display: 'flex', gap: 1, lineHeight: 1, pointerEvents: 'none',
                        }}
                      >
                        {Array.from({ length: severityTier }).map((_, di) => (
                          <span
                            key={di}
                            style={{
                              width: 3, height: 3, borderRadius: '50%',
                              background: `rgba(239,68,68,${0.6 + intensity * 0.4})`,
                            }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </motion.div>
            );
          })}
        </div>

        {/* Legend — explains BOTH the color channel and the redundant non-color
            cues (✓ vs number, left border-weight, severity dots) for P3.4. */}
        <div className="intel-heatmap-legend">
          <span className="intel-heatmap-legend-item">
            <span style={{ display: 'inline-flex', width: 12, height: 12, borderRadius: 3, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.2)', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--text-secondary)' }}>✓</span> Safe (✓)
          </span>
          <span className="intel-heatmap-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(239,68,68,0.2)', borderTop: '1px solid rgba(239,68,68,0.25)', borderRight: '1px solid rgba(239,68,68,0.25)', borderBottom: '1px solid rgba(239,68,68,0.25)', borderLeft: '2px solid rgba(239,68,68,0.55)' }} /> Low risk · count + 1 dot
          </span>
          <span className="intel-heatmap-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(239,68,68,0.5)', borderTop: '1px solid rgba(239,68,68,0.4)', borderRight: '1px solid rgba(239,68,68,0.4)', borderBottom: '1px solid rgba(239,68,68,0.4)', borderLeft: '4px solid rgba(239,68,68,0.85)' }} /> High risk · count + up to 3 dots
          </span>
        </div>

        {/* B5: define what the 1–3 severity dots/tiers actually mean, so a
            "3/3" cell reads as relative prevalence, not absolute danger. */}
        <div className="intel-heatmap-severity-note" style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
          {SEVERITY_SCALE_NOTE} Each row is an identity — select one to open it in the tree.
        </div>

        {/* B2: a single concise model-framing line for the headline risk; the
            columns already carry per-dimension InfoTips, so keep it light. */}
        <div style={{ marginTop: 8 }}>
          <RiskNote risk="key-reuse" compact />
        </div>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════
   7C. KEY REUSE CLUSTERS
   ═══════════════════════════════════════════════ */

function KeyReuseClusters({ data }: { data: Intelligence['key_reuse'] }) {
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 400 });
  // Cursor-anchored tooltip position (P3.5): tracked relative to the container.
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Measure container with ResizeObserver so the chart re-measures on resize
  // (mirrors NetworkGraph). Falls back to a sane width if measurement yields 0.
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      const w = el ? Math.round(el.getBoundingClientRect().width) : 0;
      setDims({ width: w > 0 ? w : 800, height: 400 });
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

  // Position clusters
  const clusters = useMemo(() => {
    const cx = dims.width / 2;
    const cy = dims.height / 2;
    const bigR = Math.min(dims.width, dims.height) * 0.35;

    return data.map((kr, i) => {
      const angle = (2 * Math.PI * i) / data.length - Math.PI / 2;
      const r = bigR * (0.5 + 0.5 * (kr.adi_count / Math.max(1, data[0]?.adi_count || 1)));
      return {
        ...kr,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        radius: Math.max(12, kr.adi_count * 4),
        index: i,
      };
    });
  }, [data, dims]);

  // Precompute pairwise shared-ADI connections once (off the hover path).
  // O(clusters² × adis) — depends only on cluster data, NOT on hoveredCluster.
  const connections = useMemo(() => {
    const conns: { x1: number; y1: number; x2: number; y2: number; sharedCount: number }[] = [];
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const shared = clusters[i].adi_urls.filter(a => clusters[j].adi_urls.includes(a));
        if (shared.length > 0) {
          conns.push({
            x1: clusters[i].x, y1: clusters[i].y,
            x2: clusters[j].x, y2: clusters[j].y,
            sharedCount: shared.length,
          });
        }
      }
    }
    return conns;
  }, [clusters]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // devicePixelRatio scaling for crisp rendering on Retina/HiDPI displays.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    canvas.style.width = `${dims.width}px`;
    canvas.style.height = `${dims.height}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    ctx.fillStyle = themeColors.canvasBg;
    ctx.fillRect(0, 0, dims.width, dims.height);

    // Draw connections between clusters that share ADIs (precomputed in `connections` memo)
    for (const conn of connections) {
      ctx.beginPath();
      ctx.moveTo(conn.x1, conn.y1);
      ctx.lineTo(conn.x2, conn.y2);
      ctx.strokeStyle = `rgba(239,68,68,${0.05 + conn.sharedCount * 0.05})`;
      ctx.lineWidth = conn.sharedCount;
      ctx.stroke();
    }

    // Draw clusters
    for (const cl of clusters) {
      const isHov = hoveredCluster === cl.index;
      const isSel = selectedCluster === cl.index;
      const intensity = cl.adi_count / Math.max(1, data[0]?.adi_count || 1);

      // Outer glow
      if (isHov || isSel) {
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cl.radius + 8, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(239,68,68,0.1)';
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(cl.x, cl.y, cl.radius, 0, 2 * Math.PI);
      const r = Math.round(239 * intensity + 34 * (1 - intensity));
      const g = Math.round(68 * intensity + 197 * (1 - intensity));
      const b = Math.round(68 * intensity + 94 * (1 - intensity));
      ctx.fillStyle = `rgba(${r},${g},${b},${0.3 + intensity * 0.4})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.lineWidth = isHov ? 2 : 1;
      ctx.stroke();

      // Color-blind redundant severity cue (P3.4): a neutral-toned outer ring
      // whose thickness scales with severity (independent of hue). Drawn just
      // outside the fill so it reads alongside node SIZE (which encodes adi_count).
      const severityTier = intensity > 0.66 ? 3 : intensity > 0.33 ? 2 : 1;
      if (severityTier > 0) {
        ctx.beginPath();
        ctx.arc(cl.x, cl.y, cl.radius + 2 + severityTier, 0, 2 * Math.PI);
        // Theme-aware neutral stroke (not red/green) so the ring is a non-hue channel.
        ctx.strokeStyle = themeColors.canvasTextDim;
        ctx.lineWidth = severityTier;
        ctx.stroke();

        // Redundant severity badge: small tick marks (1–3) at the top of the node,
        // a non-color count that mirrors the heatmap's corner dots.
        const badgeY = cl.y - cl.radius - 6;
        const badgeGap = 5;
        const badgeStartX = cl.x - ((severityTier - 1) * badgeGap) / 2;
        for (let t = 0; t < severityTier; t++) {
          ctx.beginPath();
          ctx.arc(badgeStartX + t * badgeGap, badgeY, 1.6, 0, 2 * Math.PI);
          ctx.fillStyle = themeColors.canvasText;
          ctx.fill();
        }
      }

      // ADI count label
      ctx.font = `bold ${Math.max(10, cl.radius * 0.6)}px Inter, sans-serif`;
      ctx.fillStyle = themeColors.canvasText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(cl.adi_count), cl.x, cl.y);

      // Key hash label
      if (isHov || cl.radius > 20) {
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillStyle = themeColors.canvasTextDim;
        ctx.fillText(cl.key_hash.slice(0, 8) + '..', cl.x, cl.y + cl.radius + 10);
      }

      // Draw satellite dots for ADIs if hovered
      if (isHov || isSel) {
        cl.adi_urls.forEach((_adi, ai) => {
          const satAngle = (2 * Math.PI * ai) / cl.adi_urls.length;
          const satR = cl.radius + 18;
          const sx = cl.x + Math.cos(satAngle) * satR;
          const sy = cl.y + Math.sin(satAngle) * satR;

          ctx.beginPath();
          ctx.arc(sx, sy, 3, 0, 2 * Math.PI);
          ctx.fillStyle = '#6c8cff';
          ctx.fill();

          // Line to center
          ctx.beginPath();
          ctx.moveTo(cl.x + Math.cos(satAngle) * cl.radius, cl.y + Math.sin(satAngle) * cl.radius);
          ctx.lineTo(sx, sy);
          ctx.strokeStyle = 'rgba(108,140,255,0.2)';
          ctx.lineWidth = 0.5;
          ctx.stroke();
        });
      }
    }
  }, [clusters, connections, hoveredCluster, selectedCluster, data, dims, themeColors]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let found: number | null = null;
    for (const cl of clusters) {
      const dx = mx - cl.x;
      const dy = my - cl.y;
      if (dx * dx + dy * dy < (cl.radius + 4) * (cl.radius + 4)) {
        found = cl.index;
        break;
      }
    }
    setHoveredCluster(found);

    // Cursor-anchored tooltip (P3.5): track pointer position relative to the
    // container so the tooltip can follow the cursor with a small offset.
    if (found != null) {
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        setTooltipPos({
          x: e.clientX - containerRect.left,
          y: e.clientY - containerRect.top,
        });
      }
    }
  }, [clusters]);

  if (data.length === 0) {
    return (
      <GlassCard title="Key Reuse Clusters" titleRight={<InfoTip term="key-reuse" />} delay={0.15}>
        <div className="intel-empty">No shared keys detected — all keys are unique.</div>
      </GlassCard>
    );
  }

  // Accessible summary: total ADI memberships across all shared-key clusters.
  const totalAdiMemberships = data.reduce((s, kr) => s + kr.adi_count, 0);
  const chartLabel = `Key reuse clusters: ${data.length} keys shared across ${totalAdiMemberships} ADIs`;

  return (
    <GlassCard title="Key Reuse Clusters" titleRight={
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{data.length} shared keys</span>
        <InfoTip term="key-reuse" />
      </span>
    } delay={0.15}>
      {/* B1+B2: persistent why+fix for the headline risk (only rendered because
          clusters exist — the empty-state returns earlier above). */}
      <RiskNote risk="key-reuse" />
      {/* D2: plain-language "how to read this" line, distinct from the RiskNote
          above (which explains why/fix). Matches the Lorenz/radar caption style. */}
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginBottom: 8, lineHeight: 1.5 }}>
        Each circle is one signing key; size &amp; color = how many identities share it. Lines connect keys that share an identity.
      </div>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={chartLabel}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHoveredCluster(null); setTooltipPos(null); }}
          onClick={() => setSelectedCluster(hoveredCluster)}
          style={{ display: 'block', borderRadius: 12, cursor: hoveredCluster != null ? 'pointer' : 'default' }}
        />

        {/* Visually-hidden data table alternative for screen readers */}
        <table className="sr-only">
          <caption>{chartLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Key hash</th>
              <th scope="col">ADIs sharing key</th>
              <th scope="col">ADI URLs</th>
            </tr>
          </thead>
          <tbody>
            {data.map(kr => (
              <tr key={kr.key_hash}>
                <td>{kr.key_hash}</td>
                <td>{kr.adi_count}</td>
                <td>{kr.adi_urls.map(u => shortUrl(u)).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Tooltip — cursor-anchored (P3.5): follows the pointer with a small
            offset, clamped to stay within the container. Inline left/top override
            the fixed top/right corner pinning from the CSS class. */}
        {hoveredCluster != null && (() => {
          const TW = 240; // matches .intel-cluster-tooltip max-width
          const offset = 14;
          const measured = tooltipRef.current?.getBoundingClientRect();
          const tw = measured?.width || TW;
          const th = measured?.height || 80;
          const px = tooltipPos?.x ?? dims.width - TW - 12;
          const py = tooltipPos?.y ?? 12;
          // Place to the right of the cursor by default; flip left if it would overflow.
          let left = px + offset;
          if (left + tw > dims.width) left = px - offset - tw;
          left = Math.max(4, Math.min(left, Math.max(4, dims.width - tw - 4)));
          let top = py + offset;
          top = Math.max(4, Math.min(top, Math.max(4, dims.height - th - 4)));
          return (
          <div
            ref={tooltipRef}
            className="intel-cluster-tooltip"
            style={{ top, left, right: 'auto' }}
          >
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ef4444', marginBottom: 4 }}>
              {clusters[hoveredCluster].key_hash.slice(0, 24)}...
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>
              {clusters[hoveredCluster].adi_count} ADIs share this key
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>
              {clusters[hoveredCluster].adi_urls.slice(0, 3).map(u => shortUrl(u)).join(', ')}
              {clusters[hoveredCluster].adi_urls.length > 3 && ` +${clusters[hoveredCluster].adi_urls.length - 3} more`}
            </div>
          </div>
          );
        })()}

        {/* Selected detail panel */}
        <AnimatePresence>
          {selectedCluster != null && (
            <motion.div
              className="intel-cluster-detail"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#ef4444' }}>
                  Cluster: {clusters[selectedCluster].adi_count} ADIs
                </div>
                <button className="accounts-clear-btn" onClick={() => setSelectedCluster(null)}>Close</button>
              </div>
              <div className="key-hash" style={{ fontSize: 9, marginBottom: 8 }}>
                {clusters[selectedCluster].key_hash}
              </div>
              {/* B4: each member ADI is a click-through to open it in the tree. */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {clusters[selectedCluster].adi_urls.map(u => {
                  const openInTree = () => navigate('/tree?select=' + encodeURIComponent(u));
                  return (
                    <span
                      key={u}
                      className="url-link risk-row-clickable"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${shortUrl(u)} in the tree`}
                      title={`Open ${shortUrl(u)} in the tree`}
                      style={{ fontSize: 10, cursor: 'pointer' }}
                      onClick={openInTree}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openInTree();
                        }
                      }}
                    >
                      {u}
                    </span>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* B5: define the 1–3 severity tiers used by the cluster ring/badge cues. */}
        <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
          {SEVERITY_SCALE_NOTE}
        </div>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════
   7D. AUTHORITY CONCENTRATION
   ═══════════════════════════════════════════════ */

function AuthorityConcentration({ data }: { data: Intelligence }) {
  const concentration = data.authority_concentration;

  const totalAccounts = concentration.reduce((s, a) => s + a.total_accounts, 0);
  const sortedBySize = [...concentration].sort((a, b) => b.total_accounts - a.total_accounts);

  // Waffle data: top 5 vs rest
  const top5Total = sortedBySize.slice(0, 5).reduce((s, a) => s + a.total_accounts, 0);
  const restTotal = totalAccounts - top5Total;
  const top5Pct = totalAccounts > 0 ? (top5Total / totalAccounts * 100) : 0;

  // Ascending sort shared by Lorenz curve + Gini (computed once)
  const sortedAsc = useMemo(
    () => [...concentration].sort((a, b) => a.total_accounts - b.total_accounts),
    [concentration]
  );

  // Lorenz curve data
  const lorenz = useMemo(() => {
    const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    const n = sortedAsc.length;
    if (n === 0 || totalAccounts === 0) return points;
    let cumAccounts = 0;
    sortedAsc.forEach((a, i) => {
      cumAccounts += a.total_accounts;
      points.push({
        x: (i + 1) / n * 100,
        y: cumAccounts / totalAccounts * 100,
      });
    });
    return points;
  }, [sortedAsc, totalAccounts]);

  // Gini coefficient — closed-form O(n log n) from the ascending-sorted array:
  //   gini = ( Σ_{i=1..n} (2i − n − 1) · x_i ) / ( n² · mean )   (1-based i)
  const gini = useMemo(() => {
    const n = sortedAsc.length;
    if (n === 0 || totalAccounts === 0) return 0;
    const mean = totalAccounts / n;
    let weighted = 0;
    for (let i = 0; i < n; i++) {
      // 1-based index => (i + 1); weight = 2(i+1) − n − 1
      weighted += (2 * (i + 1) - n - 1) * sortedAsc[i].total_accounts;
    }
    return weighted / (n * n * mean);
  }, [sortedAsc, totalAccounts]);

  if (concentration.length === 0) return null;

  return (
    <div className="intel-concentration">
      <div className="intel-concentration-row">
        {/* Waffle-like visual */}
        <GlassCard title="Authority Distribution" titleRight={<InfoTip term="authority" />} delay={0.15} style={{ flex: 1 }}>
          <div className="intel-waffle">
            <div className="intel-waffle-visual">
              {/* Top 5 */}
              <div className="intel-waffle-segment" style={{
                width: `${top5Pct}%`, background: 'linear-gradient(90deg, #f59e0b, #ef4444)',
              }} />
              {/* Rest */}
              <div className="intel-waffle-segment" style={{
                width: `${100 - top5Pct}%`, background: 'rgba(108,140,255,0.2)',
              }} />
            </div>
            <div className="intel-waffle-labels">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: '#f59e0b' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Top 5 books: <strong style={{ color: '#f59e0b' }}>{top5Pct.toFixed(1)}%</strong> ({top5Total} accts)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: 'rgba(108,140,255,0.3)' }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Rest: <strong>{(100 - top5Pct).toFixed(1)}%</strong> ({restTotal} accts)
                </span>
              </div>
            </div>

            {/* Top 5 breakdown */}
            <div className="intel-top5-list">
              {sortedBySize.slice(0, 5).map((a, i) => {
                const pct = totalAccounts > 0 ? (a.total_accounts / totalAccounts * 100) : 0;
                return (
                  <div key={i} className="intel-top5-item">
                    <span className="intel-top5-rank">#{i + 1}</span>
                    <span className="url-link" style={{ fontSize: 10, flex: 1 }}>
                      {shortUrl(a.authority_url).slice(0, 24)}
                    </span>
                    <span style={{ fontSize: 10, color: '#f59e0b', fontWeight: 600 }}>{pct.toFixed(1)}%</span>
                    <HeatStrip segments={[
                      { value: a.explicit_count, color: '#6c8cff', label: 'Explicit' },
                      { value: a.implied_count, color: '#f59e0b', label: 'Implied' },
                    ]} height={4} />
                  </div>
                );
              })}
            </div>
          </div>
        </GlassCard>

        {/* Lorenz + Gini */}
        <GlassCard title="Authority Inequality" titleRight={<InfoTip term="gini" />} delay={0.2} style={{ flex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: gini > 0.6 ? '#ef4444' : gini > 0.4 ? '#f59e0b' : '#22c55e' }}>
              {gini.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              Gini Coefficient <InfoTip term="gini" /> {gini > 0.6 ? '(High concentration)' : gini > 0.4 ? '(Moderate concentration)' : '(Low concentration)'}
            </div>
          </div>

          {/* Lorenz curve as SVG */}
          <LorenzCurve points={lorenz} />

          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center' }}>
            Lorenz curve — closer to the diagonal = more equal distribution
          </div>

          {/* B3: descriptive (not evaluative) framing — there is no established
              "good" Gini for on-chain authority concentration. B1: persistent
              why+fix for the concentration risk, only when there is data. */}
          {gini > 0.4 && (
            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
              A higher value means few keyholders hold outsized control — audit the top books.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <RiskNote risk="concentration" compact />
          </div>
        </GlassCard>
      </div>
    </div>
  );
}

function LorenzCurve({ points }: { points: { x: number; y: number }[] }) {
  const W = 280;
  const H = 200;
  const pad = 30;
  const plotW = W - pad * 2;
  const plotH = H - pad * 2;

  const toX = (x: number) => pad + (x / 100) * plotW;
  const toY = (y: number) => pad + plotH - (y / 100) * plotH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${toX(p.x)} ${toY(p.y)}`).join(' ');
  const equalityLine = `M ${toX(0)} ${toY(0)} L ${toX(100)} ${toY(100)}`;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '0 auto', maxWidth: 300 }}>
      {/* Grid */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={toX(v)} y1={toY(0)} x2={toX(v)} y2={toY(100)} stroke="rgba(108,140,255,0.06)" strokeWidth={0.5} />
          <line x1={toX(0)} y1={toY(v)} x2={toX(100)} y2={toY(v)} stroke="rgba(108,140,255,0.06)" strokeWidth={0.5} />
        </g>
      ))}

      {/* Equality line */}
      <path d={equalityLine} stroke="rgba(108,140,255,0.2)" strokeWidth={1} strokeDasharray="4,3" fill="none" />

      {/* Lorenz curve */}
      <path d={pathD} stroke="#ef4444" strokeWidth={2} fill="none" />

      {/* Fill area between curves */}
      <path d={`${pathD} L ${toX(100)} ${toY(100)} L ${toX(0)} ${toY(0)} Z`} fill="rgba(239,68,68,0.08)" />

      {/* Axes labels */}
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8}>% of Authority Books</text>
      <text x={6} y={H / 2} textAnchor="middle" fill="var(--text-tertiary)" fontSize={8} transform={`rotate(-90, 6, ${H / 2})`}>% of Governed Accounts</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════
   7E. COMPARATIVE ANALYSIS
   ═══════════════════════════════════════════════ */

function ComparativeAnalysis({ data }: { data: Intelligence }) {
  const { isDark } = useTheme();
  const [selectedAdis, setSelectedAdis] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Get all ADI URLs from key reuse + cross authority
  const allAdis = useMemo(() => {
    const set = new Set<string>();
    for (const kr of data.key_reuse) {
      for (const u of kr.adi_urls) set.add(u);
    }
    for (const ca of data.cross_authority) {
      set.add('acc://' + ca.book_owner);
    }
    for (const ac of data.authority_concentration) {
      const adi = ac.authority_url.split('/')[0];
      set.add('acc://' + adi);
    }
    return [...set].sort();
  }, [data]);

  const filteredAdis = useMemo(() => {
    if (!searchTerm) return allAdis.slice(0, 20);
    return allAdis.filter(a => a.toLowerCase().includes(searchTerm.toLowerCase())).slice(0, 20);
  }, [allAdis, searchTerm]);

  const toggleAdi = (url: string) => {
    setSelectedAdis(prev => {
      if (prev.includes(url)) return prev.filter(u => u !== url);
      if (prev.length >= 4) return prev;
      return [...prev, url];
    });
  };

  // Compute comparison metrics
  const comparisonData = useMemo(() => {
    return selectedAdis.map(adi => {
      const sharedKeys = data.key_reuse.filter(kr => kr.adi_urls.includes(adi)).length;
      const authConc = data.authority_concentration.filter(ac =>
        ac.authority_url.startsWith(shortUrl(adi) + '/')
      );
      const totalGoverned = authConc.reduce((s, a) => s + a.total_accounts, 0);
      const delegations = data.delegations.filter(d => d.delegator_adi === adi);
      const crossAuth = data.cross_authority.filter(ca =>
        ca.book_owner === shortUrl(adi) || ca.authority_url.startsWith(shortUrl(adi))
      );

      return {
        adi,
        sharedKeys,
        totalGoverned,
        delegations: delegations.length,
        crossAuth: crossAuth.length,
        foreignGoverned: crossAuth.reduce((s, ca) => s + ca.foreign_count, 0),
      };
    });
  }, [selectedAdis, data]);

  // Radar chart data
  const radarData = useMemo(() => {
    if (comparisonData.length === 0) return [];
    const maxes = {
      sharedKeys: Math.max(1, ...comparisonData.map(d => d.sharedKeys)),
      totalGoverned: Math.max(1, ...comparisonData.map(d => d.totalGoverned)),
      delegations: Math.max(1, ...comparisonData.map(d => d.delegations)),
      crossAuth: Math.max(1, ...comparisonData.map(d => d.crossAuth)),
      foreignGoverned: Math.max(1, ...comparisonData.map(d => d.foreignGoverned)),
    };

    const dims = ['Shared Keys', 'Governed', 'Delegations', 'Cross-Auth', 'Foreign'];
    const keys = ['sharedKeys', 'totalGoverned', 'delegations', 'crossAuth', 'foreignGoverned'] as const;

    return dims.map((dim, i) => {
      const point: any = { dimension: dim };
      comparisonData.forEach((cd, j) => {
        point[`adi${j}`] = (cd[keys[i]] / maxes[keys[i]]) * 100;
      });
      return point;
    });
  }, [comparisonData]);

  const radarColors = ['#6c8cff', '#22d3ee', '#f59e0b', '#ef4444'];

  return (
    <GlassCard title="Comparative Analysis" titleRight={
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>Select 2-4 ADIs to compare</span>
    } delay={0.3}>
      <div className="intel-compare">
        {/* ADI selector */}
        <div className="intel-compare-selector">
          <input
            placeholder="Search ADIs..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="accounts-filter-input"
            style={{ width: '100%', marginBottom: 8 }}
          />
          <div className="intel-compare-chips">
            {selectedAdis.map((adi, i) => (
              <span key={adi} className="intel-compare-chip" style={{ borderColor: radarColors[i] }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: radarColors[i] }} />
                {shortUrl(adi).slice(0, 16)}
                <button onClick={() => toggleAdi(adi)} style={{
                  background: 'none', border: 'none', color: 'var(--text-tertiary)',
                  cursor: 'pointer', fontSize: 12, padding: 0, marginLeft: 4,
                }}>&times;</button>
              </span>
            ))}
          </div>
          <div className="intel-compare-list">
            {filteredAdis.filter(a => !selectedAdis.includes(a)).slice(0, 10).map(adi => (
              <div
                key={adi}
                className="intel-compare-option"
                onClick={() => toggleAdi(adi)}
              >
                {shortUrl(adi)}
              </div>
            ))}
          </div>
        </div>

        {/* Comparison view */}
        {comparisonData.length >= 2 && (
          <div className="intel-compare-results">
            {/* Radar chart */}
            <div className="intel-compare-radar">
              <ResponsiveContainer width="100%" height={260} minWidth={0}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(108,140,255,0.08)" />
                  <PolarAngleAxis dataKey="dimension" tick={{ fill: getThemeColors(isDark).canvasTextDim, fontSize: 9 }} />
                  {comparisonData.map((_, i) => (
                    <Radar
                      key={i}
                      dataKey={`adi${i}`}
                      stroke={radarColors[i]}
                      fill={radarColors[i]}
                      fillOpacity={0.1}
                      strokeWidth={1.5}
                    />
                  ))}
                </RadarChart>
              </ResponsiveContainer>
              {/* C4: the radar axes are normalized to the MAX value among the
                  selected ADIs (see radarData memo), not absolute risk — so a
                  tiny ADI can look "maxed out." Make that explicit; the table
                  beside this shows the raw numbers. */}
              <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center' }}>
                Each axis is scaled to the highest value among the identities you selected — the shape shows relative differences, not absolute risk.
              </div>
            </div>

            {/* Stats table — wrapped in a horizontally scrollable container so
                the comparison table never overflows the viewport on ~375px (P3.7). */}
            <div className="intel-compare-table" style={{ overflowX: 'auto' }}>
              <table className="data-table" style={{ minWidth: 280 }}>
                <thead>
                  <tr>
                    <th>Metric</th>
                    {comparisonData.map((cd, i) => (
                      <th key={cd.adi} style={{ color: radarColors[i] }}>
                        {shortUrl(cd.adi).slice(0, 14)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: 'Shared Keys', key: 'sharedKeys' as const, term: 'key-reuse' },
                    { label: 'Governed Accts', key: 'totalGoverned' as const, term: 'authority' },
                    { label: 'Delegations', key: 'delegations' as const, term: 'delegation' },
                    { label: 'Cross-Auth Links', key: 'crossAuth' as const, term: 'cross-adi' },
                    { label: 'Foreign Governed', key: 'foreignGoverned' as const, term: 'cross-adi' },
                  ].map(metric => (
                    <tr key={metric.label}>
                      <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          {metric.label}<InfoTip term={metric.term} />
                        </span>
                      </td>
                      {comparisonData.map((cd, i) => (
                        <td key={cd.adi} style={{ fontWeight: 600, color: radarColors[i] }}>
                          {cd[metric.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Shared resources */}
              {comparisonData.length >= 2 && (() => {
                const allSelectedUrls = selectedAdis;
                const sharedKeyHashes = data.key_reuse.filter(kr =>
                  allSelectedUrls.filter(u => kr.adi_urls.includes(u)).length >= 2
                );
                if (sharedKeyHashes.length === 0) return null;
                return (
                  <div style={{ marginTop: 12, padding: 10, background: 'rgba(239,68,68,0.06)', borderRadius: 8, border: '1px solid rgba(239,68,68,0.12)' }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: '#ef4444', marginBottom: 4 }}>
                      Shared Keys Between Selected
                    </div>
                    {sharedKeyHashes.map(kr => (
                      <div key={kr.key_hash} style={{ fontSize: 9, color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        {kr.key_hash.slice(0, 20)}... ({kr.adi_count} ADIs)
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {comparisonData.length < 2 && selectedAdis.length > 0 && (
          <div className="intel-empty" style={{ marginTop: 16 }}>
            Select at least 2 ADIs to compare
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════
   EXISTING SECTIONS (refreshed)
   ═══════════════════════════════════════════════ */

function SecurityOverview({ data }: { data: Intelligence }) {
  const { isDark } = useTheme();
  const isNarrow = useIsNarrow();
  const sec = data.key_security;
  const multiPct = sec.total_pages > 0 ? sec.multi_sig / sec.total_pages : 0;

  const sigData = [
    { name: 'Single-sig', value: sec.single_sig },
    { name: 'Multi-sig', value: sec.multi_sig },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* P3.7: collapse the 3-column stat grid to a single column on narrow
          screens (the .grid-3 class has no mobile breakpoint in globals.css). */}
      <div className="grid-3" style={isNarrow ? { gridTemplateColumns: '1fr' } : undefined}>
        <GlassCard glow delay={0.1}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 8 }}>
            <RingGauge value={multiPct} size={90} strokeWidth={7}
              color={multiPct > 0.1 ? '#22c55e' : '#ef4444'}
              valueLabel={`${(multiPct * 100).toFixed(1)}%`}
              label="Multi-sig" />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                Multi-sig Adoption<InfoTip term="multi-sig" />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                <strong>{sec.multi_sig}</strong> of {sec.total_pages} key pages
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard delay={0.15}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 8 }}>
            <div style={{ width: 90, height: 90 }}>
              <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                <PieChart>
                  <Pie data={sigData} cx="50%" cy="50%" outerRadius={40} innerRadius={22} dataKey="value">
                    <Cell fill="#f59e0b" />
                    <Cell fill="#22c55e" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 12 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
                <span style={{ color: 'var(--text-secondary)' }}>Single: <strong>{sec.single_sig}</strong></span>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e' }} />
                <span style={{ color: 'var(--text-secondary)' }}>Multi: <strong>{sec.multi_sig}</strong></span>
              </div>
            </div>
          </div>
        </GlassCard>

        <GlassCard delay={0.2}>
          <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                Zero-credit pages<InfoTip term="credits" />
              </span>
              <GlowBadge variant={sec.zero_credit_pages > 0 ? 'warning' : 'success'}>
                <AnimatedCounter value={sec.zero_credit_pages} />
              </GlowBadge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                Shared keys<InfoTip term="key-reuse" />
              </span>
              <GlowBadge variant={data.key_reuse.length > 0 ? 'danger' : 'success'}>
                <AnimatedCounter value={data.key_reuse.length} />
              </GlowBadge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                Empty root ADIs<InfoTip term="adi" />
              </span>
              <GlowBadge variant={data.empty_adis > 0 ? 'authority' : 'success'}>
                <AnimatedCounter value={data.empty_adis} />
              </GlowBadge>
            </div>

            {/* B2: persistent why+fix for the security stats above, each guarded
                on the risk actually being present so clean networks stay clean. */}
            {sec.zero_credit_pages > 0 && <RiskNote risk="zero-credit" compact />}
            {data.key_reuse.length > 0 && <RiskNote risk="key-reuse" compact />}
          </div>
        </GlassCard>
      </div>

      <GlassCard title="Accounts per ADI Distribution" titleRight={<InfoTip term="directory-entries" />} delay={0.25}>
        <ResponsiveContainer width="100%" height={200} minWidth={0}>
          <BarChart data={data.accounts_per_adi}>
            <XAxis dataKey="bucket" tick={{ fill: getThemeColors(isDark).canvasTextDim, fontSize: 11 }} axisLine={{ stroke: 'rgba(108,140,255,0.08)' }} tickLine={false} />
            <YAxis tick={{ fill: getThemeColors(isDark).canvasTextDim, fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={getTooltipStyle(isDark)} cursor={{ fill: 'rgba(108,140,255,0.04)' }} />
            <Bar dataKey="adi_count" fill="#a78bfa" radius={[6, 6, 0, 0]} name="ADIs" />
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   7F. LITE ACCOUNT INTELLIGENCE (Phase G)
   ═══════════════════════════════════════════════ */

function giniColor(g: number) { return g > 0.6 ? '#ef4444' : g > 0.4 ? '#f59e0b' : '#22c55e'; }
function giniLabel(g: number) { return g > 0.6 ? 'High concentration' : g > 0.4 ? 'Moderate concentration' : 'Low concentration'; }
function fmtInt(n: number) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); }

function LiteAccountsIntelligence() {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['lite-intelligence'],
    queryFn: api.getLiteIntelligence,
    staleTime: 300000,
  });

  if (isError) return <ErrorState title="Failed to load lite-account intelligence" onRetry={() => refetch()} />;
  if (isLoading || !data) return <PageLoader message="Analyzing lite accounts..." />;

  const acmeTotal = data.acme.total / 1e8;
  const openHolder = (url: string) => {
    const hash = url.replace('acc://', '').split('/')[0];
    navigate('/accounts?tab=lite&search=' + encodeURIComponent(hash));
  };
  const v = data.vs_adi;
  const compareRows = [
    { label: 'Identities', adi: v.adis || 0, lite: v.lite_identities || 0, term: 'adi' },
    { label: 'Token accounts', adi: v.adi_token_accounts || 0, lite: v.lite_token_accounts || 0, term: 'token-account' },
    { label: 'Data accounts', adi: v.adi_data_accounts || 0, lite: v.lite_data_accounts || 0, term: 'data-account' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        The same analysis applied to ADIs, now over the 127k lite accounts — where the network’s
        circulating value actually sits, how unevenly it’s distributed, and which single keys control
        whole multi-asset wallets.
      </div>

      {/* ── Wealth + credit inequality ── */}
      <div className="intel-concentration-row" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <GlassCard title="Lite Wealth Inequality (ACME)" titleRight={<InfoTip term="gini" />} delay={0.1} style={{ flex: 1, minWidth: 300 }}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: giniColor(data.acme.gini) }}>
              {data.acme.gini.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              Gini coefficient <InfoTip term="gini" /> ({giniLabel(data.acme.gini)})
            </div>
          </div>
          <LorenzCurve points={data.acme.lorenz} />
          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center', lineHeight: 1.5 }}>
            {fmtInt(data.acme.holder_count)} accounts hold {fmtInt(acmeTotal)} ACME.
            A higher value means a few wallets hold almost all of it.
          </div>
        </GlassCard>

        <GlassCard title="Credit Inequality" titleRight={<InfoTip term="credits" />} delay={0.15} style={{ flex: 1, minWidth: 300 }}>
          <div style={{ textAlign: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: giniColor(data.credits.gini) }}>
              {data.credits.gini.toFixed(2)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              Gini coefficient <InfoTip term="gini" /> ({giniLabel(data.credits.gini)})
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Total credits</span>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtInt(data.credits.total)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Credit-holding identities</span>
              <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmtInt(data.credits.holder_count)}</strong>
            </div>
            {data.credits.top_holders.slice(0, 5).map((h, i) => (
              <div key={h.url} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
                <span style={{ color: 'var(--text-tertiary)' }}>#{i + 1}</span>
                <span
                  className="url-link risk-row-clickable"
                  role="button" tabIndex={0}
                  onClick={() => openHolder(h.url)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHolder(h.url); } }}
                  style={{ flex: 1, fontFamily: 'var(--font-mono)', cursor: 'pointer', wordBreak: 'break-all' }}
                  title={shortUrl(h.url)}
                >
                  {shortUrl(h.url).slice(0, 22)}…
                </span>
                <span style={{ color: '#f59e0b', fontWeight: 600 }}>{fmtInt(h.credits)}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* ── Top ACME holders ── */}
      <GlassCard title="Top ACME Holders (lite)" titleRight={
        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{data.acme.top_holders.length} shown · click to inspect</span>
      } delay={0.2}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {data.acme.top_holders.map((h, i) => {
            const acme = h.balance / 1e8;
            const pct = data.acme.total > 0 ? (h.balance / data.acme.total) * 100 : 0;
            const max = data.acme.top_holders[0]?.balance || 1;
            return (
              <div
                key={h.url}
                className="risk-row-clickable"
                role="button" tabIndex={0}
                onClick={() => openHolder(h.url)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHolder(h.url); } }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, cursor: 'pointer' }}
                title={`Inspect ${shortUrl(h.url)}`}
              >
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 22 }}>#{i + 1}</span>
                <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
                  {shortUrl(h.url).slice(0, 30)}…
                </span>
                <div style={{ width: '32%', height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${(h.balance / max) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#22d3ee,#6c8cff)' }} />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)', minWidth: 120, textAlign: 'right' }}>
                  {fmtInt(acme)} ACME
                </span>
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', minWidth: 44, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {/* ── Key-reuse wallets ── */}
      <GlassCard title="Single-Key Wallets" titleRight={<InfoTip term="key-reuse" />} delay={0.25}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 10, lineHeight: 1.5 }}>
          One lite key hash addresses an identity plus every token and data account it controls.
          <strong style={{ color: 'var(--text-secondary)' }}> {fmtInt(data.wallets.multi_account_keys)}</strong> keys
          control more than one account; <strong style={{ color: 'var(--text-secondary)' }}>{fmtInt(data.wallets.multi_token_keys)}</strong> hold
          multiple token types; the largest controls <strong style={{ color: 'var(--text-secondary)' }}>{data.wallets.max_accounts}</strong> accounts.
          A single stolen key compromises the whole wallet.
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 360 }}>
            <thead>
              <tr>
                <th>Key hash</th>
                <th style={{ textAlign: 'right' }}>Accounts</th>
                <th style={{ textAlign: 'right' }}>Token types</th>
                <th style={{ textAlign: 'right' }}>ACME</th>
              </tr>
            </thead>
            <tbody>
              {data.wallets.top.map(w => (
                <tr
                  key={w.key_hash}
                  className="risk-row-clickable"
                  role="button" tabIndex={0}
                  onClick={() => navigate('/accounts?tab=lite&search=' + encodeURIComponent(w.key_hash))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/accounts?tab=lite&search=' + encodeURIComponent(w.key_hash)); } }}
                  style={{ cursor: 'pointer' }}
                  title="Show this key’s accounts"
                >
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-secondary)' }}>{w.key_hash.slice(0, 20)}…</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{w.accounts}</td>
                  <td style={{ textAlign: 'right' }}>{w.tokens}</td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{w.acme ? fmtInt(w.acme / 1e8) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      {/* ── Lite vs ADI account models ── */}
      <GlassCard title="Two Account Models: Lite vs ADI" titleRight={<InfoTip term="lite-account" />} delay={0.3}>
        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 12, lineHeight: 1.5 }}>
          Accumulate has two parallel account systems. ADIs are named, hierarchical, and key-book-secured;
          lite accounts are anonymous key-hash wallets. The split below shows how the network actually divides.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {compareRows.map(r => {
            const total = r.adi + r.lite || 1;
            const litePct = (r.lite / total) * 100;
            return (
              <div key={r.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {r.label}<InfoTip term={r.term} />
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    ADI {fmtInt(r.adi)} · Lite {fmtInt(r.lite)}
                  </span>
                </div>
                <HeatStrip segments={[
                  { value: r.adi, color: '#6c8cff', label: `ADI ${r.label}` },
                  { value: r.lite, color: '#34d399', label: `Lite ${r.label}` },
                ]} height={10} />
                <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {litePct.toFixed(0)}% lite
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 10, color: 'var(--text-tertiary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#6c8cff' }} /> ADI
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: '#34d399' }} /> Lite
          </span>
        </div>
      </GlassCard>
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN VIEW
   ═══════════════════════════════════════════════ */

export function IntelligenceView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['intelligence'],
    queryFn: api.getIntelligence,
  });
  const [params, setParams] = useSearchParams();
  const validSections = ['overview', 'heatmap', 'clusters', 'concentration', 'compare', 'lite'];
  const initialSection = validSections.includes(params.get('section') || '') ? params.get('section')! : 'overview';
  const [section, setSectionState] = useState(initialSection);
  const setSection = useCallback((s: string) => {
    setSectionState(s);
    setParams(prev => { prev.set('section', s); return prev; }, { replace: true });
  }, [setParams]);

  // Pending scroll target id — set when an insight card navigates to a section.
  // The scroll is performed after the section tab has switched and rendered.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);

  // Map an insight `link` to the section tab + the id of the card to scroll to.
  const navigateToInsight = useCallback((link: string) => {
    const route: Record<string, { section: string; targetId: string }> = {
      keys: { section: 'clusters', targetId: 'intel-key-reuse-clusters' },
      authority: { section: 'concentration', targetId: 'intel-authority-concentration' },
      delegations: { section: 'concentration', targetId: 'intel-authority-concentration' },
      concentration: { section: 'concentration', targetId: 'intel-authority-concentration' },
    };
    const dest = route[link];
    if (!dest) return;
    setSection(dest.section);
    setScrollTarget(dest.targetId);
  }, [setSection]);

  // Once the target section has rendered, scroll its anchor into view.
  useEffect(() => {
    if (!scrollTarget) return;
    const id = scrollTarget;
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setScrollTarget(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [scrollTarget, section]);

  if (isError) {
    return <ErrorState title="Failed to load intelligence data" onRetry={() => refetch()} />;
  }

  if (isLoading || !data) {
    return <PageLoader message="Loading intelligence data..." />;
  }

  const sections = [
    { id: 'overview', label: 'Overview', icon: '\u25A3' },
    { id: 'heatmap', label: 'Risk Heatmap', icon: '\u2593' },
    { id: 'clusters', label: `Key Reuse (${data.key_reuse.length})`, icon: '\u25C9' },
    { id: 'concentration', label: 'Concentration', icon: '\u25A0' },
    { id: 'compare', label: 'Compare', icon: '\u2194' },
    { id: 'lite', label: 'Lite Accounts', icon: '\u25C8' },
  ];

  return (
    <div className="intelligence-center">
      <div className="view-intro">
        <div className="view-intro__title">Intelligence</div>
        <div className="view-intro__lead">Network-wide security signals from the identity graph — where signing keys are reused, where identities are weakly protected, and where control is concentrated.</div>
        <div className="view-intro__audience">Security analysis · for auditors & ADI owners</div>
      </div>

      {/* Insight Feed */}
      <InsightFeed data={data} onNavigate={navigateToInsight} />

      {/* Section Tabs */}
      <div className="intel-tabs">
        {sections.map(s => (
          <button
            key={s.id}
            className={`intel-tab ${section === s.id ? 'active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <span className="intel-tab-icon">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Section Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={section}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {section === 'overview' && <SecurityOverview data={data} />}
          {section === 'heatmap' && <RiskHeatmap data={data} />}
          {section === 'clusters' && (
            <div id="intel-key-reuse-clusters">
              <KeyReuseClusters data={data.key_reuse} />
            </div>
          )}
          {section === 'concentration' && (
            <div id="intel-authority-concentration">
              <AuthorityConcentration data={data} />
            </div>
          )}
          {section === 'compare' && <ComparativeAnalysis data={data} />}
          {section === 'lite' && <LiteAccountsIntelligence />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
