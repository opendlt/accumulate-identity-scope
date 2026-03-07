interface ScopeLogoProps {
  size?: number;
}

export function ScopeLogo({ size = 32 }: ScopeLogoProps) {
  const id = `scope-grad-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6c8cff" />
          <stop offset="1" stopColor="#a78bfa" />
        </linearGradient>
      </defs>
      {/* Outer reticle circle */}
      <circle cx="16" cy="16" r="14" stroke={`url(#${id})`} strokeWidth="2" />
      {/* Crosshair lines */}
      <line x1="16" y1="1" x2="16" y2="7" stroke={`url(#${id})`} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="16" y1="25" x2="16" y2="31" stroke={`url(#${id})`} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="1" y1="16" x2="7" y2="16" stroke={`url(#${id})`} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="25" y1="16" x2="31" y2="16" stroke={`url(#${id})`} strokeWidth="1.5" strokeLinecap="round" />
      {/* Identity node dots — mini tree: root at top, two children below */}
      <circle cx="16" cy="12" r="2.2" fill={`url(#${id})`} />
      <circle cx="12" cy="20" r="2.2" fill={`url(#${id})`} />
      <circle cx="20" cy="20" r="2.2" fill={`url(#${id})`} />
      {/* Tree edges */}
      <line x1="16" y1="14.2" x2="12" y2="17.8" stroke={`url(#${id})`} strokeWidth="1" strokeLinecap="round" />
      <line x1="16" y1="14.2" x2="20" y2="17.8" stroke={`url(#${id})`} strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}
