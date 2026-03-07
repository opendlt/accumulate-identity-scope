import { motion } from 'framer-motion';
import { AnimatedCounter } from './AnimatedCounter';

interface StatOrbProps {
  value: number;
  label: string;
  color: string;
  glow: string;
  delay?: number;
}

export function StatOrb({ value, label, color, glow, delay = 0 }: StatOrbProps) {
  return (
    <motion.div
      className="stat-orb"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      <div
        className="stat-orb__ring"
        style={{
          '--orb-color': glow,
          '--orb-accent': color,
        } as React.CSSProperties}
      >
        <AnimatedCounter
          value={value}
          className="stat-orb__value"
          duration={1200}
        />
      </div>
      <div className="stat-orb__label">{label}</div>
    </motion.div>
  );
}
