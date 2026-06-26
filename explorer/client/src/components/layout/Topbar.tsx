import { useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useGlossary } from '../../contexts/GlossaryContext';

interface TopbarProps {
  onOpenSearch: () => void;
  dataAsOf?: string | null;
  network?: string;
}

function formatAsOf(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'Command Center',
  '/network': 'Network Graph',
  '/tree': 'Identity Explorer',
  '/accounts': 'Accounts',
  '/keys': 'Key Vault',
  '/authorities': 'Authority Flows',
  '/intelligence': 'Intelligence',
  '/search': 'Search Results',
};

export function Topbar({ onOpenSearch, dataAsOf, network = 'Accumulate Mainnet' }: TopbarProps) {
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const { openGlossary } = useGlossary();
  const pageName = PAGE_NAMES[location.pathname] || 'Explorer';
  const asOf = formatAsOf(dataAsOf);

  return (
    <div className="app-topbar">
      <div className="topbar-breadcrumb">
        <span style={{ opacity: 0.5 }}>Identity Scope</span>
        <span className="topbar-breadcrumb-sep">/</span>
        <span className="topbar-breadcrumb-current">{pageName}</span>
      </div>

      <div className="topbar-search">
        <div className="topbar-search-wrapper">
          <span className="topbar-search-icon">{'\u2315'}</span>
          <button
            type="button"
            className="topbar-search-input topbar-search-trigger"
            onClick={onOpenSearch}
            aria-label="Open command palette to search"
            aria-keyshortcuts="Control+K Meta+K"
          >
            Search identities, accounts, keys...
          </button>
          <span className="topbar-search-kbd">Ctrl+K</span>
        </div>
      </div>

      <div className="topbar-right">
        <button
          type="button"
          className="topbar-glossary-btn"
          onClick={() => openGlossary()}
          aria-label="Open glossary of Accumulate terms"
          title="Glossary \u2014 what these terms mean"
        >
          <span aria-hidden="true" style={{ fontStyle: 'italic', fontWeight: 700 }}>i</span>
          Glossary
        </button>
        <span className="topbar-provenance" title={dataAsOf ? `Snapshot crawled ${dataAsOf}` : undefined}>
          <span className="topbar-provenance-dot" aria-hidden="true" />
          {network}{asOf ? ` \u00B7 as of ${asOf}` : ''}
        </span>
        <a
          href="https://accumulatewebsitev2.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="topbar-accumulate-link"
          title="Accumulate Website"
        >
          <img src="/accumulate-logo.png" alt="Accumulate" className="topbar-accumulate-logo" />
        </a>
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {isDark ? '\u2600' : '\u263E'}
        </button>
      </div>
    </div>
  );
}
