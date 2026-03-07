import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { RingGauge } from './ui/RingGauge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { HeatStrip } from './ui/HeatStrip';
import { ErrorState } from './ui/ErrorState';
import type { Intelligence } from '../types';
import { useTheme } from '../contexts/ThemeContext';
import { getTooltipStyle, getThemeColors } from '../hooks/useThemeColors';
function shortUrl(url: string) { return url.replace('acc://', ''); }

/* ═══════════════════════════════════════════════
   7A. INSIGHT FEED
   ═══════════════════════════════════════════════ */

function InsightFeed({ data }: { data: Intelligence }) {
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
      {insights.map((ins, i) => (
        <motion.div
          key={i}
          className="intel-feed-card"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06, duration: 0.35 }}
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
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   7B. RISK HEATMAP
   ═══════════════════════════════════════════════ */

function RiskHeatmap({ data }: { data: Intelligence }) {
  const [hoveredCell, setHoveredCell] = useState<{ adi: string; dim: string } | null>(null);

  // Build risk matrix
  const matrix = useMemo(() => {
    // Dimensions: shared_keys, single_sig, implied_only, no_credits, empty
    const adiRisks = new Map<string, Record<string, number>>();

    // Shared keys
    for (const kr of data.key_reuse) {
      for (const adi of kr.adi_urls) {
        if (!adiRisks.has(adi)) adiRisks.set(adi, { shared_keys: 0, single_sig: 0, implied_only: 0, no_credits: 0 });
        adiRisks.get(adi)!.shared_keys += 1;
      }
    }

    // Authority concentration — implied only
    for (const ac of data.authority_concentration) {
      const adi = ac.authority_url.split('/').slice(0, 1).join('/');
      const fullUrl = 'acc://' + adi;
      if (!adiRisks.has(fullUrl)) adiRisks.set(fullUrl, { shared_keys: 0, single_sig: 0, implied_only: 0, no_credits: 0 });
      if (ac.implied_count > 0 && ac.explicit_count === 0) {
        adiRisks.get(fullUrl)!.implied_only = 1;
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

  const dimensions = [
    { key: 'shared_keys', label: 'Shared Keys' },
    { key: 'single_sig', label: 'Single-sig' },
    { key: 'implied_only', label: 'Implied Only' },
    { key: 'no_credits', label: 'No Credits' },
  ];

  if (matrix.length === 0) {
    return (
      <GlassCard title="Risk Heatmap" delay={0.1}>
        <div className="intel-empty">No risk data to display</div>
      </GlassCard>
    );
  }

  const maxRisk = Math.max(1, ...matrix.map(m => Math.max(...Object.values(m.risks))));

  return (
    <GlassCard title="Risk Heatmap" titleRight={
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
        {matrix.length} ADIs with identified risks
      </span>
    } delay={0.1}>
      <div className="intel-heatmap-container">
        <div className="intel-heatmap">
          {/* Header row */}
          <div className="intel-heatmap-row intel-heatmap-header">
            <div className="intel-heatmap-adi-label" />
            {dimensions.map(d => (
              <div key={d.key} className="intel-heatmap-dim-label">{d.label}</div>
            ))}
          </div>

          {/* Data rows */}
          {matrix.map((entry, i) => (
            <motion.div
              key={entry.adi}
              className="intel-heatmap-row"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.02 }}
            >
              <div className="intel-heatmap-adi-label" title={entry.adi}>
                {shortUrl(entry.adi).slice(0, 18)}
              </div>
              {dimensions.map(dim => {
                const val = entry.risks[dim.key] || 0;
                const intensity = val / maxRisk;
                const isHov = hoveredCell?.adi === entry.adi && hoveredCell?.dim === dim.key;
                return (
                  <div
                    key={dim.key}
                    className={`intel-heatmap-cell ${isHov ? 'intel-heatmap-cell--hover' : ''}`}
                    style={{
                      background: val === 0
                        ? 'rgba(34,197,94,0.08)'
                        : `rgba(239,68,68,${0.1 + intensity * 0.4})`,
                      borderColor: val > 0 ? `rgba(239,68,68,${0.15 + intensity * 0.2})` : 'var(--border-subtle)',
                    }}
                    onMouseEnter={() => setHoveredCell({ adi: entry.adi, dim: dim.key })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {val > 0 ? val : '\u2713'}
                  </div>
                );
              })}
            </motion.div>
          ))}
        </div>

        {/* Legend */}
        <div className="intel-heatmap-legend">
          <span className="intel-heatmap-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.2)' }} /> Safe
          </span>
          <span className="intel-heatmap-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.25)' }} /> Low
          </span>
          <span className="intel-heatmap-legend-item">
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'rgba(239,68,68,0.5)', border: '1px solid rgba(239,68,68,0.4)' }} /> High
          </span>
        </div>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════
   7C. KEY REUSE CLUSTERS
   ═══════════════════════════════════════════════ */

function KeyReuseClusters({ data }: { data: Intelligence['key_reuse'] }) {
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 400 });

  useEffect(() => {
    if (containerRef.current) {
      setDims({ width: containerRef.current.clientWidth, height: 400 });
    }
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

    // Draw connections between clusters that share ADIs
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const shared = clusters[i].adi_urls.filter(a => clusters[j].adi_urls.includes(a));
        if (shared.length > 0) {
          ctx.beginPath();
          ctx.moveTo(clusters[i].x, clusters[i].y);
          ctx.lineTo(clusters[j].x, clusters[j].y);
          ctx.strokeStyle = `rgba(239,68,68,${0.05 + shared.length * 0.05})`;
          ctx.lineWidth = shared.length;
          ctx.stroke();
        }
      }
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
  }, [clusters, hoveredCluster, selectedCluster, data, dims, themeColors]);

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
  }, [clusters]);

  if (data.length === 0) {
    return (
      <GlassCard title="Key Reuse Clusters" delay={0.15}>
        <div className="intel-empty">No shared keys detected — all keys are unique.</div>
      </GlassCard>
    );
  }

  return (
    <GlassCard title="Key Reuse Clusters" titleRight={
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{data.length} shared keys</span>
    } delay={0.15}>
      <div ref={containerRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={dims.width}
          height={dims.height}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredCluster(null)}
          onClick={() => setSelectedCluster(hoveredCluster)}
          style={{ display: 'block', borderRadius: 12, cursor: hoveredCluster != null ? 'pointer' : 'default' }}
        />

        {/* Tooltip */}
        {hoveredCluster != null && (
          <div className="intel-cluster-tooltip">
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
        )}

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
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {clusters[selectedCluster].adi_urls.map(u => (
                  <span key={u} className="url-link" style={{ fontSize: 10 }}>{u}</span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  );
}

/* ═══════════════════════════════════════════════
   7D. AUTHORITY CONCENTRATION
   ═══════════════════════════════════════════════ */

function AuthorityConcentration({ data }: { data: Intelligence }) {
  const concentration = data.authority_concentration;
  if (concentration.length === 0) return null;

  const totalAccounts = concentration.reduce((s, a) => s + a.total_accounts, 0);
  const sortedBySize = [...concentration].sort((a, b) => b.total_accounts - a.total_accounts);

  // Waffle data: top 5 vs rest
  const top5Total = sortedBySize.slice(0, 5).reduce((s, a) => s + a.total_accounts, 0);
  const restTotal = totalAccounts - top5Total;
  const top5Pct = totalAccounts > 0 ? (top5Total / totalAccounts * 100) : 0;

  // Lorenz curve data
  const lorenz = useMemo(() => {
    const sorted = [...concentration].sort((a, b) => a.total_accounts - b.total_accounts);
    const points: { x: number; y: number }[] = [{ x: 0, y: 0 }];
    let cumAccounts = 0;
    sorted.forEach((a, i) => {
      cumAccounts += a.total_accounts;
      points.push({
        x: (i + 1) / sorted.length * 100,
        y: cumAccounts / totalAccounts * 100,
      });
    });
    return points;
  }, [concentration, totalAccounts]);

  // Gini coefficient
  const gini = useMemo(() => {
    const n = concentration.length;
    if (n === 0) return 0;
    const sorted = [...concentration].sort((a, b) => a.total_accounts - b.total_accounts);
    const mean = totalAccounts / n;
    let sumDiffs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        sumDiffs += Math.abs(sorted[i].total_accounts - sorted[j].total_accounts);
      }
    }
    return sumDiffs / (2 * n * n * mean);
  }, [concentration, totalAccounts]);

  return (
    <div className="intel-concentration">
      <div className="intel-concentration-row">
        {/* Waffle-like visual */}
        <GlassCard title="Authority Distribution" delay={0.15} style={{ flex: 1 }}>
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
        <GlassCard title="Authority Inequality" delay={0.2} style={{ flex: 1 }}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 36, fontWeight: 800, color: gini > 0.6 ? '#ef4444' : gini > 0.4 ? '#f59e0b' : '#22c55e' }}>
              {gini.toFixed(3)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Gini Coefficient {gini > 0.6 ? '(High inequality)' : gini > 0.4 ? '(Moderate)' : '(Low inequality)'}
            </div>
          </div>

          {/* Lorenz curve as SVG */}
          <LorenzCurve points={lorenz} />

          <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 8, textAlign: 'center' }}>
            Lorenz curve — closer to the diagonal = more equal distribution
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
            </div>

            {/* Stats table */}
            <div className="intel-compare-table">
              <table className="data-table">
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
                    { label: 'Shared Keys', key: 'sharedKeys' as const },
                    { label: 'Governed Accts', key: 'totalGoverned' as const },
                    { label: 'Delegations', key: 'delegations' as const },
                    { label: 'Cross-Auth Links', key: 'crossAuth' as const },
                    { label: 'Foreign Governed', key: 'foreignGoverned' as const },
                  ].map(metric => (
                    <tr key={metric.label}>
                      <td style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{metric.label}</td>
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
  const sec = data.key_security;
  const multiPct = sec.total_pages > 0 ? sec.multi_sig / sec.total_pages : 0;

  const sigData = [
    { name: 'Single-sig', value: sec.single_sig },
    { name: 'Multi-sig', value: sec.multi_sig },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid-3">
        <GlassCard glow delay={0.1}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 8 }}>
            <RingGauge value={multiPct} size={90} strokeWidth={7}
              color={multiPct > 0.1 ? '#22c55e' : '#ef4444'}
              valueLabel={`${(multiPct * 100).toFixed(1)}%`}
              label="Multi-sig" />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 4 }}>Multi-sig Adoption</div>
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
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Zero-credit pages</span>
              <GlowBadge variant={sec.zero_credit_pages > 0 ? 'warning' : 'success'}>
                <AnimatedCounter value={sec.zero_credit_pages} />
              </GlowBadge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Shared keys</span>
              <GlowBadge variant={data.key_reuse.length > 0 ? 'danger' : 'success'}>
                <AnimatedCounter value={data.key_reuse.length} />
              </GlowBadge>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Empty root ADIs</span>
              <GlowBadge variant={data.empty_adis > 0 ? 'authority' : 'success'}>
                <AnimatedCounter value={data.empty_adis} />
              </GlowBadge>
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard title="Accounts per ADI Distribution" delay={0.25}>
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
   MAIN VIEW
   ═══════════════════════════════════════════════ */

