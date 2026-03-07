import { useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';

interface TopbarProps {
  onOpenSearch: () => void;
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

export function Topbar({ onOpenSearch }: TopbarProps) {
  const location = useLocation();
  const { isDark, toggleTheme } = useTheme();
  const pageName = PAGE_NAMES[location.pathname] || 'Explorer';

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
          <input
            className="topbar-search-input"
            placeholder="Search identities, accounts, keys..."
            readOnly
            onClick={onOpenSearch}
            onFocus={onOpenSearch}
          />
          <span className="topbar-search-kbd">Ctrl+K</span>
        </div>
      </div>

      <div className="topbar-right">
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
        >
          {isDark ? '\u2600' : '\u263E'}
        </button>
        <span>Accumulate Mainnet</span>
      </div>
    </div>
  );
}
