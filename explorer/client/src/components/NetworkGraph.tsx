import { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api/client';
import { GlowBadge } from './ui/GlowBadge';
import { AnimatedCounter } from './ui/AnimatedCounter';
import { InfoTip } from './ui/InfoTip';
import { useTheme } from '../contexts/ThemeContext';
import { getThemeColors } from '../hooks/useThemeColors';
import { getEntityColor } from '../hooks/useEntityColor';
import {
  getEdgeColors,
  getEdgeLegendColor,
  shortLabel,
  COLOR_BY_OPTIONS,
  EDGE_LEGEND_ITEMS,
  NODE_SHAPE_LEGEND_ITEMS,
  STATUS_MARKER_LEGEND_ITEMS,
  drawStatusMarker,
  defaultEdgeFilters,
  nodeHasContent,
  isEdgeVisible,
  accountCountColor,
  riskColor,
  colorLegendItems,
  colorLegendItemColor,
} from './graph/graphShared';
import type { TopologyNode, TopologyEdge, TopologyData } from '../types';
import TopologyWorker from '../workers/topologyWorker?worker';

/* ── Color Palettes ─────────────────────────────── */

const STATUS_COLORS_DARK: Record<string, string> = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#4a5078' };
const STATUS_COLORS_LIGHT: Record<string, string> = { done: '#22c55e', error: '#ef4444', pending: '#f59e0b', default: '#8b92ab' };

/* ── Layout ──────────────────────────────────────── */

interface PositionedNode extends TopologyNode {
  px: number;
  py: number;
}

// Golden angle spiral — gives a natural sunflower-like distribution
// Sort nodes by status first so clusters form organically
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function layoutNodes(nodes: TopologyNode[]): PositionedNode[] {
  const n = nodes.length;
  if (n === 0) return [];

  // Sort by account_total descending — largest nodes at center, smallest at edge
  // This creates a natural gradient from center outward
  const sorted = [...nodes].sort((a, b) => b.account_total - a.account_total);

  // Spacing factor — controls how spread out the spiral is
  const spacing = 2.8;

  return sorted.map((node, i) => {
    const r = spacing * Math.sqrt(i);
    const theta = i * GOLDEN_ANGLE;
    return {
      ...node,
      px: r * Math.cos(theta),
      py: r * Math.sin(theta),
    };
  });
}

/* ── Component ──────────────────────────────────── */

/* ── Spatial Index ───────────────────────────────── */

interface SpatialGrid {
  cellSize: number;
  buckets: Map<string, PositionedNode[]>;
}

function gridKey(cx: number, cy: number): string {
  return cx + ',' + cy;
}

function buildSpatialGrid(nodes: PositionedNode[]): SpatialGrid {
  // Cell size in world units. Node world spacing (`spacing` in layout) is 2.8,
  // so a cell of ~40 world units comfortably covers typical hit radii while
  // keeping buckets small.
  const cellSize = 40;
  const buckets = new Map<string, PositionedNode[]>();
  for (const n of nodes) {
    const cx = Math.floor(n.px / cellSize);
    const cy = Math.floor(n.py / cellSize);
    const key = gridKey(cx, cy);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = []; buckets.set(key, bucket); }
    bucket.push(n);
  }
  return { cellSize, buckets };
}