export function IntelligenceView() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['intelligence'],
    queryFn: api.getIntelligence,
  });
  const [params, setParams] = useSearchParams();
  const validSections = ['overview', 'heatmap', 'clusters', 'concentration', 'compare'];
  const initialSection = validSections.includes(params.get('section') || '') ? params.get('section')! : 'overview';
  const [section, setSectionState] = useState(initialSection);
  const setSection = useCallback((s: string) => {
    setSectionState(s);
    setParams(prev => { prev.set('section', s); return prev; }, { replace: true });
  }, [setParams]);

  if (isError) {
    return <ErrorState title="Failed to load intelligence data" onRetry={() => refetch()} />;
  }

  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="shimmer" style={{ height: 100, borderRadius: 16 }} />
        ))}
      </div>
    );
  }

  const sections = [
    { id: 'overview', label: 'Overview', icon: '\u25A3' },
    { id: 'heatmap', label: 'Risk Heatmap', icon: '\u2593' },
    { id: 'clusters', label: `Key Reuse (${data.key_reuse.length})`, icon: '\u25C9' },
    { id: 'concentration', label: 'Concentration', icon: '\u25A0' },
    { id: 'compare', label: 'Compare', icon: '\u2194' },
  ];

  return (
    <div className="intelligence-center">
      {/* Insight Feed */}
      <InsightFeed data={data} />

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
          {section === 'clusters' && <KeyReuseClusters data={data.key_reuse} />}
          {section === 'concentration' && <AuthorityConcentration data={data} />}
          {section === 'compare' && <ComparativeAnalysis data={data} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
