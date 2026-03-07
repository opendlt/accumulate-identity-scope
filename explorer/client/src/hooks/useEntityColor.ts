const ENTITY_COLORS: Record<string, { color: string; glow: string; badge: string }> = {
  adi:       { color: '#6c8cff', glow: 'rgba(108,140,255,0.15)', badge: 'glow-badge--adi' },
  token:     { color: '#22d3ee', glow: 'rgba(34,211,238,0.12)',  badge: 'glow-badge--token' },
  data:      { color: '#a78bfa', glow: 'rgba(167,139,250,0.12)', badge: 'glow-badge--data' },
  key:       { color: '#34d399', glow: 'rgba(52,211,153,0.12)',  badge: 'glow-badge--key' },
  authority: { color: '#f59e0b', glow: 'rgba(245,158,11,0.12)',  badge: 'glow-badge--authority' },
  issuer:    { color: '#f472b6', glow: 'rgba(244,114,182,0.12)', badge: 'glow-badge--issuer' },
  danger:    { color: '#ef4444', glow: 'rgba(239,68,68,0.10)',   badge: 'glow-badge--danger' },
  success:   { color: '#22c55e', glow: 'rgba(34,197,94,0.10)',   badge: 'glow-badge--success' },
};

export function useEntityColor(entity: string) {
  return ENTITY_COLORS[entity] || ENTITY_COLORS.adi;
}

export function getEntityColor(entity: string) {
  return ENTITY_COLORS[entity] || ENTITY_COLORS.adi;
}
