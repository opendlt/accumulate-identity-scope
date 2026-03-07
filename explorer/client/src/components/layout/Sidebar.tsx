import { NavLink } from 'react-router-dom';
import { ScopeLogo } from '../ui/ScopeLogo';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  adiCount?: number;
}

const NAV_ITEMS = [
  { section: 'Overview' },
  { to: '/',              icon: '\u25C8', label: 'Command Center', shortcut: 'Alt+1' },
  { to: '/network',       icon: '\u2B2A', label: 'Network Graph', shortcut: 'Alt+2' },
  { section: 'Explore' },
  { to: '/tree',          icon: '\u2BA1', label: 'Identity Explorer', shortcut: 'Alt+3' },
  { to: '/accounts',      icon: '\u25A3', label: 'Accounts', shortcut: 'Alt+4' },
  { to: '/keys',          icon: '\u2B22', label: 'Key Vault', shortcut: 'Alt+5' },
  { to: '/authorities',   icon: '\u2B21', label: 'Authority Flows', shortcut: 'Alt+6' },
  { section: 'Analyze' },
  { to: '/intelligence',  icon: '\u29BE', label: 'Intelligence', shortcut: 'Alt+7' },
] as const;

export function Sidebar({ collapsed, onToggle, adiCount }: SidebarProps) {
  return (
    <aside className={`app-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-logo"><ScopeLogo size={32} /></div>
        {!collapsed && (
          <div>
            <div className="sidebar-brand-text">Identity Scope</div>
            <div className="sidebar-brand-sub">Accumulate</div>
          </div>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item, i) => {
          if ('section' in item) {
            if (collapsed) return null;
            return (
              <div key={i} className="sidebar-section-label">
                {item.section}
              </div>
            );
          }
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? 'active' : ''}`
              }
              title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
            >
              <span className="sidebar-link-icon">{item.icon}</span>
              {!collapsed && (
                <>
                  <span>{item.label}</span>
                  <span className="sidebar-shortcut">{item.shortcut}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className="sidebar-status-dot" />
          {!collapsed && <span>{adiCount ?? '...'} ADIs indexed</span>}
        </div>
        <button className="sidebar-collapse-btn" onClick={onToggle}>
          {collapsed ? '\u276F' : '\u276E  Collapse'}
        </button>
      </div>
    </aside>
  );
}
