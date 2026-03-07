import { type ReactNode } from 'react';
import { motion } from 'framer-motion';

interface GlassCardProps {
  children: ReactNode;
  title?: string;
  titleRight?: ReactNode;
  glow?: boolean;
  interactive?: boolean;
  gradientTop?: boolean;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
  delay?: number;
}

export function GlassCard({
  children, title, titleRight, glow, interactive,
  gradientTop, className = '', style, compact, delay = 0,
}: GlassCardProps) {
  const classes = [
    'glass-card',
    glow && 'glass-card--glow',
    interactive && 'glass-card--interactive',
    gradientTop && 'glass-card--gradient-top',
    className,
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      className={classes}
      style={style}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {title && (
        <div className="glass-card__header">
          <div className="glass-card__title">{title}</div>
          {titleRight}
        </div>
      )}
      <div className={compact ? 'glass-card__body--compact' : 'glass-card__body'}>
        {children}
      </div>
    </motion.div>
  );
}
