import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
  formatter?: (n: number) => string;
}

export function AnimatedCounter({ value, duration = 900, className = '', formatter }: AnimatedCounterProps) {
  const animated = useAnimatedNumber(value, duration);
  const display = formatter ? formatter(animated) : animated.toLocaleString();

  return <span className={className}>{display}</span>;
}
