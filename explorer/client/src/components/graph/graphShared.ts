/**
 * Shared graph utilities (P2.13)
 *
 * Single source of truth for the visual + data-filtering primitives used by
 * both the canvas-based NetworkGraph and the react-force-graph TopologyMap.
 * Previously these were duplicated (with small Phase-0 divergences) in each
 * component; they are reconciled here toward one consistent definition.
 *
 * Colors are sourced from the theme-aware design tokens via `getEntityColor`
 * (which reads the CSS custom properties), so there is ONE color source that
 * stays in sync with the light/dark themes. Edge stroke colors are derived
 * from those entity colors at fixed alphas (the alpha is the only thing that
 * was ever component-specific, and it is reconciled below).
 */

import { getEntityColor } from '../../hooks/useEntityColor';
import type { TopologyNode, TopologyEdge } from '../../types';

/* ── Edge types ─────────────────────────────────── */

export type EdgeType = 'hierarchy' | 'authority' | 'key_sharing' | 'delegation';

export const EDGE_TYPES: EdgeType[] = ['hierarchy', 'authority', 'key_sharing', 'delegation'];

/**
 * Which entity-color token each edge type draws from, plus the stroke alpha.
 * Reconciles the two prior copies (NetworkGraph used key_sharing 0.16,
 * TopologyMap 0.15) toward a single value (0.16).
 */
const EDGE_STYLE: Record<EdgeType, { entity: string; alpha: number }> = {
  hierarchy:   { entity: 'adi',       alpha: 0.12 },
  authority:   { entity: 'authority', alpha: 0.18 },
  key_sharing: { entity: 'danger',    alpha: 0.16 },
  delegation:  { entity: 'key',       alpha: 0.20 },
};

/** Fallback edge stroke when an unknown edge type is encountered. */
export const EDGE_FALLBACK_STROKE = 'rgba(108,140,255,0.08)';

/**
 * Parse a hex / rgb(a) color into an `rgba()` string at the given alpha.
 * Entity tokens resolve to hex (or rgb) at runtime, so normalize both.
 */
function toRgba(color: string, alpha: number): string {
  const c = color.trim();
  if (c.startsWith('#')) {
    let hex = c.slice(1);
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(',').map(p => p.trim());
    const [r, g, b] = parts;
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return c;
}

/**
 * Theme-aware edge stroke color map. Call inside render/paint so it re-resolves
 * after a theme change. Keyed by edge type; values are `rgba()` strings.
 */
export function getEdgeColors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const type of EDGE_TYPES) {
    const { entity, alpha } = EDGE_STYLE[type];
    out[type] = toRgba(getEntityColor(entity).color, alpha);
  }
  return out;
}

/** The solid (full-alpha) legend/swatch color for an edge type. */
export function getEdgeLegendColor(type: EdgeType): string {
  return getEntityColor(EDGE_STYLE[type].entity).color;
}

/**
 * Dash pattern per edge type (canvas `setLineDash` form). `null` = solid.
 * Reconciled single definition (was only present in TopologyMap before).
 */
export const EDGE_DASH: Record<string, number[] | null> = {
  hierarchy: null,
  authority: [4, 3],
  key_sharing: [2, 2],
  delegation: [6, 3],
};

/* ── Label helpers ──────────────────────────────── */

/** Strip the `acc://` scheme and `.acme` suffix for compact display. */
export function shortLabel(url: string): string {
  return url.replace('acc://', '').replace('.acme', '');
}

/* ── Color-by options ───────────────────────────── */

export interface ColorByOption {
  value: string;
  label: string;
}

/**
 * The full reconciled set of color-by modes. NetworkGraph previously exposed
 * status/accounts/depth/risk; TopologyMap exposed status/accounts/depth. The
 * union is defined here; each component can render whichever subset it supports
 * (TopologyMap's getNodeColor falls through to the default for 'risk').
 */
export const COLOR_BY_OPTIONS: ColorByOption[] = [
  { value: 'status', label: 'Status' },
  { value: 'accounts', label: 'Account Count' },
  { value: 'depth', label: 'Depth (Root/Sub)' },
  { value: 'risk', label: 'Key Reuse Risk' },
];

/* ── Account-count color buckets (shared, P-C6) ──────────────────── */

/**
 * Shared Account-Count color scale used by BOTH graphs so the minimap
 * (TopologyMap) and the full graph (NetworkGraph) read identically. Previously
 * NetworkGraph used a continuous heat gradient while TopologyMap used hard
 * buckets — same mode name, two visual languages. Standardized onto these
 * four buckets (plus an "empty" bucket for nodes with zero accounts).
 *
 * Bands (inclusive low, exclusive high):
 *   0        → empty   (muted)
 *   1–4      → low      (blue / adi)
 *   5–19     → moderate (cyan)
 *   20–49    → high      (amber / warning)
 *   ≥50      → very high (red / danger)
 */
export interface AccountCountBucket {
  /** Inclusive lower bound of the bucket (account_total). */
  min: number;
  /** Short label for the legend. */
  label: string;
  /** Entity token whose color the bucket uses (theme-aware). */
  entity: string;
}

