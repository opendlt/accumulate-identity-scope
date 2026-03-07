import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { GlassCard } from './ui/GlassCard';
import { GlowBadge } from './ui/GlowBadge';
import { EmptyState } from './ui/EmptyState';
import { ErrorState } from './ui/ErrorState';
import { ExportButton, toCSV } from './ui/ExportButton';

const TYPE_VARIANTS: Record<string, 'adi' | 'token' | 'data' | 'key' | 'issuer'> = {
  'ADIs': 'adi',
  'Token Accounts': 'token',
  'Data Accounts': 'data',
  'Key Books': 'key',
  'Token Issuers': 'issuer',
};

export function SearchResultsPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.search(q),
    enabled: q.length >= 1,
  });

  if (!q) {
    return <EmptyState icon={'\u2315'} title="Enter a search query" description="Use the search bar above or press Ctrl+K to search." />;
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {[1, 2, 3].map(i => (
          <div key={i} className="shimmer" style={{ height: 80, borderRadius: 16 }} />
        ))}
      </div>
    );
  }

  if (isError) {
    return <ErrorState title="Search failed" message={`Could not search for "${q}".`} onRetry={() => refetch()} />;
  }

  if (!data) return null;

  const sections = [
    { title: 'ADIs', items: data.adis },
    { title: 'Token Accounts', items: data.token_accounts },
    { title: 'Data Accounts', items: data.data_accounts },
    { title: 'Key Books', items: data.key_books },
    { title: 'Token Issuers', items: data.token_issuers },
  ];

  const allItems = sections.flatMap(s => s.items.map((item: any) => ({ type: s.title, url: item.url })));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>
          Search results for <span style={{ color: 'var(--color-adi)' }}>"{q}"</span>
          <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
            ({data.total} found)
          </span>
        </div>
        {data.total > 0 && (
          <ExportButton
            filename={`search-${q}`}
            onExportCSV={() => toCSV(allItems)}
          />
        )}
      </div>

      {sections.map((s, i) => s.items.length > 0 && (
        <GlassCard key={s.title} title={`${s.title} (${s.items.length})`} delay={i * 0.05}>
          <table className="data-table">
            <thead>
              <tr>
                <th>URL</th>
                <th style={{ width: 80 }}>Type</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((item: any) => (
                <tr key={item.url}>
                  <td><span className="url-link">{item.url}</span></td>
                  <td><GlowBadge variant={TYPE_VARIANTS[s.title] || 'adi'}>{s.title.replace(/s$/, '')}</GlowBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      ))}

      {data.total === 0 && (
        <EmptyState
          icon={'\u2315'}
          title="No results found"
          description={`No identities, accounts, or keys match "${q}".`}
        />
      )}
    </div>
  );
}
