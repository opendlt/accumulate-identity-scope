import { Reticle } from './Reticle';

/**
 * Full-page loading state styled as a targeting scope acquiring a lock: a static
 * reticle with a rotating radar sweep and a pulsing identity node at the center.
 */
export function PageLoader({ message = 'Acquiring scope…' }: { message?: string }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="scope-loader">
        <span className="scope-loader__sweep" aria-hidden="true" />
        <Reticle size={72} strong>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
               style={{ animation: 'breathe 2s ease-in-out infinite' }}>
            <line x1="12" y1="12" x2="6" y2="6" stroke="var(--color-token)" strokeWidth="1.4" strokeLinecap="round" />
            <line x1="12" y1="12" x2="18" y2="6" stroke="var(--color-data)" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="12" cy="12" r="2.4" fill="var(--color-adi)" />
            <circle cx="6" cy="6" r="1.6" fill="var(--color-token)" />
            <circle cx="18" cy="6" r="1.6" fill="var(--color-data)" />
          </svg>
        </Reticle>
      </div>
      <div className="page-loader__msg">{message}</div>
    </div>
  );
}
