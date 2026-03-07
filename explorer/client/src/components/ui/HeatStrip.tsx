interface HeatStripProps {
  segments: { value: number; color: string; label?: string }[];
  height?: number;
  className?: string;
}

export function HeatStrip({ segments, height = 8, className = '' }: HeatStripProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return null;

  return (
    <div className={`heat-strip ${className}`} style={{ height }} title={
      segments.map(s => `${s.label || ''}: ${s.value}`).join(' | ')
    }>
      {segments.map((seg, i) => (
        <div
          key={i}
          className="heat-strip__segment"
          style={{
            width: `${(seg.value / total) * 100}%`,
            background: seg.color,
          }}
        />
      ))}
    </div>
  );
}
