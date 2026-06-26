import { cssVar } from '../styles/themeVars';

/**
 * Entity color accessors. The base `color` is sourced from the CSS design
 * tokens (tokens.css) so it stays in sync with the theme — including the
 * light-theme entity ramp — instead of being a second hardcoded copy. The
 * fallback hex matches the dark-theme token and is only used if the CSS var
 * can't be read (e.g. before styles load). `glow` (a faint tint) and `badge`
 * (a className) are theme-independent.
 */
interface EntityColor { color: string; glow: string; badge: string }

const ENTITY: Record<string, { var: string; fallback: string; glow: string; badge: string }> = {
  adi:       { var: '--color-adi',       fallback: '#6c8cff', glow: 'rgba(108,140,255,0.15)', badge: 'glow-badge--adi' },
  token:     { var: '--color-token',     fallback: '#22d3ee', glow: 'rgba(34,211,238,0.12)',  badge: 'glow-badge--token' },
  data:      { var: '--color-data',      fallback: '#a78bfa', glow: 'rgba(167,139,250,0.12)', badge: 'glow-badge--data' },
  key:       { var: '--color-key',       fallback: '#34d399', glow: 'rgba(52,211,153,0.12)',  badge: 'glow-badge--key' },
  authority: { var: '--color-authority', fallback: '#f59e0b', glow: 'rgba(245,158,11,0.12)',  badge: 'glow-badge--authority' },
  issuer:    { var: '--color-issuer',    fallback: '#f472b6', glow: 'rgba(244,114,182,0.12)', badge: 'glow-badge--issuer' },
  danger:    { var: '--color-danger',    fallback: '#ef4444', glow: 'rgba(239,68,68,0.10)',   badge: 'glow-badge--danger' },
  success:   { var: '--color-success',   fallback: '#22c55e', glow: 'rgba(34,197,94,0.10)',   badge: 'glow-badge--success' },
};

export function getEntityColor(entity: string): EntityColor {
  const e = ENTITY[entity] || ENTITY.adi;
  return { color: cssVar(e.var, e.fallback), glow: e.glow, badge: e.badge };
}

export function useEntityColor(entity: string): EntityColor {
  return getEntityColor(entity);
}