/**
 * Bucket definitions, highest-first so `accountCountColor` can pick the first
 * matching band with a simple scan. The "empty" (0) bucket is intentionally a
 * separate, muted swatch and is listed last.
 */
export const ACCOUNT_COUNT_BUCKETS: AccountCountBucket[] = [
  { min: 50, label: '50+',   entity: 'danger'    },
  { min: 20, label: '20–49', entity: 'authority' },
  { min: 5,  label: '5–19',  entity: 'token'     },
  { min: 1,  label: '1–4',   entity: 'adi'       },
  { min: 0,  label: '0',     entity: 'muted'     },
];

/**
 * Theme-aware fill color for a node's account total, resolved from the shared
 * buckets above. `muted` maps to the theme's muted canvas text color (there is
 * no `muted` entity token), everything else resolves via `getEntityColor`.
 */
export function accountCountColor(total: number, mutedColor: string): string {
  const t = total || 0;
  for (const b of ACCOUNT_COUNT_BUCKETS) {
    if (t >= b.min) {
      return b.entity === 'muted' ? mutedColor : getEntityColor(b.entity).color;
    }
  }
  return mutedColor;
}

/** Resolve a bucket's swatch color for the legend (theme-aware). */
export function accountBucketColor(bucket: AccountCountBucket, mutedColor: string): string {
  return bucket.entity === 'muted' ? mutedColor : getEntityColor(bucket.entity).color;
}

/* ── Key-reuse risk bands (shared, P-C3) ─────────────────────────── */

/**
 * Key-Reuse Risk color scale, driven by `TopologyNode.shared_key_count` — the
 * number of distinct OTHER ADIs a node shares a signing key with. This is the
 * real key-reuse signal; the old `risk` mode incorrectly colored by book_count
 * (how many key books a node owns), so an ADI sharing one key across 10
 * identities read as "safe".
 *
 * Bands (inclusive low, exclusive high):
 *   0    → none      (success / green)  — no shared keys
 *   1–4  → moderate  (warning / amber)  — shares with a few others
 *   ≥5   → high      (danger / red)     — shares with many others
 */
export interface RiskBand {
  /** Inclusive lower bound of the band (shared_key_count). */
  min: number;
  /** Short label for the legend. */
  label: string;
  /** Entity token whose color the band uses (theme-aware). */
  entity: string;
}

/** Highest-first so `riskColor` picks the first matching band. */
export const RISK_BANDS: RiskBand[] = [
  { min: 5, label: '5+ (high)',      entity: 'danger'    },
  { min: 1, label: '1–4 (moderate)', entity: 'authority' },
  { min: 0, label: '0 (none)',       entity: 'success'   },
];

/**
 * Theme-aware fill color for a node's key-reuse risk, from `shared_key_count`.
 * A missing/undefined count is treated as 0 (no known sharing → safe).
 */
export function riskColor(sharedKeyCount: number | undefined): string {
  const c = sharedKeyCount ?? 0;
  for (const b of RISK_BANDS) {
    if (c >= b.min) return getEntityColor(b.entity).color;
  }
  return getEntityColor('success').color;
}

/* ── Mode-aware color-by legend (P-C6) ───────────────────────────── */

/** A single swatch row in the mode-aware color legend. */
export interface ColorLegendItem {
  label: string;
  /** Entity token whose color the swatch uses, OR 'muted' for the theme muted color. */
  entity: string;
}

/**
 * Build the legend rows for the active color-by mode. Returns the swatch
 * label + entity for each band/bucket so callers can resolve theme-aware
 * colors at render time (entity 'muted' → caller's muted color). `null` means
 * the mode has no meaningful color scale (e.g. the default fallback).
 *
 * Kept here so NetworkGraph and TopologyMap render an identical legend for the
 * same mode (Account Count and Risk especially must match across the two).
 */
export function colorLegendItems(colorBy: string): { title: string; items: ColorLegendItem[] } | null {
  if (colorBy === 'status') {
    return {
      title: 'Crawl status',
      items: [
        { label: 'Done', entity: 'success' },
        { label: 'Error', entity: 'danger' },
      ],
    };
  }
  if (colorBy === 'accounts') {
    return {
      title: 'Account count',
      items: ACCOUNT_COUNT_BUCKETS.map(b => ({ label: b.label, entity: b.entity })),
    };
  }
  if (colorBy === 'depth') {
    return {
      title: 'Depth',
      items: [
        { label: 'Root ADI', entity: 'adi' },
        { label: 'Sub-ADI', entity: 'data' },
      ],
    };
  }
  if (colorBy === 'risk') {
    return {
      title: 'Key reuse',
      items: RISK_BANDS.map(b => ({ label: b.label, entity: b.entity })),
    };
  }
  return null;
}

/** Resolve a color-legend item's swatch color (theme-aware; 'muted' → mutedColor). */
export function colorLegendItemColor(item: ColorLegendItem, mutedColor: string): string {
  return item.entity === 'muted' ? mutedColor : getEntityColor(item.entity).color;
}

