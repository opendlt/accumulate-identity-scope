import { motion } from 'framer-motion';
import { Reticle } from './Reticle';

interface EmptyStateProps {
  /** Optional override glyph; when omitted the scope reticle is shown. */
  icon?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  compact?: boolean;
}

export function EmptyState({ icon, title, description, action, compact }: EmptyStateProps) {
  return (
    <motion.div
      className={`empty-state ${compact ? 'empty-state--compact' : ''}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="empty-state-icon">
        {icon ? icon : <Reticle size={compact ? 40 : 52} color="var(--text-tertiary)" />}
      </div>
      <div className="empty-state-title">{title}</div>
      {description && <div className="empty-state-desc">{description}</div>}
      {action && (
        <button className="empty-state-action" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
