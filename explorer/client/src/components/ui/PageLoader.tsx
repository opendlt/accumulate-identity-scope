/**
 * Full-page loading state with spinning ring and node-tree icon.
 * Used across all major views while data is being fetched.
 */
export function PageLoader({ message = 'Loading...' }: { message?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: 20, minHeight: 400, width: '100%',
    }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: '2px solid var(--border-subtle)',
        }} />
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          border: '2px solid transparent', borderTopColor: 'var(--color-adi)',
          animation: 'spinSlow 1s linear infinite',
        }} />
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-adi)" strokeWidth="1.5" strokeLinecap="round" style={{ animation: 'breathe 2s ease-in-out infinite' }}>
            <circle cx="12" cy="12" r="2" fill="var(--color-adi)" />
            <circle cx="6" cy="6" r="1.5" fill="var(--color-token)" />
            <circle cx="18" cy="6" r="1.5" fill="var(--color-data)" />
            <line x1="12" y1="12" x2="6" y2="6" />
            <line x1="12" y1="12" x2="18" y2="6" />
          </svg>
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
        {message}
      </div>
    </div>
  );
}
