import { useEffect, useState } from 'react';

interface RingGaugeProps {
  value: number;      // 0..1
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  valueLabel?: string;
  className?: string;
}

export function RingGauge({
  value, size = 120, strokeWidth = 8,
  color = '#6c8cff', trackColor = 'rgba(108,140,255,0.08)',
  label, valueLabel, className = '',
}: RingGaugeProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - (mounted ? Math.min(value, 1) : 0));

  return (
    <div className={`ring-gauge ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={trackColor} strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div className="ring-gauge__text">
        {valueLabel && <span className="ring-gauge__value">{valueLabel}</span>}
        {label && <span className="ring-gauge__label">{label}</span>}
      </div>
    </div>
  );
}
