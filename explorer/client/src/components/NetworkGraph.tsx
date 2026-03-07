import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlowBadge } from './ui/GlowBadge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import type { TopologyNode, TopologyEdge, TopologyData } from '../types';
import TopologyWorker from '../workers/topologyWorker?worker';

/* ── Color Palettes ─────────────────────────────── */

const STATUS_COLORS_DARK: Record<string, string> = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#4a5078' };
const STATUS_COLORS_LIGHT: Record<string, string> = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#8b92ab' };

function heatColor(t: number): string {
  if (t < 0.25) return '#6c8cff';
  if (t < 0.5) return '#22d3ee';
  if (t < 0.75) return '#f59e0b';
  return '#ef4444';
}

const EDGE_COLORS: Record<string, string> = {
  hierarchy: 'rgba(108,140,255,0.12)',
  authority: 'rgba(245,158,11,0.18)',
  key_sharing: 'rgba(239,68,68,0.16)',
  delegation: 'rgba(52,211,153,0.20)',
};

/* ── Helpers ────────────────────────────────────── */

function shortLabel(url: string) {
  return url.replace('acc://', '').replace('.acme', '');
}

/* ── Layout: Hilbert curve for spatial locality ── */

function hilbertD2xy(n: number, d: number): [number, number] {
  let rx: number, ry: number, s: number, t = d;
  let x = 0, y = 0;
  for (s = 1; s < n; s *= 2) {
    rx = (t & 2) > 0 ? 1 : 0;
    ry = ((t & 1) ^ rx) > 0 ? 0 : 1;
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const tmp = x; x = y; y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

interface PositionedNode extends TopologyNode {
  px: number;
  py: number;
}

function layoutNodes(nodes: TopologyNode[], width: number, height: number): PositionedNode[] {
  const n = nodes.length;
  if (n === 0) return [];

  // Use Hilbert curve for spatially coherent placement
  // Find smallest power of 2 that fits all nodes in a square grid
  let order = 1;
  while (order * order < n) order *= 2;

  const pad = 40;
  const usableW = width - pad * 2;
  const usableH = height - pad * 2;
  const cellW = usableW / order;
  const cellH = usableH / order;

  return nodes.map((node, i) => {
    const [hx, hy] = hilbertD2xy(order, i);
    return {
      ...node,
      px: pad + hx * cellW + cellW / 2,
      py: pad + hy * cellH + cellH / 2,
    };
  });
}

/* ── Component ──────────────────────────────────── */

export function NetworkGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // State
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Camera (pan/zoom)
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  // Controls
  const [colorBy, setColorBy] = useState('status');
  const [edgeFilters, setEdgeFilters] = useState({
    hierarchy: false,
    authority: false,
    key_sharing: false,
    delegation: false,
  });

  // Data — lazy loaded via Web Worker to keep UI responsive
  const [loadRequested, setLoadRequested] = useState(false);
  const [topology, setTopology] = useState<TopologyData | null>(null);
  const [loadStatus, setLoadStatus] = useState<string>('');
  const [loadError, setLoadError] = useState<string>('');
  const isLoading = loadRequested && !topology && !loadError;

  useEffect(() => {
    if (!loadRequested) return;
    const worker = new TopologyWorker();
    worker.onmessage = (e) => {
      if (e.data.type === 'status') setLoadStatus(e.data.message);
      if (e.data.type === 'done') { setTopology(e.data.data); setLoadStatus(''); }
      if (e.data.type === 'error') { setLoadError(e.data.message); setLoadStatus(''); }
    };
    worker.postMessage('start');
    return () => worker.terminate();
  }, [loadRequested]);

  const { data: adiDetail } = useQuery({
    queryKey: ['adi-detail', selected?.id],
    queryFn: () => api.getAdi(selected!.id),
    enabled: !!selected,
    staleTime: 120000,
  });

  // Measure container
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const w = el.clientWidth || el.offsetWidth || el.getBoundingClientRect().width;
        const h = el.clientHeight || el.offsetHeight || el.getBoundingClientRect().height;
        if (w > 0 && h > 0) {
          setDims({ width: Math.round(w), height: Math.round(h) });
          return;
        }
      }
      setDims({ width: window.innerWidth - 64, height: window.innerHeight - 48 });
    }
    measure();
    const raf = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 200);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener('resize', measure); };
  }, [topology]);

  // Compute max account total for heat scale
  const maxAccounts = useMemo(() => {
    if (!topology) return 1;
    return Math.max(1, ...topology.nodes.map(n => n.account_total));
  }, [topology]);

  // Layout positions (pre-computed, no simulation)
  const positionedNodes = useMemo(() => {
    if (!topology) return [];
    // Use a virtual canvas size for layout, then we pan/zoom within it
    const layoutSize = Math.max(dims.width, dims.height, 2000);
    return layoutNodes(topology.nodes, layoutSize, layoutSize);
  }, [topology, dims.width, dims.height]);

  // Index maps for fast lookup
  const nodeById = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of positionedNodes) m.set(n.id, n);
    return m;
  }, [positionedNodes]);

  // Edge source/target lookup
  const edgesByNode = useMemo(() => {
    if (!topology) return new Map<string, TopologyEdge[]>();
    const m = new Map<string, TopologyEdge[]>();
    for (const e of topology.edges) {
      if (!m.has(e.source)) m.set(e.source, []);
      if (!m.has(e.target)) m.set(e.target, []);
      m.get(e.source)!.push(e);
      m.get(e.target)!.push(e);
    }
    return m;
  }, [topology]);

  // Visible edges
  const filteredEdges = useMemo(() => {
    if (!topology) return [];
    return topology.edges.filter(e => edgeFilters[e.type as keyof typeof edgeFilters]);
  }, [topology, edgeFilters]);

  // Search matches
  const searchMatches = useMemo(() => {
    if (!searchTerm || !topology) return null;
    const term = searchTerm.toLowerCase();
    return new Set(topology.nodes.filter(n => n.id.toLowerCase().includes(term)).map(n => n.id));
  }, [searchTerm, topology]);

  // Color function
  const getNodeColor = useCallback((node: TopologyNode) => {
    if (colorBy === 'status') {
      const sc = isDark ? STATUS_COLORS_DARK : STATUS_COLORS_LIGHT;
      return sc[node.crawl_status] || sc.default;
    }
    if (colorBy === 'accounts') return heatColor(node.account_total / maxAccounts);
    if (colorBy === 'depth') return node.parent_url ? '#a78bfa' : '#6c8cff';
    if (colorBy === 'risk') return node.book_count > 2 ? '#ef4444' : node.book_count > 1 ? '#f59e0b' : '#22c55e';
    return '#6c8cff';
  }, [colorBy, maxAccounts, isDark]);

  // Handle select from URL
  useEffect(() => {
    const selectUrl = searchParams.get('select');
    if (selectUrl && positionedNodes.length > 0) {
      const node = nodeById.get(selectUrl);
      if (node) {
        setSelected(node);
        setFlyoutOpen(true);
        setCamera({ x: dims.width / 2 - node.px * 3, y: dims.height / 2 - node.py * 3, zoom: 3 });
      }
    }
  }, [searchParams, positionedNodes, nodeById, dims]);

  // ── Canvas Rendering ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || positionedNodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = dims.width * dpr;
    canvas.height = dims.height * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = themeColors.canvasBg;
    ctx.fillRect(0, 0, dims.width, dims.height);

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    // Viewport bounds in world space (for culling)
    const invZoom = 1 / camera.zoom;
    const vpLeft = -camera.x * invZoom;
    const vpTop = -camera.y * invZoom;
    const vpRight = vpLeft + dims.width * invZoom;
    const vpBottom = vpTop + dims.height * invZoom;
    const vpPad = 20 * invZoom;

    // Draw edges (only if enabled — these are the expensive part)
    if (filteredEdges.length > 0 && filteredEdges.length < 50000) {
      for (const e of filteredEdges) {
        const src = nodeById.get(e.source);
        const tgt = nodeById.get(e.target);
        if (!src || !tgt) continue;
        // Cull edges fully outside viewport
        const eMinX = Math.min(src.px, tgt.px);
        const eMaxX = Math.max(src.px, tgt.px);
        const eMinY = Math.min(src.py, tgt.py);
        const eMaxY = Math.max(src.py, tgt.py);
        if (eMaxX < vpLeft - vpPad || eMinX > vpRight + vpPad || eMaxY < vpTop - vpPad || eMinY > vpBottom + vpPad) continue;
        ctx.beginPath();
        ctx.moveTo(src.px, src.py);
        ctx.lineTo(tgt.px, tgt.py);
        ctx.strokeStyle = EDGE_COLORS[e.type] || 'rgba(108,140,255,0.08)';
        ctx.lineWidth = 0.5 * invZoom;
        ctx.stroke();
      }
    }

    // Draw nodes (with viewport culling)
    const nodeRadius = Math.max(1.5, 3 * invZoom);
    const showLabels = camera.zoom > 4;

    for (const n of positionedNodes) {
      if (n.px < vpLeft - vpPad || n.px > vpRight + vpPad || n.py < vpTop - vpPad || n.py > vpBottom + vpPad) continue;

      const color = getNodeColor(n);
      const isSearch = searchMatches?.has(n.id);
      const isHov = hovered?.id === n.id;
      const isSel = selected?.id === n.id;

      // Dim non-matching nodes during search
      if (searchMatches && !isSearch) {
        ctx.globalAlpha = 0.08;
      }

      // Size by account_total
      const r = Math.max(nodeRadius, Math.log2((n.account_total || 1) + 1) * nodeRadius * 0.6);

      // Hover/select highlight
      if (isSel) {
        ctx.beginPath();
        ctx.arc(n.px, n.py, r + 4 * invZoom, 0, 2 * Math.PI);
        ctx.strokeStyle = '#6c8cff';
        ctx.lineWidth = 1.5 * invZoom;
        ctx.stroke();
      }
      if (isHov) {
        ctx.beginPath();
        ctx.arc(n.px, n.py, r + 3 * invZoom, 0, 2 * Math.PI);
        ctx.fillStyle = color + '44';
        ctx.fill();
      }
      if (isSearch) {
        ctx.beginPath();
        ctx.arc(n.px, n.py, r + 5 * invZoom, 0, 2 * Math.PI);
        ctx.strokeStyle = '#f472b6';
        ctx.lineWidth = 1.2 * invZoom;
        ctx.stroke();
      }

      // Node dot
      ctx.beginPath();
      if (n.parent_url) {
        // Diamond
        ctx.moveTo(n.px, n.py - r);
        ctx.lineTo(n.px + r, n.py);
        ctx.lineTo(n.px, n.py + r);
        ctx.lineTo(n.px - r, n.py);
        ctx.closePath();
      } else {
        ctx.arc(n.px, n.py, r, 0, 2 * Math.PI);
      }
      ctx.fillStyle = color;
      ctx.fill();

      ctx.globalAlpha = 1;

      // Labels at high zoom or for hovered/selected
      if (showLabels || isHov || isSel) {
        const fontSize = Math.max(3, 10 * invZoom);
        ctx.font = `${fontSize}px Inter, sans-serif`;
        ctx.fillStyle = themeColors.canvasText;
        ctx.textAlign = 'center';
        ctx.fillText(shortLabel(n.id), n.px, n.py + r + 10 * invZoom);
      }
    }

    ctx.restore();

    // Stats overlay
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = themeColors.canvasTextDim;
    ctx.textAlign = 'left';
    ctx.fillText(`${positionedNodes.length.toLocaleString()} nodes  |  Zoom: ${camera.zoom.toFixed(1)}x`, 12, dims.height - 12);

  }, [positionedNodes, filteredEdges, camera, dims, isDark, themeColors, getNodeColor, hovered, selected, searchMatches, nodeById]);

  // ── Hit testing ──
  const hitTest = useCallback((clientX: number, clientY: number): PositionedNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left;
    const my = clientY - rect.top;
    // Convert to world coords
    const wx = (mx - camera.x) / camera.zoom;
    const wy = (my - camera.y) / camera.zoom;
    const hitR = Math.max(6, 12 / camera.zoom);

    let closest: PositionedNode | null = null;
    let closestDist = hitR * hitR;
    for (const n of positionedNodes) {
      const dx = n.px - wx;
      const dy = n.py - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 < closestDist) {
        closestDist = d2;
        closest = n;
      }
    }
    return closest;
  }, [camera, positionedNodes]);

  // ── Mouse Handlers ──
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setCamera(c => ({ ...c, x: dragRef.current!.camX + dx, y: dragRef.current!.camY + dy }));
      return;
    }
    setHovered(hitTest(e.clientX, e.clientY));
  }, [hitTest]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, camX: camera.x, camY: camera.y };
    }
  }, [camera]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      const dx = Math.abs(e.clientX - dragRef.current.startX);
      const dy = Math.abs(e.clientY - dragRef.current.startY);
      dragRef.current = null;
      // If it was a click (not a drag), do hit test
      if (dx < 4 && dy < 4) {
        const node = hitTest(e.clientX, e.clientY);
        if (node) {
          setSelected(node);
          setFlyoutOpen(true);
        } else {
          setFlyoutOpen(false);
        }
      }
    }
  }, [hitTest]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setCamera(c => {
      const newZoom = Math.max(0.1, Math.min(50, c.zoom * factor));
      const ratio = newZoom / c.zoom;
      return {
        zoom: newZoom,
        x: mx - (mx - c.x) * ratio,
        y: my - (my - c.y) * ratio,
      };
    });
  }, []);

  const handleZoomToFit = useCallback(() => {
    if (positionedNodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of positionedNodes) {
      minX = Math.min(minX, n.px);
      maxX = Math.max(maxX, n.px);
      minY = Math.min(minY, n.py);
      maxY = Math.max(maxY, n.py);
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 60;
    const zoom = Math.min((dims.width - pad) / rangeX, (dims.height - pad) / rangeY);
    setCamera({
      zoom,
      x: (dims.width - rangeX * zoom) / 2 - minX * zoom,
      y: (dims.height - rangeY * zoom) / 2 - minY * zoom,
    });
  }, [positionedNodes, dims]);

  // Auto zoom-to-fit on first load
  const didAutoFit = useRef(false);
  useEffect(() => {
    if (positionedNodes.length > 0 && !didAutoFit.current) {
      didAutoFit.current = true;
      handleZoomToFit();
    }
  }, [positionedNodes, handleZoomToFit]);

  /* ── Landing / Loading State ────────────────────── */

  if (!loadRequested) {
    return (
      <div className="network-graph-fullscreen" ref={containerRef}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: 'var(--text-tertiary)', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ fontSize: 48, fontWeight: 800, color: 'var(--color-adi)', opacity: 0.3 }}>
            Network Topology
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
            This view renders 43,000+ identity nodes on an interactive canvas.
            Loading requires downloading ~9 MB of data.
          </div>
          <button
            onClick={() => setLoadRequested(true)}
            style={{
              marginTop: 8, background: 'var(--color-adi)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '12px 32px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '0.02em',
            }}
          >
            Load Network Graph
          </button>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="network-graph-fullscreen" ref={containerRef}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: '#ef4444', flexDirection: 'column', gap: 12,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Failed to load topology</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{loadError}</div>
          <button
            onClick={() => { setLoadError(''); setLoadRequested(true); }}
            style={{
              marginTop: 8, background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '8px 20px',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (isLoading || !topology) {
    return (
      <div className="network-graph-fullscreen" ref={containerRef}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', color: 'var(--text-tertiary)', flexDirection: 'column', gap: 16,
        }}>
          <div className="shimmer" style={{ width: 120, height: 120, borderRadius: '50%' }} />
          <div style={{ fontSize: 14 }}>{loadStatus || 'Loading...'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            Data is loading in a background thread — the app stays responsive.
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────── */

  return (
    <div className="network-graph-fullscreen" ref={containerRef}>

      {/* ── Main Canvas ── */}
      <canvas
        ref={canvasRef}
        style={{ width: dims.width, height: dims.height, cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { dragRef.current = null; setHovered(null); }}
        onWheel={handleWheel}
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
          {positionedNodes.length.toLocaleString()} nodes &middot; {filteredEdges.length.toLocaleString()} edges
        </div>
      </div>

      {/* ── Floating Legend (Bottom-Left) ── */}
      <div className="net-legend">
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

        <div className="net-legend-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 6 }}>
          <span className="net-legend-item">
            <svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#6c8cff" /></svg>
            Root ADI
          </span>
          <span className="net-legend-item">
            <svg width="8" height="8"><polygon points="4,0 8,4 4,8 0,4" fill="#a78bfa" /></svg>
            Sub-ADI
          </span>

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
                    const parent = nodeById.get(selected.parent_url!);
                    if (parent) setSelected(parent);
                  }}>{shortLabel(selected.parent_url)}</span>
                </div>
              )}
            </div>

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

            <div className="net-flyout-section">
              <div className="net-flyout-section-title">Connections</div>
              {(() => {
                const connectedEdges = edgesByNode.get(selected.id) || [];
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
                          const node = nodeById.get(t);
                          if (node) {
                            setSelected(node);
                            setCamera({ x: dims.width / 2 - node.px * 3, y: dims.height / 2 - node.py * 3, zoom: 3 });
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

            <div className="net-flyout-actions">
              <button className="net-flyout-action-btn" onClick={() => {
                navigate(`/tree?select=${encodeURIComponent(selected.id)}`);
              }}>
                Open in Tree Explorer
              </button>
              <button className="net-flyout-action-btn secondary" onClick={() => {
                setCamera({ x: dims.width / 2 - selected.px * 5, y: dims.height / 2 - selected.py * 5, zoom: 5 });
              }}>
                Center & Zoom
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Keyboard shortcut hint ── */}
      <div className="net-shortcut-hint">
        Click node for details &middot; Scroll to zoom &middot; Drag to pan
      </div>
    </div>
  );
}
