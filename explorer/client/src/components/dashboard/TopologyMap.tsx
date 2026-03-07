import { useRef, useCallback, useState, useEffect } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { getThemeColors } from '../../hooks/useThemeColors';
import type { TopologyData, TopologyNode } from '../../types';

const EDGE_COLORS: Record<string, string> = {
  hierarchy: 'rgba(108,140,255,0.12)',
  authority: 'rgba(245,158,11,0.18)',
  key_sharing: 'rgba(239,68,68,0.15)',
  delegation: 'rgba(52,211,153,0.20)',
};

const EDGE_DASH: Record<string, number[] | null> = {
  hierarchy: null,
  authority: [4, 3],
  key_sharing: [2, 2],
  delegation: [6, 3],
};

interface Props {
  data: TopologyData;
  edgeFilters: Record<string, boolean>;
  colorBy: string;
}

export function TopologyMap({ data, edgeFilters, colorBy }: Props) {
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<TopologyNode | null>(null);
  const [dims, setDims] = useState({ width: 800, height: 420 });
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const themeColors = getThemeColors(isDark);

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
    const raf = requestAnimationFrame(measure);
    const timer = setTimeout(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
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

  // Only show root ADIs by default — sub-ADIs overwhelm the preview
  const anyEdgeEnabled = Object.values(edgeFilters).some(v => v);
  const visibleNodes = anyEdgeEnabled ? data.nodes : data.nodes.filter(n => !n.parent_url);
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const filteredEdges = data.edges.filter(e =>
    edgeFilters[e.type] !== false &&
    visibleNodeIds.has(e.source) &&
    visibleNodeIds.has(e.target)
  );

  const graphData = {
    nodes: visibleNodes.map(n => ({ ...n })),
    links: filteredEdges.map(e => ({ ...e })),
  };

  const getNodeColor = useCallback((node: any) => {
    const n = node as TopologyNode;
    if (colorBy === 'status') {
      return n.crawl_status === 'done' ? '#22c55e' : '#ef4444';
    }
    if (colorBy === 'accounts') {
      const t = n.account_total;
      if (t === 0) return themeColors.canvasTextMuted;
      if (t < 5) return '#6c8cff';
      if (t < 20) return '#22d3ee';
      if (t < 50) return '#f59e0b';
      return '#ef4444';
    }
    if (colorBy === 'depth') {
      return n.parent_url ? '#a78bfa' : '#6c8cff';
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
    const isHovered = hovered?.id === n.id;

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

    // Label on zoom
    if (globalScale > 2.5 || isHovered) {
      const label = n.id.replace('acc://', '').replace('.acme', '');
      ctx.font = `${Math.max(3, 10 / globalScale)}px Inter, sans-serif`;
      ctx.fillStyle = themeColors.canvasText;
      ctx.textAlign = 'center';
      ctx.fillText(label, n.x, n.y + size + 8 / globalScale);
    }
  }, [getNodeColor, getNodeSize, hovered, isDark]);

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const s = link.source;
    const t = link.target;
    if (!s?.x || !t?.x) return;
    const edgeType = link.type as string;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.strokeStyle = EDGE_COLORS[edgeType] || 'rgba(108,140,255,0.08)';
    ctx.lineWidth = edgeType === 'hierarchy' ? 0.5 : 0.8;
    const dash = EDGE_DASH[edgeType];
    if (dash) ctx.setLineDash(dash);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
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

      {/* Tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 12, right: 12,
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
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 10, left: 10,
        background: isDark ? 'rgba(17,22,40,0.85)' : 'rgba(255,255,255,0.90)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(108,140,255,0.1)', borderRadius: 8,
        padding: '6px 10px', fontSize: 10, color: 'var(--text-secondary)',
        display: 'flex', gap: 12, zIndex: 10,
      }}>
        {[
          { label: 'Parent-child', color: '#6c8cff', dash: false },
          { label: 'Authority', color: '#f59e0b', dash: true },
          { label: 'Key sharing', color: '#ef4444', dash: true },
          { label: 'Delegation', color: '#34d399', dash: true },
        ].map(l => (
          <span key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <svg width="16" height="2" style={{ verticalAlign: 'middle' }}>
              <line x1="0" y1="1" x2="16" y2="1" stroke={l.color} strokeWidth="2"
                strokeDasharray={l.dash ? '3,2' : undefined} />
            </svg>
            {l.label}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="8" height="8"><circle cx="4" cy="4" r="3" fill="#6c8cff" /></svg>
          Root
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width="8" height="8"><polygon points="4,0 8,4 4,8 0,4" fill="#a78bfa" /></svg>
          Sub-ADI
        </span>
      </div>
    </div>
  );
}
