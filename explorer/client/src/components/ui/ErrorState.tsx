import { motion } from 'framer-motion';
import { Reticle } from './Reticle';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Signal lost',
  message = 'Failed to load data. Please try again.',
  onRetry,
}: ErrorStateProps) {
  return (
    <motion.div
      className="error-state"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="error-state-icon">
        <Reticle size={52} color="var(--color-danger)" strong>
          <span style={{ fontSize: 18, lineHeight: 1, color: 'var(--color-danger)' }}>{'⚠'}</span>
        </Reticle>
      </div>
      <div className="error-state-title">{title}</div>
      <div className="error-state-message">{message}</div>
      {onRetry && (
        <button className="error-state-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </motion.div>
  );
}