export function NetworkGraph() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // State
  const [dims, setDims] = useState({ width: 800, height: 600 });
  const [hovered, setHovered] = useState<PositionedNode | null>(null);
  // Container-relative cursor position used to anchor the hover tooltip near the
  // pointer (P3.5). Updated from the same rAF-coalesced pointer-move path.
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);
  const [flyoutOpen, setFlyoutOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Camera (pan/zoom)
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const dragRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null);

  // rAF coalescing for pointer move (one hover/pan update per frame max)
  const rafRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ clientX: number; clientY: number } | null>(null);
  // Mirror of `hovered.id` so the rAF flush can guard without re-subscribing.
  const hoveredIdRef = useRef<string | null>(null);

  // Controls
  const [colorBy, setColorBy] = useState('accounts');
  const [hideEmpty, setHideEmpty] = useState(true);
  // Default edges ON for hierarchy (P2.4) so structure is visible on first load.
  const [edgeFilters, setEdgeFilters] = useState(defaultEdgeFilters);

  // Data — lazy loaded via Web Worker, user clicks to start
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
    worker.postMessage({ activeOnly: true });
    return () => worker.terminate();
  }, [loadRequested]);

  const { data: adiDetail } = useQuery({
    queryKey: ['adi-detail', selected?.id],
    queryFn: () => api.getAdi(selected!.id),
    enabled: !!selected,
    staleTime: 120000,
  });

  // Measure container with ResizeObserver (most reliable)
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w > 0 && h > 0) {
          setDims({ width: w, height: h });
          return;
        }
      }
      // Hard fallback — always produce valid dims
      setDims({
        width: Math.max(400, window.innerWidth - 64),
        height: Math.max(300, window.innerHeight - 48),
      });
    }

    measure();
    const timer = setTimeout(measure, 100);

    let ro: ResizeObserver | null = null;
    if (containerRef.current) {
      ro = new ResizeObserver(() => measure());
      ro.observe(containerRef.current);
    }

    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [topology, loadRequested]);

  // Filter + layout positions (pre-computed, no simulation)
  const positionedNodes = useMemo(() => {
    if (!topology) return [];
    const nodes = hideEmpty
      ? topology.nodes.filter(nodeHasContent)
      : topology.nodes;
    return layoutNodes(nodes);
  }, [topology, hideEmpty]);

  // Index maps for fast lookup
  const nodeById = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of positionedNodes) m.set(n.id, n);
    return m;
  }, [positionedNodes]);

  // Uniform spatial grid for O(1)-ish hit testing (replaces O(N) linear scan)
  const spatialGrid = useMemo(() => buildSpatialGrid(positionedNodes), [positionedNodes]);

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

  // Visible edges — only between visible nodes
  const filteredEdges = useMemo(() => {
    if (!topology) return [];
    return topology.edges.filter(e => isEdgeVisible(e, edgeFilters, nodeById));
  }, [topology, edgeFilters, nodeById]);

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
    if (colorBy === 'accounts') {
      // Shared account-count buckets so the minimap (TopologyMap) and this graph
      // read identically (P-C6). 0 → muted, 1–4 / 5–19 / 20–49 / 50+ buckets.
      return accountCountColor(node.account_total, themeColors.canvasTextMuted);
    }
    if (colorBy === 'depth') return node.parent_url ? '#a78bfa' : '#6c8cff';
    if (colorBy === 'risk') {
      // Real key-reuse signal (P-C3): color by shared_key_count (distinct other
      // ADIs this node shares a signing key with), NOT book_count. Bands:
      // 0 → safe, 1–4 → moderate, ≥5 → high.
      return riskColor(node.shared_key_count);
    }
    return '#6c8cff';
  }, [colorBy, isDark, themeColors]);

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

  // ── Canvas Sizing ──
  // Allocate/resize the backing stores ONLY when dims or dpr change.
  // Doing this in the draw path would clear+reallocate every frame.
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
  useEffect(() => {
    for (const c of [canvasRef.current, overlayRef.current]) {
      if (!c) continue;
      c.width = dims.width * dpr;
      c.height = dims.height * dpr;
    }
  }, [dims, dpr]);

  // ── Base Layer Rendering (nodes + edges + labels + stats) ──
  // The expensive O(N+E) pass. Redraw only when content-affecting inputs change.
  // NOT keyed on hover — hover is drawn on the overlay canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || positionedNodes.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset transform + clear (no width/height reassignment — backing store
    // is sized by the sizing effect above).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, dims.width, dims.height);

    // Background
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
    const edgeColors = getEdgeColors();
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
        ctx.strokeStyle = edgeColors[e.type] || 'rgba(108,140,255,0.08)';
        ctx.lineWidth = 0.5 * invZoom;
        ctx.stroke();
      }
    }

    // Draw nodes (with viewport culling) — two passes: nodes then labels
    const nodeRadius = Math.max(1.5, 3 * invZoom);
    const showLabels = camera.zoom > 4;
    const labelBg = isDark ? 'rgba(6,8,15,0.75)' : 'rgba(255,255,255,0.8)';

    // Collect visible nodes for label pass
    const labelNodes: Array<{ n: PositionedNode; r: number }> = [];

    // Pass 1: Draw all node dots. Search highlight rings are part of the static
    // base layer; hover/selection emphasis is drawn on the overlay canvas.
    for (const n of positionedNodes) {
      if (n.px < vpLeft - vpPad || n.px > vpRight + vpPad || n.py < vpTop - vpPad || n.py > vpBottom + vpPad) continue;

      const color = getNodeColor(n);
      const isSearch = searchMatches?.has(n.id);

      // Dim non-matching nodes during search
      if (searchMatches && !isSearch) {
        ctx.globalAlpha = 0.08;
      }

      const r = Math.max(nodeRadius, Math.log2((n.account_total || 1) + 1) * nodeRadius * 0.6);

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

      // Redundant color-blind-safe status cue (P3.4): error nodes get a ring
      // outline on top of the fill, so done/error read without relying on hue.
      drawStatusMarker(ctx, n.px, n.py, r, n.crawl_status, themeColors.canvasText, invZoom);

      ctx.globalAlpha = 1;

      // Collect for label pass (labels for the always-visible-at-zoom case;
      // hover/selected labels are added by the overlay layer).
      if (showLabels) {
        labelNodes.push({ n, r });
      }
    }

    // Pass 2: Draw labels on top of all nodes with background pill
    if (labelNodes.length > 0) {
      const fontSize = Math.max(3, 10 * invZoom);
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (const { n, r } of labelNodes) {
        const label = shortLabel(n.id);
        const labelY = n.py + r + 4 * invZoom;
        const metrics = ctx.measureText(label);
        const padX = 3 * invZoom;
        const padY = 1.5 * invZoom;

        // Background pill
        ctx.fillStyle = labelBg;
        ctx.beginPath();
        const bx = n.px - metrics.width / 2 - padX;
        const by = labelY - padY;
        const bw = metrics.width + padX * 2;
        const bh = fontSize + padY * 2;
        const br = 2 * invZoom;
        ctx.roundRect(bx, by, bw, bh, br);
        ctx.fill();

        // Text
        ctx.fillStyle = themeColors.canvasText;
        ctx.fillText(label, n.px, labelY);
      }
    }

    ctx.restore();

    // Stats overlay
    ctx.font = '11px Inter, sans-serif';
    ctx.fillStyle = themeColors.canvasTextDim;
    ctx.textAlign = 'left';
    ctx.fillText(`${positionedNodes.length.toLocaleString()} nodes  |  Zoom: ${camera.zoom.toFixed(1)}x`, 12, dims.height - 12);

  }, [positionedNodes, filteredEdges, camera, dims, dpr, isDark, themeColors, getNodeColor, searchMatches, nodeById]);

  // ── Overlay Layer Rendering (hover ring + selected emphasis + hover label) ──
  // Cheap: a handful of shapes for at most two nodes. Redraws on hover/selection
  // (and whenever the camera/dims/theme change so the overlay stays aligned).
  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, dims.width, dims.height);

    if (!hovered && !selected) return;

    ctx.save();
    ctx.translate(camera.x, camera.y);
    ctx.scale(camera.zoom, camera.zoom);

    const invZoom = 1 / camera.zoom;
    const nodeRadius = Math.max(1.5, 3 * invZoom);
    const radiusOf = (n: PositionedNode) =>
      Math.max(nodeRadius, Math.log2((n.account_total || 1) + 1) * nodeRadius * 0.6);

    // Selected emphasis ring
    if (selected) {
      const n = nodeById.get(selected.id) || selected;
      const r = radiusOf(n);
      ctx.beginPath();
      ctx.arc(n.px, n.py, r + 4 * invZoom, 0, 2 * Math.PI);
      ctx.strokeStyle = '#6c8cff';
      ctx.lineWidth = 1.5 * invZoom;
      ctx.stroke();
    }

    // Hover highlight ring. In the original single-pass draw this was a filled
    // `color+'44'` circle (radius r+3) painted BEHIND the opaque node dot, so
    // only the annular ring beyond the dot was visible. Since the overlay sits
    // on TOP of the base dot, draw it as a donut (even-odd fill punching out the
    // inner dot radius) to reproduce the exact same visible ring.
    if (hovered) {
      const n = nodeById.get(hovered.id) || hovered;
      const r = radiusOf(n);
      const color = getNodeColor(n);
      ctx.beginPath();
      ctx.arc(n.px, n.py, r + 3 * invZoom, 0, 2 * Math.PI);
      ctx.arc(n.px, n.py, r, 0, 2 * Math.PI);
      ctx.fillStyle = color + '44';
      ctx.fill('evenodd');
    }

    // Labels for hovered/selected nodes (matches prior behavior where hover/
    // selected nodes always got a label pill regardless of zoom).
    const labelTargets: PositionedNode[] = [];
    if (selected) labelTargets.push(nodeById.get(selected.id) || selected);
    if (hovered && hovered.id !== selected?.id) labelTargets.push(nodeById.get(hovered.id) || hovered);

    if (labelTargets.length > 0) {
      const fontSize = Math.max(3, 10 * invZoom);
      const labelBg = isDark ? 'rgba(6,8,15,0.75)' : 'rgba(255,255,255,0.8)';
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      for (const n of labelTargets) {
        const r = radiusOf(n);
        const label = shortLabel(n.id);
        const labelY = n.py + r + 4 * invZoom;
        const metrics = ctx.measureText(label);
        const padX = 3 * invZoom;
        const padY = 1.5 * invZoom;

        ctx.fillStyle = labelBg;
        ctx.beginPath();
        const bx = n.px - metrics.width / 2 - padX;
        const by = labelY - padY;
        const bw = metrics.width + padX * 2;
        const bh = fontSize + padY * 2;
        const br = 2 * invZoom;
        ctx.roundRect(bx, by, bw, bh, br);
        ctx.fill();

        ctx.fillStyle = themeColors.canvasText;
        ctx.fillText(label, n.px, labelY);
      }
    }

    ctx.restore();
  }, [hovered, selected, camera, dims, dpr, isDark, themeColors, getNodeColor, nodeById]);

  // ── Hit testing ──
  // Queries only the spatial-grid buckets overlapping the cursor's hit radius
  // instead of scanning every node. Same node picked as the old linear scan.
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

    const { cellSize, buckets } = spatialGrid;
    // Cells spanned by the hit radius around the cursor.
    const minCx = Math.floor((wx - hitR) / cellSize);
    const maxCx = Math.floor((wx + hitR) / cellSize);
    const minCy = Math.floor((wy - hitR) / cellSize);
    const maxCy = Math.floor((wy + hitR) / cellSize);

    let closest: PositionedNode | null = null;
    let closestDist = hitR * hitR;
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = buckets.get(gridKey(cx, cy));
        if (!bucket) continue;
        for (const n of bucket) {
          const dx = n.px - wx;
          const dy = n.py - wy;
          const d2 = dx * dx + dy * dy;
          if (d2 < closestDist) {
            closestDist = d2;
            closest = n;
          }
        }
      }
    }
    return closest;
  }, [camera, spatialGrid]);

  // Keep hovered-id mirror in sync for the rAF guard.
  useEffect(() => { hoveredIdRef.current = hovered?.id ?? null; }, [hovered]);

  // ── Mouse Handlers ──
  // Pointer move is rAF-coalesced: store the latest event and flush at most once
  // per frame. The flush either pans the camera (during drag) or hit-tests for
  // hover, skipping setHovered when the hovered node id is unchanged.
  const flushMove = useCallback(() => {
    rafRef.current = null;
    const ev = pendingMoveRef.current;
    pendingMoveRef.current = null;
    if (!ev) return;

    const drag = dragRef.current;
    if (drag) {
      const dx = ev.clientX - drag.startX;
      const dy = ev.clientY - drag.startY;
      setCamera(c => ({ ...c, x: drag.camX + dx, y: drag.camY + dy }));
      return;
    }

    const next = hitTest(ev.clientX, ev.clientY);
    // Track container-relative cursor position so the tooltip can follow the
    // pointer (P3.5). Update whenever there is a hover target.
    if (next) {
      const el = containerRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        setCursorPos({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      }
    }
    if ((next?.id ?? null) === hoveredIdRef.current) return; // no change, skip
    setHovered(next);
  }, [hitTest]);

  const scheduleMove = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flushMove);
  }, [flushMove]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    pendingMoveRef.current = { clientX: e.clientX, clientY: e.clientY };
    scheduleMove();
  }, [scheduleMove]);

  // Cancel any pending rAF on unmount.
  useEffect(() => () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

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

  // Attach wheel handler as non-passive so preventDefault works
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setCamera(c => {
        const newZoom = Math.max(0.1, Math.min(50, c.zoom * factor));
        const ratio = newZoom / c.zoom;
        return { zoom: newZoom, x: mx - (mx - c.x) * ratio, y: my - (my - c.y) * ratio };
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [topology]);

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

  // ── A11y: keyboard controls on the focused canvas region (P2.7) ──
  // Arrow keys pan the camera, +/-/= zoom around the viewport center, Escape
  // clears selection / closes the flyout. Drives the same camera state used by
  // mouse drag/wheel so behavior stays consistent.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const panStep = 60;
    const zoomFactor = 1.15;
    const zoomAt = (factor: number) => {
      const cx = dims.width / 2;
      const cy = dims.height / 2;
      setCamera(c => {
        const newZoom = Math.max(0.1, Math.min(50, c.zoom * factor));
        const ratio = newZoom / c.zoom;
        return { zoom: newZoom, x: cx - (cx - c.x) * ratio, y: cy - (cy - c.y) * ratio };
      });
    };
    switch (e.key) {
      case 'ArrowUp':    e.preventDefault(); setCamera(c => ({ ...c, y: c.y + panStep })); break;
      case 'ArrowDown':  e.preventDefault(); setCamera(c => ({ ...c, y: c.y - panStep })); break;
      case 'ArrowLeft':  e.preventDefault(); setCamera(c => ({ ...c, x: c.x + panStep })); break;
      case 'ArrowRight': e.preventDefault(); setCamera(c => ({ ...c, x: c.x - panStep })); break;
      case '+':
      case '=':          e.preventDefault(); zoomAt(zoomFactor); break;
      case '-':
      case '_':          e.preventDefault(); zoomAt(1 / zoomFactor); break;
      case 'Escape':
        e.preventDefault();
        setFlyoutOpen(false);
        setSelected(null);
        setHovered(null);
        break;
      default:
        break;
    }
  }, [dims]);

  // ── A11y: live-region announcement for hovered/selected node (P2.7) ──
  const activeNode = hovered ?? selected;
  const liveAnnouncement = activeNode
    ? `${shortLabel(activeNode.id)}. ${activeNode.parent_url ? 'Sub-ADI' : 'Root ADI'}. ` +
      `Status ${activeNode.crawl_status}. ${activeNode.account_total} accounts, ` +
      `${activeNode.token_count} token, ${activeNode.data_count} data, ` +
      `${activeNode.book_count} key books, ${activeNode.entry_count} entries.`
    : '';

  // Region label summarizing the graph for screen readers.
  const regionLabel =
    `Network topology graph. ${positionedNodes.length.toLocaleString()} nodes, ` +
    `${filteredEdges.length.toLocaleString()} visible edges. ` +
    `Use arrow keys to pan, plus and minus to zoom, Escape to clear selection.`;

  /* ── Landing / Loading / Error State ─────────── */

  if (!loadRequested) {
    return (
      <div className="network-graph-fullscreen" ref={containerRef}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100%', flexDirection: 'column', gap: 20,
        }}>
          {/* Decorative pulsing rings */}
          <div style={{ position: 'relative', width: 140, height: 140 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '2px solid var(--color-adi)', opacity: 0.15,
              animation: 'breathe 3s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 16, borderRadius: '50%',
              border: '2px solid var(--color-adi)', opacity: 0.25,
              animation: 'breathe 3s ease-in-out infinite 0.4s',
            }} />
            <div style={{
              position: 'absolute', inset: 32, borderRadius: '50%',
              border: '2px solid var(--color-adi)', opacity: 0.35,
              animation: 'breathe 3s ease-in-out infinite 0.8s',
            }} />
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--color-adi)" strokeWidth="1.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="2" fill="var(--color-adi)" />
                <circle cx="6" cy="6" r="1.5" fill="var(--color-token)" />
                <circle cx="18" cy="6" r="1.5" fill="var(--color-data)" />
                <circle cx="12" cy="19" r="1.5" fill="var(--color-key)" />
                <line x1="12" y1="12" x2="6" y2="6" />
                <line x1="12" y1="12" x2="18" y2="6" />
                <line x1="12" y1="12" x2="12" y2="19" />
              </svg>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
              Network Topology
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', maxWidth: 340, lineHeight: 1.6 }}>
              Each dot is an on-chain identity (ADI). Lines show how identities relate — hierarchy, who can authorize whom, shared signing keys, and delegated power. Node size = number of accounts.
            </div>
          </div>
          <button
            onClick={() => setLoadRequested(true)}
            style={{
              background: 'var(--color-adi)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '12px 32px', fontSize: 14, fontWeight: 600,
              cursor: 'pointer', letterSpacing: '0.02em',
              transition: 'transform 0.15s, box-shadow 0.15s',
              boxShadow: '0 4px 20px rgba(108,140,255,0.25)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
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
            onClick={() => { setLoadError(''); setTopology(null); setLoadRequested(false); setTimeout(() => setLoadRequested(true), 0); }}
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
          height: '100%', flexDirection: 'column', gap: 20,
        }}>
          {/* Spinning loader */}
          <div style={{ position: 'relative', width: 80, height: 80 }}>
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '3px solid var(--border-subtle)',
            }} />
            <div style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '3px solid transparent', borderTopColor: 'var(--color-adi)',
              animation: 'spinSlow 1s linear infinite',
            }} />
            <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-adi)" strokeWidth="1.5" strokeLinecap="round" style={{ animation: 'breathe 2s ease-in-out infinite' }}>
                <circle cx="12" cy="12" r="2" fill="var(--color-adi)" />
                <circle cx="6" cy="6" r="1.5" fill="var(--color-token)" />
                <circle cx="18" cy="6" r="1.5" fill="var(--color-data)" />
                <line x1="12" y1="12" x2="6" y2="6" />
                <line x1="12" y1="12" x2="18" y2="6" />
              </svg>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
              {loadStatus || 'Loading topology...'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Building the network in a background thread
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Render ────────────────────────────────────── */

  return (
    <div className="network-graph-fullscreen" ref={containerRef}>

      {/* ── Main Canvas ── */}
      {/* Focusable interactive region (P2.7): keyboard pan/zoom + screen-reader
          label summarizing node/edge counts. */}
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-label={regionLabel}
        style={{ display: 'block', width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'grab' }}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseMove={handleMouseMove}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => {
          dragRef.current = null;
          pendingMoveRef.current = null;
          if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
          setHovered(null);
          setCursorPos(null);
        }}
      />

      {/* ── A11y: live region announcing hovered/selected node ── */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>

      {/* ── Overlay Canvas (hover/selection emphasis) ── */}
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
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
          <div className="net-control-label">
            Color by
            <InfoTip
              label="Color modes"
              definition="Status = crawl result; Account Count = number of accounts; Depth = root vs sub-identity; Key Reuse Risk = how many other identities share a signing key with this one (0 = none)."
            />
          </div>
          <select
            value={colorBy}
            onChange={e => setColorBy(e.target.value)}
            className="net-select"
          >
            {COLOR_BY_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Display Filters */}
        <div className="net-control-group">
          <div className="net-control-label">Display</div>
          {EDGE_LEGEND_ITEMS.map(({ type, label }) => (
            <label key={type} className="net-checkbox-label">
              <input
                type="checkbox"
                checked={edgeFilters[type]}
                onChange={e => setEdgeFilters(f => ({ ...f, [type]: e.target.checked }))}
              />
              <span className="net-checkbox-dot" style={{ background: getEdgeLegendColor(type) }} />
              {label}
            </label>
          ))}
          <label className="net-checkbox-label" style={{ marginTop: 4 }}>
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={e => setHideEmpty(e.target.checked)}
            />
            <span className="net-checkbox-dot" style={{ background: 'var(--text-tertiary)' }} />
            Hide empty/reserved ADIs
          </label>
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
        {/* Mode-aware color scale for the active "Color by" mode (P-C6). Shows
            the same buckets/bands the node painter uses, so the legend always
            explains the current coloring. */}
        {(() => {
          const legend = colorLegendItems(colorBy);
          if (!legend) return null;
          return (
            <div className="net-legend-section net-legend-colorby">
              <span className="net-legend-colorby-title">{legend.title}</span>
              {legend.items.map(item => (
                <span key={item.label} className="net-legend-item">
                  <span
                    className="net-legend-swatch"
                    style={{ background: colorLegendItemColor(item, themeColors.canvasTextMuted) }}
                  />
                  {item.label}
                </span>
              ))}
            </div>
          );
        })()}

        <div className="net-legend-section"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 6 }}>
          {EDGE_LEGEND_ITEMS.map(l => (
            <span key={l.label} className="net-legend-item">
              <svg width="16" height="2">
                <line x1="0" y1="1" x2="16" y2="1" stroke={getEdgeLegendColor(l.type)} strokeWidth="2"
                  strokeDasharray={l.dash ? '3,2' : undefined} />
              </svg>
              {l.label}
              {l.term && <InfoTip term={l.term} />}
            </span>
          ))}
        </div>

        <div className="net-legend-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 6 }}>
          {NODE_SHAPE_LEGEND_ITEMS.map(item => (
            <span key={item.label} className="net-legend-item">
              <svg width="8" height="8">
                {item.shape === 'circle'
                  ? <circle cx="4" cy="4" r="3" fill={getEntityColor(item.entity).color} />
                  : <polygon points="4,0 8,4 4,8 0,4" fill={getEntityColor(item.entity).color} />}
              </svg>
              {item.label}
              {item.shape === 'diamond' && <InfoTip term="sub-adi" />}
            </span>
          ))}
          <span className="net-legend-item" style={{ color: 'var(--text-tertiary)' }}>
            ◆ = sub-identity · ● = root identity · size = account count
          </span>
        </div>

        {/* Color-blind-safe status markers (P3.4): error nodes are ringed so
            done/error read without relying on red/green hue alone. */}
        <div className="net-legend-section" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, marginTop: 6 }}>
          {STATUS_MARKER_LEGEND_ITEMS.map(item => (
            <span key={item.label} className="net-legend-item">
              <svg width="12" height="12">
                <circle cx="6" cy="6" r="3" fill={getEntityColor(item.entity).color} />
                {item.marker === 'ring' && (
                  <circle cx="6" cy="6" r="5" fill="none" stroke={themeColors.canvasText} strokeWidth="1.2" />
                )}
              </svg>
              {item.label}
            </span>
          ))}
          <span className="net-legend-item" style={{ color: 'var(--text-tertiary)' }}>
            Node size = key reuse / account volume
          </span>
        </div>
      </div>

      {/* ── Hover Tooltip ── */}
      {/* Cursor-anchored (P3.5): positioned near the pointer with an offset and
          clamped to the container so it never overflows the viewport. Keeps the
          existing `net-tooltip` styling and flyout-suppression behavior. */}
      <AnimatePresence>
        {hovered && !flyoutOpen && (
          <motion.div
            className="net-tooltip"
            style={(() => {
              // On narrow (mobile) widths defer to the CSS top-center layout
              // (the max-width:768px media query), so don't set inline coords.
              if (dims.width <= 768 || !cursorPos) return undefined;
              const offset = 16;
              const tipW = 220;
              const tipH = 150;
              const cx = cursorPos.x;
              const cy = cursorPos.y;
              // Flip to the left/up if the tooltip would overflow the container.
              const left = cx + offset + tipW > dims.width ? cx - offset - tipW : cx + offset;
              const top = cy + offset + tipH > dims.height ? cy - offset - tipH : cy + offset;
              return {
                position: 'absolute' as const,
                left: Math.max(8, Math.min(left, dims.width - tipW - 8)),
                top: Math.max(8, Math.min(top, dims.height - 8)),
                right: 'auto' as const,
                bottom: 'auto' as const,
                pointerEvents: 'none' as const,
              };
            })()}
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
                  <button
                    type="button"
                    className="net-flyout-link"
                    aria-label={`Select parent ${shortLabel(selected.parent_url)}`}
                    onClick={() => {
                      const parent = nodeById.get(selected.parent_url!);
                      if (parent) setSelected(parent);
                    }}
                  >{shortLabel(selected.parent_url)}</button>
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
                        <button
                          type="button"
                          key={t}
                          className="net-flyout-conn-tag"
                          aria-label={`Select connected node ${shortLabel(t)}`}
                          onClick={() => {
                            const node = nodeById.get(t);
                            if (node) {
                              setSelected(node);
                              setCamera({ x: dims.width / 2 - node.px * 3, y: dims.height / 2 - node.py * 3, zoom: 3 });
                            }
                          }}
                        >
                          {shortLabel(t).slice(0, 20)}
                        </button>
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
