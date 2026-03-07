import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import ForceGraph2D from 'react-force-graph-2d';
import { api } from '../api/client';
import { GlowBadge } from './ui/GlowBadge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import type { TopologyNode, TopologyEdge } from '../types';

/* ── Color Palettes ─────────────────────────────── */

const STATUS_COLORS_DARK = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#4a5078' };
const STATUS_COLORS_LIGHT = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#8b92ab' };

function heatColor(t: number): string {
  // 0=cool blue → 1=hot red
  if (t < 0.25) return '#6c8cff';
  if (t < 0.5) return '#22d3ee';
  if (t < 0.75) return '#f59e0b';
  return '#ef4444';
}

function depthColor(hasParent: boolean): string {
  return hasParent ? '#a78bfa' : '#6c8cff';
}

/* ── Edge Styles ────────────────────────────────── */

const EDGE_COLORS: Record<string, string> = {
  hierarchy: 'rgba(108,140,255,0.15)',
  authority: 'rgba(245,158,11,0.22)',
  key_sharing: 'rgba(239,68,68,0.20)',
  delegation: 'rgba(52,211,153,0.25)',
};

const EDGE_COLORS_BRIGHT: Record<string, string> = {
  hierarchy: 'rgba(108,140,255,0.6)',
  authority: 'rgba(245,158,11,0.7)',
  key_sharing: 'rgba(239,68,68,0.65)',
  delegation: 'rgba(52,211,153,0.7)',
};

const EDGE_DASH: Record<string, number[] | null> = {
  hierarchy: null,
  authority: [4, 3],
  key_sharing: [2, 2],
  delegation: [6, 3],
};

/* ── Helpers ────────────────────────────────────── */

function shortLabel(url: string) {
  return url.replace('acc://', '').replace('.acme', '');
}

/* ── Component ──────────────────────────────────── */

