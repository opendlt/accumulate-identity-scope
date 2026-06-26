import { useRef, useEffect } from 'react';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
  formatter?: (n: number) => string;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Counts up to `value` on change. Writes the formatted number straight to the
 * DOM node via a ref + a single rAF loop, so the tween does NOT trigger ~60
 * React commits per second per counter (the previous setState-per-frame
 * approach was a measurable jank source on dashboards with many counters).
 * Honors prefers-reduced-motion by snapping to the final value.
 */
export function AnimatedCounter({ value, duration = 900, className = '', formatter }: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const fromRef = useRef(0);
  const rafRef = useRef(0);
  const fmt = formatter ?? ((n: number) => n.toLocaleString());

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = fromRef.current;

    if (from === value || prefersReducedMotion()) {
      fromRef.current = value;
      el.textContent = fmt(value);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      const current = Math.round(from + (value - from) * eased);
      el.textContent = fmt(current);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <span ref={ref} className={className}>{fmt(fromRef.current)}</span>;
}
