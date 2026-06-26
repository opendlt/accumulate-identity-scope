import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useGlossary } from '../../contexts/GlossaryContext';
import { ScopeLogo } from './ScopeLogo';

interface WelcomeOverlayProps {
  open: boolean;
  onClose: () => void;
}

const AUDIENCES = [
  { who: 'ADI owner', q: '“Is my identity secure, and what should I fix?”' },
  { who: 'Developer', q: '“How is the network structured, and what are these primitives?”' },
  { who: 'Auditor / researcher', q: '“Where is the risk, and how is it measured?”' },
];

const VIEWS: { route: string; name: string; answers: string }[] = [
  { route: '/',             name: 'Command Center',   answers: 'the network at a glance — how many identities exist, how they’re secured, how authority is distributed.' },
  { route: '/network',      name: 'Network Graph',    answers: 'who relates to whom — hierarchy, authority, shared keys, and delegated power.' },
  { route: '/tree',         name: 'Identity Explorer', answers: 'one identity in depth — its accounts, signing keys, and who can authorize it.' },
  { route: '/accounts',     name: 'Accounts',         answers: 'every token & data account, and the issuers that mint each token.' },
  { route: '/keys',         name: 'Key Vault',        answers: 'the signing keys — key books, key pages, thresholds, and credit balances.' },
  { route: '/authorities',  name: 'Authority Flows',  answers: 'who can sign for whom, including delegated and cross-identity control.' },
  { route: '/intelligence', name: 'Intelligence',     answers: 'security signals — key reuse, weak signing, and concentration of control.' },
];

/**
 * First-run "Start here" overlay: frames what the Scope is, who it's for, and
 * what each view answers. Auto-shown once (localStorage), reopenable from the
 * sidebar and command palette.
 */
export function WelcomeOverlay({ open, onClose }: WelcomeOverlayProps) {
  const navigate = useNavigate();
  const { openGlossary } = useGlossary();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => closeRef.current?.focus(), 60);
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(t); };
  }, [open, onClose]);

  const go = (route: string) => { onClose(); navigate(route); };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="welcome-overlay"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="welcome-dialog"
            role="dialog" aria-modal="true" aria-label="Welcome to the Accumulate Scope"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            onClick={e => e.stopPropagation()}
          >
            <button ref={closeRef} className="welcome-close" aria-label="Close" onClick={onClose}>×</button>

            <div className="welcome-head">
              <ScopeLogo size={40} />
              <div>
                <div className="welcome-title">Welcome to the Accumulate Scope</div>
                <div className="welcome-lead">
                  A live structural map of every identity (ADI) on the Accumulate network.
                  This is a crawled <strong>snapshot</strong> — not live chain state.
                </div>
              </div>
            </div>

            <div className="welcome-section-label">Who it’s for</div>
            <div className="welcome-audiences">
              {AUDIENCES.map(a => (
                <div key={a.who} className="welcome-audience">
                  <div className="welcome-audience-who">{a.who}</div>
                  <div className="welcome-audience-q">{a.q}</div>
                </div>
              ))}
            </div>

            <div className="welcome-section-label">What each view answers</div>
            <div className="welcome-views">
              {VIEWS.map(v => (
                <button key={v.route} className="welcome-view" onClick={() => go(v.route)}>
                  <span className="welcome-view-name">{v.name}</span>
                  <span className="welcome-view-answers">{v.answers}</span>
                </button>
              ))}
            </div>

            <div className="welcome-footer">
              <button className="welcome-btn welcome-btn--ghost" onClick={() => { onClose(); openGlossary(); }}>
                Open glossary
              </button>
              <a
                className="welcome-btn welcome-btn--ghost"
                href="https://docs.accumulatenetwork.io/"
                target="_blank" rel="noopener noreferrer"
              >
                Accumulate docs ↗
              </a>
              <button className="welcome-btn welcome-btn--primary" onClick={onClose}>
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
