import { motion } from 'framer-motion';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
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
      <div className="error-state-icon">{'\u26A0'}</div>
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
