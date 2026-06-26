import { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GLOSSARY, GLOSSARY_CATEGORIES, type GlossaryEntry } from '../../content/glossary';

interface GlossaryDrawerProps {
  open: boolean;
  focusId?: string;
  onClose: () => void;
}

/**
 * Slide-over reference of every Accumulate concept the Scope surfaces. Opened
 * from the topbar, the command palette, or any InfoTip's "Open glossary" link
 * (which scrolls to and highlights the relevant term).
 */
export function GlossaryDrawer({ open, focusId, onClose }: GlossaryDrawerProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => Object.values(GLOSSARY), []);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.term.toLowerCase().includes(q) ||
      e.short.toLowerCase().includes(q) ||
      e.why.toLowerCase().includes(q));
  }, [entries, query]);

  // On open: focus search, reset query, and scroll to the requested term.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const t = window.setTimeout(() => {
      if (focusId) {
        const el = panelRef.current?.querySelector(`[data-term="${focusId}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('glossary-entry--flash'); }
        else searchRef.current?.focus();
      } else {
        searchRef.current?.focus();
      }
    }, 60);
    return () => window.clearTimeout(t);
  }, [open, focusId]);

  // Escape to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const byCategory = (cat: string) => filtered.filter(e => e.category === cat);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="glossary-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            className="glossary-drawer"
            role="dialog" aria-modal="true" aria-label="Accumulate glossary"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
          >
            <div className="glossary-header">
              <div>
                <div className="glossary-title">Glossary</div>
                <div className="glossary-subtitle">What the Accumulate Scope’s terms mean — and why they matter.</div>
              </div>
              <button type="button" className="glossary-close" aria-label="Close glossary" onClick={onClose}>×</button>
            </div>

            <input
              ref={searchRef}
              className="glossary-search"
              placeholder="Search terms…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />

            <div className="glossary-body">
              {filtered.length === 0 && <div className="glossary-empty">No terms match “{query}”.</div>}
              {GLOSSARY_CATEGORIES.map(cat => {
                const items = byCategory(cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="glossary-section">
                    <div className="glossary-section-title">{cat}</div>
                    {items.map((e: GlossaryEntry) => (
                      <div key={e.id} data-term={e.id} className="glossary-entry">
                        <div className="glossary-entry-term">{e.term}</div>
                        <div className="glossary-entry-def">{e.short}</div>
                        <div className="glossary-entry-why">
                          <span className="glossary-entry-why-label">Why it matters</span> {e.why}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
