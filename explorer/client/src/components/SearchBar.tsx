import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { SearchResults } from '../types';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>(0);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function onChange(val: string) {
    setQuery(val);
    clearTimeout(timer.current);
    if (val.length < 2) { setResults(null); setOpen(false); return; }
    timer.current = window.setTimeout(async () => {
      const r = await api.search(val);
      setResults(r);
      setOpen(true);
    }, 300);
  }

  function go(path: string) {
    setOpen(false);
    setQuery('');
    navigate(path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && query.length >= 2) {
      setOpen(false);
      navigate(`/search?q=${encodeURIComponent(query)}`);
    }
  }

  return (
    <div className="search-container" ref={ref}>
      <input className="search-input" placeholder="Search URLs..."
        value={query} onChange={e => onChange(e.target.value)} onKeyDown={onKeyDown}
        onFocus={() => results && setOpen(true)} />
      {open && results && results.total > 0 && (
        <div className="search-dropdown">
          {results.adis.length > 0 && <>
            <div className="search-group-label">ADIs ({results.adis.length})</div>
            {results.adis.slice(0, 5).map(a => (
              <div key={a.url} className="search-item" onClick={() => go(`/tree?select=${encodeURIComponent(a.url)}`)}>
                {a.url}
              </div>
            ))}
          </>}
          {results.token_accounts.length > 0 && <>
            <div className="search-group-label">Token Accounts ({results.token_accounts.length})</div>
            {results.token_accounts.slice(0, 5).map(a => (
              <div key={a.url} className="search-item" onClick={() => go(`/accounts?search=${encodeURIComponent(a.url)}`)}>
                {a.url}
              </div>
            ))}
          </>}
          {results.key_books.length > 0 && <>
            <div className="search-group-label">Key Books ({results.key_books.length})</div>
            {results.key_books.slice(0, 5).map(a => (
              <div key={a.url} className="search-item" onClick={() => go(`/keys?search=${encodeURIComponent(a.url)}`)}>
                {a.url}
              </div>
            ))}
          </>}
          <div className="search-item" style={{ color: 'var(--accent)', borderTop: '1px solid var(--border)' }}
            onClick={() => go(`/search?q=${encodeURIComponent(query)}`)}>
            View all results...
          </div>
        </div>
      )}
    </div>
  );
}
