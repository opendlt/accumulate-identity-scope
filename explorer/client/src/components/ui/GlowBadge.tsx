import type { ReactNode } from 'react';

interface GlowBadgeProps {
  variant: 'adi' | 'token' | 'data' | 'key' | 'authority' | 'danger' | 'success' | 'warning' | 'issuer';
  children: ReactNode;
  className?: string;
}

export function GlowBadge({ variant, children, className = '' }: GlowBadgeProps) {
  return (
    <span className={`glow-badge glow-badge--${variant} ${className}`}>
      {children}
    </span>
  );
}