/* ── Legend items ───────────────────────────────── */

export interface EdgeLegendItem {
  type: EdgeType;
  label: string;
  /** Whether the legend swatch line is dashed. */
  dash: boolean;
  /** Glossary term id explaining this edge type (drives an InfoTip in the legend). */
  term?: string;
}

/**
 * Edge-type legend rows shared by both graphs. The swatch color should be read
 * via `getEdgeLegendColor(type)` at render time so it stays theme-aware. The
 * optional `term` links each edge type to its glossary definition (rendered as
 * an InfoTip beside the label).
 */
export const EDGE_LEGEND_ITEMS: EdgeLegendItem[] = [
  { type: 'hierarchy', label: 'Parent-child', dash: false, term: 'sub-adi' },
  { type: 'authority', label: 'Authority', dash: true, term: 'authority' },
  { type: 'key_sharing', label: 'Key sharing', dash: true, term: 'key-reuse' },
  { type: 'delegation', label: 'Delegation', dash: true, term: 'delegation' },
];

/* ── Node-shape legend (root vs sub-ADI) ────────── */

export interface NodeShapeLegendItem {
  shape: 'circle' | 'diamond';
  label: string;
  /** Entity token whose color the swatch uses. */
  entity: string;
}

export const NODE_SHAPE_LEGEND_ITEMS: NodeShapeLegendItem[] = [
  { shape: 'circle', label: 'Root ADI', entity: 'adi' },
  { shape: 'diamond', label: 'Sub-ADI', entity: 'data' },
];

/* ── Status markers (color-blind-safe redundant cue, P3.4) ──────── */

/**
 * Crawl-status → redundant SHAPE cue, so status reads without relying on the
 * red/green hue channel. `done` nodes stay plain filled (no marker); `error`
 * nodes get a ring outline drawn on top of the fill. Color remains the primary
 * channel — this is the redundant secondary channel for accessibility.
 */
export type StatusMarker = 'none' | 'ring';

/** Map a node's crawl_status to its redundant marker. */
export function statusMarker(crawlStatus: string): StatusMarker {
  return crawlStatus === 'error' ? 'ring' : 'none';
}

/**
 * Paint the redundant status marker for a node, in world/canvas space. Call
 * AFTER filling the node so the ring sits on top. `r` is the node's drawn
 * radius; `scale` lets callers compensate for zoom (world-unit line widths in
 * NetworkGraph pass `1 / camera.zoom`; TopologyMap passes 1). Uses a
 * theme-aware contrast stroke so the ring is visible on any fill color.
 *
 * Returns true if a marker was drawn (so callers can branch if needed).
 */
export function drawStatusMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  crawlStatus: string,
  strokeColor: string,
  scale = 1,
): boolean {
  if (statusMarker(crawlStatus) !== 'ring') return false;
  ctx.beginPath();
  ctx.arc(x, y, r + 2 * scale, 0, 2 * Math.PI);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1.4 * scale;
  ctx.stroke();
  return true;
}

export interface StatusMarkerLegendItem {
  marker: StatusMarker;
  label: string;
  /** Entity token whose color the swatch fill uses. */
  entity: string;
}

/**
 * Status-marker legend rows shared by both graphs. Documents the redundant
 * color-blind-safe shape cue: `done` = plain filled dot, `error` = ringed dot.
 */
export const STATUS_MARKER_LEGEND_ITEMS: StatusMarkerLegendItem[] = [
  { marker: 'none', label: 'Done', entity: 'success' },
  { marker: 'ring', label: 'Error (ringed)', entity: 'danger' },
];

/* ── Filter predicates ──────────────────────────── */

/** Default edge-type filter state. Hierarchy on, everything else off (P2.4). */
export function defaultEdgeFilters(): Record<EdgeType, boolean> {
  return {
    hierarchy: true,
    authority: false,
    key_sharing: false,
    delegation: false,
  };
}

/**
 * Whether a node has any "content" (used by the hide-empty/reserved-ADI toggle).
 * Shared so both graphs use identical emptiness semantics.
 */
export function nodeHasContent(n: TopologyNode): boolean {
  return (
    n.account_total > 0 ||
    n.token_count > 0 ||
    n.data_count > 0 ||
    n.book_count > 0 ||
    (n.entry_count ?? 0) > 0
  );
}

/**
 * Whether an edge should be drawn given the current filter state and the set of
 * visible node ids. An edge type must be explicitly enabled (truthy) AND both
 * endpoints must be visible. This unifies the two prior copies — NetworkGraph
 * required `=== true`; TopologyMap used `!== false` — onto a single
 * "explicitly enabled" rule, which is correct now that the default filter set
 * lists every edge type (so there are no missing/undefined keys to fall back on).
 */
export function isEdgeVisible(
  edge: TopologyEdge,
  edgeFilters: Record<string, boolean>,
  visibleNodeIds: { has(id: string): boolean },
): boolean {
  return (
    !!edgeFilters[edge.type] &&
    visibleNodeIds.has(edge.source) &&
    visibleNodeIds.has(edge.target)
  );
}
