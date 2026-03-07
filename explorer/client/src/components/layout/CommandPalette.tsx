import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { SearchResults } from '../../types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface ResultItem {
  type: string;
  url: string;
  route: string;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // global keyboard shortcut
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        if (open) onClose();
        else {
          // parent handles opening
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const search = useCallback((q: string) => {
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    timerRef.current = window.setTimeout(async () => {
      try {
        const data: SearchResults = await api.search(q);
        const items: ResultItem[] = [];
        data.adis.slice(0, 8).forEach(a =>
          items.push({ type: 'ADI', url: a.url, route: `/tree?select=${encodeURIComponent(a.url)}` }));
        data.token_accounts.slice(0, 5).forEach(a =>
          items.push({ type: 'Token Account', url: a.url, route: `/accounts?search=${encodeURIComponent(a.url)}` }));
        data.data_accounts.slice(0, 3).forEach(a =>
          items.push({ type: 'Data Account', url: a.url, route: `/accounts?search=${encodeURIComponent(a.url)}` }));
        data.key_books.slice(0, 3).forEach(a =>
          items.push({ type: 'Key Book', url: a.url, route: `/keys?search=${encodeURIComponent(a.url)}` }));
        data.token_issuers.slice(0, 2).forEach(a =>
          items.push({ type: 'Token Issuer', url: a.url, route: `/accounts?search=${encodeURIComponent(a.url)}` }));
        setResults(items);
        setSelected(0);
      } catch { /* ignore */ }
      setLoading(false);
    }, 200);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => Math.min(s + 1, results.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && results[selected]) {
      navigate(results[selected].route);
      onClose();
    }
  }

  if (!open) return null;

  const typeIcons: Record<string, string> = {
    'ADI': '\u25C8',
    'Token Account': '\u25A3',
    'Data Account': '\u25A2',
    'Key Book': '\u2B22',
    'Token Issuer': '\u2B23',
  };

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-dialog" onClick={e => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Search identities, accounts, keys..."
          value={query}
          onChange={e => { setQuery(e.target.value); search(e.target.value); }}
          onKeyDown={onKeyDown}
        />
        <div className="cmd-list">
          {loading && <div className="cmd-empty">Searching...</div>}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div className="cmd-empty">No results for "{query}"</div>
          )}
          {!loading && results.length > 0 && (
            <>
              {/* group by type */}
              {['ADI', 'Token Account', 'Data Account', 'Key Book', 'Token Issuer'].map(type => {
                const items = results.filter(r => r.type === type);
                if (items.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="cmd-group-heading">{type}s ({items.length})</div>
                    {items.map(item => {
                      const idx = results.indexOf(item);
                      return (
                        <div
                          key={item.url}
                          className="cmd-item"
                          aria-selected={idx === selected}
                          onMouseEnter={() => setSelected(idx)}
                          onClick={() => { navigate(item.route); onClose(); }}
                        >
                          <span className="cmd-item-icon">{typeIcons[item.type] || '\u25CB'}</span>
                          <span className="cmd-item-url">{item.url}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
          {query.length < 2 && (
            <div className="cmd-empty" style={{ opacity: 0.5 }}>
              Type at least 2 characters to search...
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
