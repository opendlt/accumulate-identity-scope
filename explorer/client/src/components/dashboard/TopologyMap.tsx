import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeColors } from '../../hooks/useThemeColors';
import { getEntityColor } from '../../hooks/useEntityColor';
import { InfoTip } from '../ui/InfoTip';
import {
  getEdgeColors,
  getEdgeLegendColor,
  shortLabel,
  EDGE_DASH,
  EDGE_LEGEND_ITEMS,
  NODE_SHAPE_LEGEND_ITEMS,
  STATUS_MARKER_LEGEND_ITEMS,
  drawStatusMarker,
  nodeHasContent,
  isEdgeVisible,
  EDGE_FALLBACK_STROKE,
  accountCountColor,
  riskColor,
  colorLegendItems,
  colorLegendItemColor,
} from '../graph/graphShared';
import type { TopologyData, TopologyNode } from '../../types';

interface Props {
  data: TopologyData;
  edgeFilters: Record<string, boolean>;
  colorBy: string;
  hideEmpty?: boolean;
}

export function TopologyMap({ data, edgeFilters, colorBy, hideEmpty = true }: Props) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<TopologyNode | null>(null);
  // Mirror of `hovered` read by paint callbacks so they don't have to depend on
  // hover state (which would force graphData/sim invalidation). Tooltip uses state.
  const hoveredRef = useRef<TopologyNode | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 420 });
  // Container-relative cursor position used to anchor the hover tooltip near the
  // pointer (P3.5), replacing the previously fixed top-right corner.
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  const handleHover = useCallback((node: any) => {
    const n = node as TopologyNode | null;
    hoveredRef.current = n;
    setHovered(n);
    // Re-render the canvas so hover styling updates even though the sim is idle.
    fgRef.current?.refresh?.();
  }, []);
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

  // Measure container with ResizeObserver (most reliable)
  useEffect(() => {
    function measure() {
      const el = containerRef.current;
      if (el) {
        const w = el.clientWidth || el.offsetWidth || el.getBoundingClientRect().width;
        if (w > 0) {
          setDims({ width: Math.round(w), height: 420 });
          return;
        }
      }
      setDims({ width: Math.max(400, window.innerWidth - 200), height: 420 });
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

  // stabilize after initial layout
  useEffect(() => {
    const fg = fgRef.current;
    if (fg) {
      const nodeCount = data.nodes.length;
      const charge = nodeCount > 10000 ? -12 : nodeCount > 3000 ? -20 : -30;
      fg.d3Force('charge')?.strength(charge);
      fg.d3Force('link')?.distance(nodeCount > 10000 ? 20 : 40);
    }
  }, [data]);

  // Build the graph ONLY when the inputs that genuinely change the graph change.
  // Crucially this does NOT depend on `hovered` — hover styling is applied in the
  // paint callbacks via hoveredRef, so hovering never produces a new graphData
  // reference and never restarts the force simulation.
  //
  // We also do NOT spread/clone the node/link objects: react-force-graph mutates
  // them with x/y/vx/vy, so passing stable references lets positions persist
  // across re-renders. The working objects are created once here and only
  // recreated when these deps change.
  const graphData = useMemo(() => {
    // Filter nodes based on controls
    const anyEdgeEnabled = Object.values(edgeFilters).some(v => v);
    let visibleNodes = anyEdgeEnabled ? data.nodes : data.nodes.filter(n => !n.parent_url);
    if (hideEmpty) {
      visibleNodes = visibleNodes.filter(nodeHasContent);
    }
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    const filteredEdges = data.edges.filter(e => isEdgeVisible(e, edgeFilters, visibleNodeIds));

    return {
      // Create the working node objects once (copy off the react-query cache so the
      // sim can mutate x/y safely), but keep them stable across renders within this memo.
      nodes: visibleNodes.map(n => ({ ...n })),
      links: filteredEdges.map(e => ({ ...e })),
    };
  }, [data, edgeFilters, hideEmpty]);

  const getNodeColor = useCallback((node: any) => {
    const n = node as TopologyNode;
    if (colorBy === 'status') {
      return n.crawl_status === 'done' ? '#22c55e' : '#ef4444';
    }
    if (colorBy === 'accounts') {
      // Shared account-count buckets so this minimap matches the full
      // NetworkGraph exactly (P-C6): 0 → muted, 1–4 / 5–19 / 20–49 / 50+.
      return accountCountColor(n.account_total, themeColors.canvasTextMuted);
    }
    if (colorBy === 'depth') {
      return n.parent_url ? '#a78bfa' : '#6c8cff';
    }
    if (colorBy === 'risk') {
      // Real key-reuse signal (P-C3): color by shared_key_count.
      // 0 → safe, 1–4 → moderate, ≥5 → high.
      return riskColor(n.shared_key_count);
    }
    return '#6c8cff';
  }, [colorBy, themeColors]);

  const getNodeSize = useCallback((node: any) => {
    const n = node as TopologyNode;
    return Math.max(2, Math.log2((n.account_total || 1) + 1) * 2);
  }, []);

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as TopologyNode & { x: number; y: number };
    const size = getNodeSize(n);
    const color = getNodeColor(n);
    const isHovered = hoveredRef.current?.id === n.id;

    // Glow
    if (isHovered) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, size + 4, 0, 2 * Math.PI);
      ctx.fillStyle = color + '33';
      ctx.fill();
    }

    // Node
    ctx.beginPath();
    if (n.parent_url) {
      // diamond for sub-ADIs
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

    // Redundant color-blind-safe status cue (P3.4): error nodes get a ring
    // outline so done/error read without relying on the red/green hue alone.
    drawStatusMarker(ctx, n.x, n.y, size, n.crawl_status, themeColors.canvasText, 1);

    // Label on zoom
    if (globalScale > 2.5 || isHovered) {
      const label = shortLabel(n.id);
      ctx.font = `${Math.max(3, 10 / globalScale)}px Inter, sans-serif`;
      ctx.fillStyle = themeColors.canvasText;
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, n.y + size + 8 / globalScale);
    }
  }, [getNodeColor, getNodeSize, themeColors]);

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const s = link.source;
    const t = link.target;
    if (s?.x == null || t?.x == null || s?.y == null || t?.y == null) return;
    const edgeType = link.type as string;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    // Theme-aware edge colors resolved from the shared (CSS-var-backed) source.
    ctx.strokeStyle = getEdgeColors()[edgeType] || EDGE_FALLBACK_STROKE;
    ctx.lineWidth = edgeType === 'hierarchy' ? 0.5 : 0.8;
    const dash = EDGE_DASH[edgeType];
    if (dash) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  // ── A11y: keyboard controls on the focused graph region (P2.7) ──
  // +/-/= zoom via the ForceGraph imperative zoom API; arrow keys pan by nudging
  // the current center. Escape blurs the region.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const fg = fgRef.current;
    if (!fg) return;
    const zoomFactor = 1.2;
    const curZoom = typeof fg.zoom === 'function' ? fg.zoom() : 1;
    // Pan step in world units scales inversely with zoom so it feels constant.
    const panStep = 40 / (curZoom || 1);
    switch (e.key) {
      case '+':
      case '=':
        e.preventDefault();
        fg.zoom(Math.min(12, curZoom * zoomFactor), 200);
        break;
      case '-':
      case '_':
        e.preventDefault();
        fg.zoom(Math.max(0.3, curZoom / zoomFactor), 200);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        // react-force-graph exposes centerAt(x, y) and screen2GraphCoords; pan by
        // shifting the current graph-space center.
        const c = fg.centerAt ? { x: fg.centerAt().x ?? 0, y: fg.centerAt().y ?? 0 } : null;
        if (!c) break;
        let { x, y } = c;
        if (e.key === 'ArrowUp') y -= panStep;
        else if (e.key === 'ArrowDown') y += panStep;
        else if (e.key === 'ArrowLeft') x -= panStep;
        else if (e.key === 'ArrowRight') x += panStep;
        fg.centerAt(x, y, 150);
        break;
      }
      case 'Escape':
        e.preventDefault();
        hoveredRef.current = null;
        setHovered(null);
        (e.currentTarget as HTMLElement).blur();
        break;
      default:
        break;
    }
  }, []);

  // ── A11y: live-region announcement + region label ──
  const liveAnnouncement = hovered
    ? `${shortLabel(hovered.id)}. Status ${hovered.crawl_status}. ` +
      `${hovered.token_count} token accounts, ${hovered.data_count} data accounts, ` +
      `${hovered.book_count} key books, ${hovered.entry_count} entries.`
    : '';
  const regionLabel =
    `Network topology force graph. ${graphData.nodes.length.toLocaleString()} nodes, ` +
    `${graphData.links.length.toLocaleString()} edges. ` +
    `Use plus and minus to zoom, arrow keys to pan.`;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="application"
      aria-label={regionLabel}
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setCursorPos(null)}
      style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}
    >
      {/* A11y: live region announcing the hovered node */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
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
        onNodeHover={handleHover}
        onNodeClick={(node: any) => {
          navigate(`/tree?select=${encodeURIComponent(node.id)}`);
        }}
        warmupTicks={60}
        cooldownTicks={50}
        d3AlphaDecay={0.04}
        d3VelocityDecay={0.4}
        enableZoomInteraction={true}
        enablePanInteraction={true}
        minZoom={0.3}
        maxZoom={12}
      />

      {/* Tooltip — cursor-anchored (P3.5): follows the pointer with an offset,
          clamped to the container; falls back to the top-right corner until the
          first pointer-move resolves a position. */}
      {hovered && (() => {
        const offset = 16;
        const tipW = 220;
        const tipH = 130;
        let pos: React.CSSProperties;
        if (cursorPos) {
          const cx = cursorPos.x;
          const cy = cursorPos.y;
          const left = cx + offset + tipW > dims.width ? cx - offset - tipW : cx + offset;
          const top = cy + offset + tipH > dims.height ? cy - offset - tipH : cy + offset;
          pos = {
            left: Math.max(8, Math.min(left, dims.width - tipW - 8)),
            top: Math.max(8, Math.min(top, dims.height - 8)),
          };
        } else {
          pos = { top: 12, right: 12 };
        }
        return (
        <div style={{
          position: 'absolute', ...pos,
          background: isDark ? 'rgba(17,22,40,0.92)' : 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(108,140,255,0.15)', borderRadius: 10,
          padding: '10px 14px', minWidth: 200, pointerEvents: 'none',
          zIndex: 10,
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
            {hovered.id}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>Status: <span style={{ color: hovered.crawl_status === 'done' ? '#22c55e' : '#ef4444' }}>{hovered.crawl_status}</span></span>
            <span>Token accounts: <strong style={{ color: '#22d3ee' }}>{hovered.token_count}</strong></span>
            <span>Data accounts: <strong style={{ color: '#a78bfa' }}>{hovered.data_count}</strong></span>
            <span>Key books: <strong style={{ color: '#34d399' }}>{hovered.book_count}</strong></span>
            <span>Entries: <strong>{hovered.entry_count}</strong></span>
          </div>
        </div>
        );
      })()}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 10,
        background: isDark ? 'rgba(17,22,40,0.85)' : 'rgba(255,255,255,0.90)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(108,140,255,0.1)', borderRadius: 8,
        padding: '6px 10px', fontSize: 10, color: 'var(--text-secondary)',
        display: 'flex', flexWrap: 'wrap', gap: 12, zIndex: 10,
      }}>
        {/* Mode-aware color scale for the active "Color by" mode (P-C6) —
            renders the same buckets/bands the node painter uses, identical to
            the full NetworkGraph legend. */}
        {(() => {
          const legend = colorLegendItems(colorBy);
          if (!legend) return null;
          return (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{legend.title}</span>
              {legend.items.map(item => (
                <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: colorLegendItemColor(item, themeColors.canvasTextMuted),
                  }} />
                  {item.label}
                </span>
              ))}
              <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--border-subtle)' }} />
            </span>
          );
        })()}
        {EDGE_LEGEND_ITEMS.map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="16" height="2" style={{ verticalAlign: 'middle' }}>
              <line x1="0" y1="1" x2="16" y2="1" stroke={getEdgeLegendColor(l.type)} strokeWidth="2"
                strokeDasharray={l.dash ? '3,2' : undefined} />
            </svg>
            {l.label}
            {l.term && <InfoTip term={l.term} />}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="8" height="8"><circle cx="4" cy="4" r="3" fill={getEntityColor(NODE_SHAPE_LEGEND_ITEMS[0].entity).color} /></svg>
          Root
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="8" height="8"><polygon points="4,0 8,4 4,8 0,4" fill={getEntityColor(NODE_SHAPE_LEGEND_ITEMS[1].entity).color} /></svg>
          Sub-ADI
          <InfoTip term="sub-adi" />
        </span>
        {/* Color-blind-safe status markers (P3.4): error nodes are ringed. */}
        {STATUS_MARKER_LEGEND_ITEMS.map(item => (
          <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="12" height="12">
              <circle cx="6" cy="6" r="3" fill={getEntityColor(item.entity).color} />
              {item.marker === 'ring' && (
                <circle cx="6" cy="6" r="5" fill="none" stroke={themeColors.canvasText} strokeWidth="1.2" />
              )}
            </svg>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
