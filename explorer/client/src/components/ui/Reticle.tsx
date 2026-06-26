import type { ReactNode } from 'react';

interface ReticleProps {
  size?: number;
  /** Stroke color (any CSS color / var). Defaults to the ADI accent. */
  color?: string;
  className?: string;
  /** Optional content rendered in the crosshair center. */
  children?: ReactNode;
  /** Slightly thicker strokes for small sizes. */
  strong?: boolean;
}

/**
 * The Scope's signature mark: a targeting reticle (outer ring + crosshair ticks
 * + inner ring). Reused across loading / empty / error states and anywhere the
 * "identity scope" motif should read. Colors are CSS-var driven so it follows
 * the active theme.
 */
export function Reticle({ size = 64, color = 'var(--color-adi)', className = '', children, strong }: ReticleProps) {
  const w = strong ? 2 : 1.4;
  return (
    <span
      className={`reticle ${className}`}
      style={{ position: 'relative', display: 'inline-flex', width: size, height: size }}
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        {/* outer ring */}
        <circle cx="32" cy="32" r="29" stroke={color} strokeWidth={w} opacity="0.85" />
        {/* inner ring */}
        <circle cx="32" cy="32" r="20" stroke={color} strokeWidth={w} opacity="0.35" />
        {/* crosshair ticks: N E S W, leaving a gap at the center */}
        <line x1="32" y1="2"  x2="32" y2="12" stroke={color} strokeWidth={w} strokeLinecap="round" />
        <line x1="32" y1="52" x2="32" y2="62" stroke={color} strokeWidth={w} strokeLinecap="round" />
        <line x1="2"  y1="32" x2="12" y2="32" stroke={color} strokeWidth={w} strokeLinecap="round" />
        <line x1="52" y1="32" x2="62" y2="32" stroke={color} strokeWidth={w} strokeLinecap="round" />
      </svg>
      {children != null && (
        <span style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {children}
        </span>
      )}
    </span>
  );
}
