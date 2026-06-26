import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import { api } from '../../api/client';
import { useTheme } from '../../contexts/ThemeContext';
import { useGlossary } from '../../contexts/GlossaryContext';
import { useOnboarding } from '../../contexts/OnboardingContext';
import type { SearchResults } from '../../types';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onToggleSidebar?: () => void;
}

interface ResultItem {
  type: string;
  url: string;
  route: string;
}

interface ViewCommand {
  route: string;
  label: string;
  icon: string;
}

const VIEW_COMMANDS: ViewCommand[] = [
  { route: '/',             label: 'Dashboard',    icon: '◈' },
  { route: '/network',      label: 'Network',      icon: '⬪' },
  { route: '/tree',         label: 'Tree',         icon: '⮡' },
  { route: '/accounts',     label: 'Accounts',     icon: '▣' },
  { route: '/keys',         label: 'Keys',         icon: '⬢' },
  { route: '/authorities',  label: 'Authorities',  icon: '⬡' },
  { route: '/intelligence', label: 'Intelligence', icon: '⦾' },
  { route: '/search',       label: 'Search',       icon: '⌕' },
];

const typeIcons: Record<string, string> = {
  'ADI': '◈',
  'Token Account': '▣',
  'Data Account': '▢',
  'Key Book': '⬢',
  'Token Issuer': '⬣',
  'Lite Account': '◇',
};

const ENTITY_TYPE_ORDER = ['ADI', 'Token Account', 'Data Account', 'Key Book', 'Token Issuer', 'Lite Account'];

export function CommandPalette({ open, onClose, onToggleSidebar }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef(0);
  // Element focused before the palette opened, so we can restore it on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();
  const { isDark, toggleTheme } = useTheme();
  const { openGlossary } = useGlossary();
  const { openWelcome } = useOnboarding();

  // On open: capture the element to restore focus to, reset state, focus the input.
  // On close (open -> false): restore focus to the previously focused element.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setResults([]);
      setLoading(false);
      const t = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
    // closed: restore focus
    const toRestore = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (toRestore && typeof toRestore.focus === 'function') {
      toRestore.focus();
    }
  }, [open]);

  // Restore focus if the component unmounts while open.
  useEffect(() => {
    return () => {
      const toRestore = restoreFocusRef.current;
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus();
      }
    };
  }, []);

  const runAndClose = useCallback((fn: () => void) => {
    fn();
    onClose();
  }, [onClose]);

  const search = useCallback((q: string) => {
    clearTimeout(timerRef.current);
    if (q.length < 2) { setResults([]); setLoading(false); return; }
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
        (data.lite_accounts ?? []).slice(0, 5).forEach(a =>
          items.push({ type: 'Lite Account', url: a.url, route: `/accounts?tab=lite&search=${encodeURIComponent(a.url)}` }));
        setResults(items);
      } catch { /* ignore */ }
      setLoading(false);
    }, 200);
  }, []);

  // Focus trap + document-level Escape: keep Tab focus within the dialog and
  // ensure Escape always closes regardless of which child is focused.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const hasQuery = query.trim().length >= 2;
  const grouped = ENTITY_TYPE_ORDER
    .map(type => ({ type, items: results.filter(r => r.type === type) }))
    .filter(g => g.items.length > 0);

  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="cmd-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={e => e.stopPropagation()}
      >
        {/* cmdk Command provides listbox/option semantics, unique ids,
            aria-activedescendant + aria-controls on the input, and aria-selected. */}
        <Command
          label="Command palette"
          shouldFilter={false}
          loop
        >
          <Command.Input
            ref={inputRef}
            className="cmd-input"
            placeholder="Search identities, accounts, keys, or run a command..."
            value={query}
            onValueChange={val => { setQuery(val); search(val); }}
          />
          <Command.List className="cmd-list">
            {loading && <div className="cmd-empty">Searching...</div>}

            {/* Persistent "search for query" row */}
            {hasQuery && (
              <Command.Group heading="Search">
                <Command.Item
                  value={`search-all-${query}`}
                  className="cmd-item"
                  onSelect={() => runAndClose(() => navigate(`/search?q=${encodeURIComponent(query)}`))}
                >
                  <span className="cmd-item-icon">{'⌕'}</span>
                  <span className="cmd-item-url">Search for "{query}" &hellip;</span>
                </Command.Item>
              </Command.Group>
            )}

            {/* Entity search results, grouped by type */}
            {!loading && grouped.map(({ type, items }) => (
              <Command.Group key={type} heading={`${type}s (${items.length})`}>
                {items.map(item => (
                  <Command.Item
                    key={item.url}
                    value={`entity-${item.url}`}
                    className="cmd-item"
                    onSelect={() => runAndClose(() => navigate(item.route))}
                  >
                    <span className="cmd-item-icon">{typeIcons[item.type] || '○'}</span>
                    <span className="cmd-item-url">{item.url}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            ))}

            {!loading && hasQuery && results.length === 0 && (
              <div className="cmd-empty">No matching entities for "{query}"</div>
            )}

            {/* Real commands */}
            <Command.Group heading="Commands">
              {VIEW_COMMANDS.map(cmd => (
                <Command.Item
                  key={cmd.route}
                  value={`view-${cmd.label}`}
                  keywords={['go', 'view', 'navigate', cmd.label]}
                  className="cmd-item"
                  onSelect={() => runAndClose(() => navigate(cmd.route))}
                >
                  <span className="cmd-item-icon">{cmd.icon}</span>
                  <span className="cmd-item-url">Go to {cmd.label}</span>
                </Command.Item>
              ))}
              <Command.Item
                value="open-glossary"
                keywords={['glossary', 'help', 'define', 'definition', 'terms', 'concepts', 'what is']}
                className="cmd-item"
                onSelect={() => runAndClose(() => openGlossary())}
              >
                <span className="cmd-item-icon" style={{ fontStyle: 'italic', fontWeight: 700 }}>i</span>
                <span className="cmd-item-url">Open glossary</span>
              </Command.Item>
              <Command.Item
                value="start-here"
                keywords={['start', 'welcome', 'help', 'intro', 'onboarding', 'what is', 'guide', 'tour']}
                className="cmd-item"
                onSelect={() => runAndClose(() => openWelcome())}
              >
                <span className="cmd-item-icon">{'☉'}</span>
                <span className="cmd-item-url">Start here — what is the Scope?</span>
              </Command.Item>
              <Command.Item
                value="toggle-theme"
                keywords={['theme', 'dark', 'light', 'mode']}
                className="cmd-item"
                onSelect={() => runAndClose(toggleTheme)}
              >
                <span className="cmd-item-icon">{isDark ? '☀' : '☾'}</span>
                <span className="cmd-item-url">Toggle theme ({isDark ? 'light' : 'dark'})</span>
              </Command.Item>
              {onToggleSidebar && (
                <Command.Item
                  value="toggle-sidebar"
                  keywords={['sidebar', 'collapse', 'expand', 'menu']}
                  className="cmd-item"
                  onSelect={() => runAndClose(onToggleSidebar)}
                >
                  <span className="cmd-item-icon">{'☰'}</span>
                  <span className="cmd-item-url">Toggle sidebar</span>
                </Command.Item>
              )}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