export function NetworkGraph() {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // State
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hovered, setHovered] = useState<TopologyNode | null>(null);
  const [selected, setSelected] = useState<TopologyNode | null>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');

  // Controls
  const [colorBy, setColorBy] = useState('status');
  const [edgeFilters, setEdgeFilters] = useState({
    hierarchy: true,
    authority: true,
    key_sharing: true,
    delegation: true,
  });

  // Data
  const { data: topology, isLoading } = useQuery({
    queryKey: ['topology'],
    queryFn: api.getTopology,
    staleTime: 300000,
  });

  const { data: adiDetail } = useQuery({
    queryKey: ['adi-detail', selected?.id],
    queryFn: () => api.getAdi(selected!.id),
    enabled: !!selected,
    staleTime: 120000,
  });

  // Measure container
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setDims({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Configure forces
  useEffect(() => {
    const fg = fgRef.current;
    if (fg) {
      fg.d3Force('charge')?.strength(-40);
      fg.d3Force('link')?.distance(45);
    }
  }, [topology]);

  // Handle select from URL
  useEffect(() => {
    const selectUrl = searchParams.get('select');
    if (selectUrl && topology) {
      const node = topology.nodes.find(n => n.id === selectUrl);
      if (node) {
        setSelected(node);
        setFlyoutOpen(true);
        setTimeout(() => {
          fgRef.current?.centerAt(0, 0, 300);
        }, 500);
      }
    }
  }, [searchParams, topology]);

  // Compute max account total for heat scale
  const maxAccounts = useMemo(() => {
    if (!topology) return 1;
    return Math.max(1, ...topology.nodes.map(n => n.account_total));
  }, [topology]);

  // Build neighbor sets for hover highlighting
  const neighborMap = useMemo(() => {
    if (!topology) return new Map<string, Set<string>>();
    const map = new Map<string, Set<string>>();
    for (const node of topology.nodes) {
      map.set(node.id, new Set());
    }
    for (const edge of topology.edges) {
      map.get(edge.source)?.add(edge.target);
      map.get(edge.target)?.add(edge.source);
    }
    return map;
  }, [topology]);

  // Search matching node IDs
  const searchMatches = useMemo(() => {
    if (!searchTerm || !topology) return null;
    const term = searchTerm.toLowerCase();
    return new Set(topology.nodes.filter(n => n.id.toLowerCase().includes(term)).map(n => n.id));
  }, [searchTerm, topology]);

  // Filter edges
  const filteredEdges = useMemo(() => {
    if (!topology) return [];
    return topology.edges.filter(e => edgeFilters[e.type] !== false);
  }, [topology, edgeFilters]);

  const graphData = useMemo(() => {
    if (!topology) return { nodes: [], links: [] };
    return {
      nodes: topology.nodes.map(n => ({ ...n })),
      links: filteredEdges.map(e => ({ ...e })),
    };
  }, [topology, filteredEdges]);

  /* ── Node Rendering ───────────────────────────── */

  const getNodeColor = useCallback((node: TopologyNode) => {
    if (colorBy === 'status') {
      const sc = isDark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
      return sc[node.crawl_status as keyof typeof sc] || sc.default;
    }
    if (colorBy === 'accounts') {
      return heatColor(node.account_total / maxAccounts);
    }
    if (colorBy === 'depth') {
      return depthColor(!!node.parent_url);
    }
    if (colorBy === 'risk') {
      // nodes with higher book_count relative to accounts = higher risk
      return node.book_count > 2 ? '#ef4444' : node.book_count > 1 ? '#f59e0b' : '#22c55e';
    }
    return '#6c8cff';
  }, [colorBy, maxAccounts, isDark]);

  const getNodeSize = useCallback((node: TopologyNode) => {
    return Math.max(2.5, Math.log2((node.account_total || 1) + 1) * 2.2);
  }, []);

  const isNodeDimmed = useCallback((nodeId: string) => {
    if (searchMatches && !searchMatches.has(nodeId)) return true;
    if (hovered && hovered.id !== nodeId && !neighborMap.get(hovered.id)?.has(nodeId)) return true;
    return false;
  }, [hovered, neighborMap, searchMatches]);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as TopologyNode & { x: number; y: number };
    const size = getNodeSize(n);
    const color = getNodeColor(n);
    const dimmed = isNodeDimmed(n.id);
    const isSelected = selected?.id === n.id;
    const isHovered = hovered?.id === n.id;
    const isPinned = pinnedNodes.has(n.id);

    const alpha = dimmed ? 0.12 : 1;

    // Selection ring
    if (isSelected) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + 5, 0, 2 * Math.PI);
      ctx.strokeStyle = '#6c8cff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Hover glow
    if (isHovered && !dimmed) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
    }

    // Pin indicator
    if (isPinned) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = 'rgba(245,158,11,0.5)';
      ctx.lineWidth = 0.8;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Node shape
    ctx.beginPath();
    ctx.globalAlpha = alpha;
    if (n.parent_url) {
      // Diamond for sub-ADIs
      ctx.moveTo(n.x, n.y - size);
      ctx.lineTo(n.x + size, n.y);
      ctx.lineTo(n.x, n.y + size);
      ctx.lineTo(n.x - size, n.y);
      ctx.closePath();
    } else {
      ctx.arc(n.x, n.y, size, 0, 2 * Math.PI);
    }
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Search match highlight
    if (searchMatches?.has(n.id)) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + 6, 0, 2 * Math.PI);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Label
    if (globalScale > 2.2 || isHovered || isSelected) {
      const label = shortLabel(n.id);
      const fontSize = Math.max(3, 10 / globalScale);
      ctx.font = `${fontSize}px Inter, sans-serif`;
      ctx.fillStyle = dimmed ? 'rgba(232,236,244,0.15)' : themeColors.canvasText;
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, n.y + size + 8 / globalScale);
    }
  }, [getNodeColor, getNodeSize, isNodeDimmed, selected, hovered, pinnedNodes, searchMatches, themeColors]);

  /* ── Edge Rendering ───────────────────────────── */

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const s = link.source;
    const t = link.target;
    if (!s?.x || !t?.x) return;
    const edgeType = link.type as string;

    // Highlight edges connected to hovered node
    const isHighlighted = hovered && (s.id === hovered.id || t.id === hovered.id);
    const dimmed = hovered && !isHighlighted;

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = isHighlighted
      ? (EDGE_COLORS_BRIGHT[edgeType] || 'rgba(108,140,255,0.5)')
      : dimmed
        ? 'rgba(108,140,255,0.03)'
        : (EDGE_COLORS[edgeType] || 'rgba(108,140,255,0.08)');
    ctx.lineWidth = isHighlighted ? 1.2 : (edgeType === 'hierarchy' ? 0.4 : 0.7);
    const dash = EDGE_DASH[edgeType];
    if (dash) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Arrow for delegation
    if (edgeType === 'delegation' && !dimmed) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        const ux = dx / len;
        const uy = dy / len;
        const mx = (s.x + t.x) / 2;
        const my = (s.y + t.y) / 2;
        const arrowSize = 3;
        ctx.beginPath();
        ctx.moveTo(mx + ux * arrowSize, my + uy * arrowSize);
        ctx.lineTo(mx - ux * arrowSize + uy * arrowSize * 0.6, my - uy * arrowSize - ux * arrowSize * 0.6);
        ctx.lineTo(mx - ux * arrowSize - uy * arrowSize * 0.6, my - uy * arrowSize + ux * arrowSize * 0.6);
        ctx.closePath();
        ctx.fillStyle = EDGE_COLORS_BRIGHT.delegation;
        ctx.fill();
      }
    }
  }, [hovered]);

  /* ── Event Handlers ───────────────────────────── */

  const handleNodeClick = useCallback((node: any) => {
    const n = node as TopologyNode;
    setSelected(n);
    setFlyoutOpen(true);
  }, []);

  const handleNodeDoubleClick = useCallback((node: any) => {
    fgRef.current?.centerAt(node.x, node.y, 600);
    fgRef.current?.zoom(5, 600);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    if (!hovered) {
      setFlyoutOpen(false);
    }
  }, [hovered]);

  const togglePin = useCallback((nodeId: string) => {
    setPinnedNodes(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        // Unpin in force graph
        const fg = fgRef.current;
        if (fg) {
          const gd = fg.graphData();
          const node = gd.nodes.find((n: any) => n.id === nodeId);
          if (node) {
            node.fx = undefined;
            node.fy = undefined;
          }
        }
      } else {
        next.add(nodeId);
        // Pin in force graph
        const fg = fgRef.current;
        if (fg) {
          const gd = fg.graphData();
          const node = gd.nodes.find((n: any) => n.id === nodeId);
          if (node) {
            node.fx = node.x;
            node.fy = node.y;
          }
        }
      }
      return next;
    });
  }, []);

  const handleZoomToFit = useCallback(() => {
    fgRef.current?.zoomToFit(400, 60);
  }, []);

  /* ── Loading State ────────────────────────────── */

  if (isLoading || !topology) {
    return (
      <div className="network-graph-fullscreen">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: 'var(--text-tertiary)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div className="shimmer" style={{ width: 200, height: 200, borderRadius: '50%', margin: '0 auto 20px' }} />
            <div style={{ fontSize: 14 }}>Loading network topology...</div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────── */

  const edgeCount = filteredEdges.length;

  return (
    <div className="network-graph-fullscreen" ref={containerRef}>

      {/* ── Main Canvas ── */}
      <ForceGraph2D
        ref={fgRef}
        graphData={graphData}
        width={dims.width}
        height={dims.height}
        backgroundColor={themeColors.canvasBg}
        nodeCanvasObject={paintNode}
        nodeCanvasObjectMode={() => 'replace'}
        linkCanvasObject={paintLink}
        linkCanvasObjectMode={() => 'replace'}
        onNodeHover={(node: any) => setHovered(node as TopologyNode | null)}
        onNodeClick={handleNodeClick}
        onNodeDragEnd={(node: any) => {
          if (pinnedNodes.has(node.id)) {
            node.fx = node.x;
            node.fy = node.y;
          }
        }}
        onBackgroundClick={handleBackgroundClick}
        cooldownTicks={150}
        d3AlphaDecay={0.018}
        d3VelocityDecay={0.28}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        minZoom={0.2}
        maxZoom={16}
      />

      {/* ── Floating Control Panel (Top-Left) ── */}
      <div className="net-control-panel">
        <div className="net-panel-title">Controls</div>

        {/* Search */}
        <div className="net-control-group">
          <input
            type="text"
            placeholder="Search nodes..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="net-search-input"
          />
        </div>

        {/* Color By */}
        <div className="net-control-group">
          <div className="net-control-label">Color by</div>
          <select
            value={colorBy}
            onChange={e => setColorBy(e.target.value)}
            className="net-select"
          >
            <option value="status">Status</option>
            <option value="accounts">Account Count</option>
            <option value="depth">Depth (Root/Sub)</option>
            <option value="risk">Key Reuse Risk</option>
          </select>
        </div>

        {/* Edge Filters */}
        <div className="net-control-group">
          <div className="net-control-label">Edges</div>
          {([
            { key: 'hierarchy', label: 'Parent-child', color: '#6c8cff' },
            { key: 'authority', label: 'Authority', color: '#f59e0b' },
            { key: 'key_sharing', label: 'Key sharing', color: '#ef4444' },
            { key: 'delegation', label: 'Delegation', color: '#34d399' },
          ] as const).map(({ key, label, color }) => (
            <label key={key} className="net-checkbox-label">
              <input
                type="checkbox"
                checked={edgeFilters[key]}
                onChange={e => setEdgeFilters(f => ({ ...f, [key]: e.target.checked }))}
              />
              <span className="net-checkbox-dot" style={{ background: color }} />
              {label}
            </label>
          ))}
        </div>

        {/* Actions */}
        <div className="net-control-group" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
          <button className="net-action-btn" onClick={handleZoomToFit}>
            Zoom to Fit
          </button>
        </div>

        {/* Stats */}
        <div className="net-stats">
          {topology.nodes.length} nodes &middot; {edgeCount} edges
        </div>
      </div>

      {/* ── Floating Legend (Bottom-Left) ── */}
      <div className="net-legend">
        {/* Edge legend */}
        <div className="net-legend-section">
          {[
            { label: 'Parent-child', color: '#6c8cff', dash: false },
            { label: 'Authority', color: '#f59e0b', dash: true },
            { label: 'Key sharing', color: '#ef4444', dash: true },
            { label: 'Delegation', color: '#34d399', dash: true },
          ].map(l => (
            <span key={l.label} className="net-legend-item">
              <svg width="16" height="2">
                <line x1="0" y1="1" x2="16" y2="1" stroke={l.color} strokeWidth="2"
                  strokeDasharray={l.dash ? '3,2' : undefined} />
              </svg>
              {l.label}
            </span>
          ))}
        </div>

        {/* Node legend */}
        <div className="net-legend-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 6 }}>
          <span className="net-legend-item">
            <svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#6c8cff" /></svg>
            Root ADI
          </span>
          <span className="net-legend-item">
            <svg width="8" height="8"><polygon points="4,0 8,4 4,8 0,4" fill="#a78bfa" /></svg>
            Sub-ADI
          </span>

          {/* Dynamic color legend */}
          {colorBy === 'status' && (
            <>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#22c55e' }} /> Done</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#ef4444' }} /> Error</span>
            </>
          )}
          {colorBy === 'accounts' && (
            <>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#6c8cff' }} /> Low</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#22d3ee' }} /> Med</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#f59e0b' }} /> High</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#ef4444' }} /> Very High</span>
            </>
          )}
          {colorBy === 'depth' && (
            <>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#6c8cff' }} /> Root</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#a78bfa' }} /> Sub-ADI</span>
            </>
          )}
          {colorBy === 'risk' && (
            <>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#22c55e' }} /> Low</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#f59e0b' }} /> Medium</span>
              <span className="net-legend-item"><span className="net-legend-dot" style={{ background: '#ef4444' }} /> High</span>
            </>
          )}
        </div>
      </div>

      {/* ── Hover Tooltip ── */}
      <AnimatePresence>
        {hovered && !flyoutOpen && (
          <motion.div
            className="net-tooltip"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <div className="net-tooltip-title">{shortLabel(hovered.id)}</div>
            <div className="net-tooltip-rows">
              <span>Status: <span style={{ color: hovered.crawl_status === 'done' ? '#22c55e' : '#ef4444' }}>{hovered.crawl_status}</span></span>
              <span>Tokens: <strong style={{ color: '#22d3ee' }}>{hovered.token_count}</strong></span>
              <span>Data: <strong style={{ color: '#a78bfa' }}>{hovered.data_count}</strong></span>
              <span>Key Books: <strong style={{ color: '#34d399' }}>{hovered.book_count}</strong></span>
              <span>Entries: <strong>{hovered.entry_count}</strong></span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Detail Flyout Panel (Right Side) ── */}
      <AnimatePresence>
        {flyoutOpen && selected && (
          <motion.div
            className="net-flyout"
            initial={{ x: 380 }}
            animate={{ x: 0 }}
            exit={{ x: 380 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <div className="net-flyout-header">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="net-flyout-url">{shortLabel(selected.id)}</div>
                <div className="net-flyout-full-url">{selected.id}</div>
              </div>
              <button className="net-flyout-close" onClick={() => setFlyoutOpen(false)}>
                &times;
              </button>
            </div>

            {/* Status */}
            <div className="net-flyout-section">
              <div className="net-flyout-row">
                <span>Status</span>
                <GlowBadge variant={selected.crawl_status === 'done' ? 'success' : 'danger'}>
                  {selected.crawl_status}
                </GlowBadge>
              </div>
              <div className="net-flyout-row">
                <span>Type</span>
                <GlowBadge variant={selected.parent_url ? 'data' : 'adi'}>
                  {selected.parent_url ? 'Sub-ADI' : 'Root ADI'}
                </GlowBadge>
              </div>
              {selected.parent_url && (
                <div className="net-flyout-row">
                  <span>Parent</span>
                  <span className="net-flyout-link" onClick={() => {
                    const parent = topology.nodes.find(n => n.id === selected.parent_url);
                    if (parent) { setSelected(parent); }
                  }}>{shortLabel(selected.parent_url)}</span>
                </div>
              )}
            </div>

            {/* Metrics */}
            <div className="net-flyout-section">
              <div className="net-flyout-section-title">Accounts</div>
              <div className="net-flyout-metrics">
                <div className="net-flyout-metric">
                  <div className="net-flyout-metric-value" style={{ color: '#22d3ee' }}>
                    <AnimatedCounter value={selected.token_count} />
                  </div>
                  <div className="net-flyout-metric-label">Token</div>
                </div>
                <div className="net-flyout-metric">
                  <div className="net-flyout-metric-value" style={{ color: '#a78bfa' }}>
                    <AnimatedCounter value={selected.data_count} />
                  </div>
                  <div className="net-flyout-metric-label">Data</div>
                </div>
                <div className="net-flyout-metric">
                  <div className="net-flyout-metric-value" style={{ color: '#34d399' }}>
                    <AnimatedCounter value={selected.book_count} />
                  </div>
                  <div className="net-flyout-metric-label">Key Books</div>
                </div>
                <div className="net-flyout-metric">
                  <div className="net-flyout-metric-value" style={{ color: 'var(--text-primary)' }}>
                    <AnimatedCounter value={selected.entry_count} />
                  </div>
                  <div className="net-flyout-metric-label">Entries</div>
                </div>
              </div>
            </div>

            {/* Connections */}
            <div className="net-flyout-section">
              <div className="net-flyout-section-title">Connections</div>
              {(() => {
                const connectedEdges = topology.edges.filter(
                  e => e.source === selected.id || e.target === selected.id
                );
                const byType: Record<string, string[]> = {};
                for (const e of connectedEdges) {
                  const other = e.source === selected.id ? e.target : e.source;
                  (byType[e.type] ??= []).push(other);
                }
                return Object.entries(byType).map(([type, targets]) => (
                  <div key={type} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                      {type.replace('_', ' ')} ({targets.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {targets.slice(0, 8).map(t => (
                        <span key={t} className="net-flyout-conn-tag" onClick={() => {
                          const node = topology.nodes.find(n => n.id === t);
                          if (node) {
                            setSelected(node);
                            fgRef.current?.centerAt(0, 0, 300);
                          }
                        }}>
                          {shortLabel(t).slice(0, 20)}
                        </span>
                      ))}
                      {targets.length > 8 && (
                        <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>+{targets.length - 8} more</span>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* ADI Detail (from API) */}
            {adiDetail && (
              <div className="net-flyout-section">
                <div className="net-flyout-section-title">Authorities</div>
                {adiDetail.authorities && adiDetail.authorities.length > 0 ? (
                  adiDetail.authorities.map((a, i) => (
                    <div key={i} className="net-flyout-row" style={{ fontSize: 11 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                        {shortLabel(a.authority_url).slice(0, 28)}
                      </span>
                      <GlowBadge variant={a.is_implied ? 'warning' : 'adi'}>
                        {a.is_implied ? 'implied' : 'explicit'}
                      </GlowBadge>
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>No authorities</div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="net-flyout-actions">
              <button className="net-flyout-action-btn" onClick={() => {
                navigate(`/tree?select=${encodeURIComponent(selected.id)}`);
              }}>
                Open in Tree Explorer
              </button>
              <button className="net-flyout-action-btn secondary" onClick={() => togglePin(selected.id)}>
                {pinnedNodes.has(selected.id) ? 'Unpin Node' : 'Pin Node'}
              </button>
              <button className="net-flyout-action-btn secondary" onClick={() => handleNodeDoubleClick(selected)}>
                Center & Zoom
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Minimap (Bottom-Right) ── */}
      <Minimap
        nodes={topology.nodes}
        edges={filteredEdges}
        getNodeColor={getNodeColor}
        fgRef={fgRef}
        isDark={isDark}
      />

      {/* ── Keyboard shortcut hint ── */}
      <div className="net-shortcut-hint">
        Double-click node to zoom &middot; Drag to rearrange &middot; Scroll to zoom
      </div>
    </div>
  );
}

/* ── Minimap Component ──────────────────────────── */

interface MinimapProps {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  getNodeColor: (n: TopologyNode) => string;
  fgRef: React.RefObject<any>;
}

function Minimap({ nodes, edges, getNodeColor, fgRef, isDark }: MinimapProps & { isDark: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeColors = getThemeColors(isDark);

  // Redraw periodically as force simulation settles
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const SIZE = 150;
    canvas.width = SIZE;
    canvas.height = SIZE;

    // Get node positions from force graph
    const fg = fgRef.current;
    if (!fg || typeof fg.graphData !== 'function') return;
    const gd = fg.graphData();
    const posNodes = gd.nodes as Array<TopologyNode & { x?: number; y?: number }>;

    if (posNodes.length === 0) return;

    // Find bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of posNodes) {
      if (n.x == null || n.y == null) continue;
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    if (!isFinite(minX)) return;

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 10;
    const scale = (SIZE - pad * 2) / Math.max(rangeX, rangeY);

    const tx = (x: number) => pad + (x - minX) * scale + (SIZE - pad * 2 - rangeX * scale) / 2;
    const ty = (y: number) => pad + (y - minY) * scale + (SIZE - pad * 2 - rangeY * scale) / 2;

    // Clear
    ctx.fillStyle = isDark ? 'rgba(6,8,15,0.9)' : 'rgba(245,247,250,0.9)';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Draw edges
    ctx.strokeStyle = 'rgba(108,140,255,0.08)';
    ctx.lineWidth = 0.3;
    for (const link of gd.links as any[]) {
      const s = typeof link.source === 'object' ? link.source : posNodes.find((n: any) => n.id === link.source);
      const t = typeof link.target === 'object' ? link.target : posNodes.find((n: any) => n.id === link.target);
      if (!s?.x || !t?.x) continue;
      ctx.beginPath();
      ctx.moveTo(tx(s.x), ty(s.y));
      ctx.lineTo(tx(t.x), ty(t.y));
      ctx.stroke();
    }

    // Draw nodes
    const srcNodes = nodes;
    for (const n of posNodes) {
      if (n.x == null || n.y == null) continue;
      const srcNode = srcNodes.find(sn => sn.id === n.id);
      ctx.beginPath();
      ctx.arc(tx(n.x), ty(n.y), 1.2, 0, 2 * Math.PI);
      ctx.fillStyle = srcNode ? getNodeColor(srcNode) : themeColors.canvasTextMuted;
      ctx.fill();
    }

    // Border
    ctx.strokeStyle = 'rgba(108,140,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);

  }, [nodes, edges, getNodeColor, fgRef, tick, isDark]);

  return (
    <canvas
      ref={canvasRef}
      className="net-minimap"
      width={150}
      height={150}
      onClick={(e) => {
        // Click minimap to navigate
        const canvas = canvasRef.current;
        const fg = fgRef.current;
        if (!canvas || !fg || typeof fg.graphData !== 'function') return;
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        // Map back to graph coords (approximate)
        const gd = fg.graphData();
        const posNodes = gd.nodes as Array<{ x?: number; y?: number }>;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of posNodes) {
          if (n.x == null || n.y == null) continue;
          minX = Math.min(minX, n.x);
          maxX = Math.max(maxX, n.x);
          minY = Math.min(minY, n.y);
          maxY = Math.max(maxY, n.y);
        }
        if (!isFinite(minX)) return;
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const pad = 10;
        const scale = (150 - pad * 2) / Math.max(rangeX, rangeY);
        const gx = (x - pad - (150 - pad * 2 - rangeX * scale) / 2) / scale + minX;
        const gy = (y - pad - (150 - pad * 2 - rangeY * scale) / 2) / scale + minY;
        fg.centerAt(gx, gy, 400);
      }}
    />
  );
}
