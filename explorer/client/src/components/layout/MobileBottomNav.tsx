import { useState, useRef, useCallback } from 'react';
import { NavLink } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/',              icon: '\u25C8', label: 'Command' },
  { to: '/network',       icon: '\u2B2A', label: 'Network' },
  { to: '/tree',          icon: '\u2BA1', label: 'Explorer' },
  { to: '/accounts',      icon: '\u25A3', label: 'Accounts' },
  { to: '/keys',          icon: '\u2B22', label: 'Keys' },
  { to: '/authorities',   icon: '\u2B21', label: 'Authority' },
  { to: '/intelligence',  icon: '\u29BE', label: 'Intel' },
] as const;

export function MobileBottomNav() {
  const [expanded, setExpanded] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragStartExpanded = useRef(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Only capture touches on the handle area
    const target = e.target as HTMLElement;
    if (!target.closest('.mobile-nav-handle')) return;
    dragStartY.current = e.touches[0].clientY;
    dragStartExpanded.current = expanded;
  }, [expanded]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const deltaY = e.changedTouches[0].clientY - dragStartY.current;
    // Swipe up to expand, swipe down to collapse
    if (dragStartExpanded.current) {
      if (deltaY > 30) setExpanded(false);
    } else {
      if (deltaY < -30) setExpanded(true);
    }
    dragStartY.current = null;
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded(prev => !prev);
  }, []);

  return (
    <div
      className={`mobile-bottom-nav ${expanded ? 'expanded' : ''}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull handle */}
      <button
        className="mobile-nav-handle"
        onClick={toggleExpanded}
        aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
      >
        <span className="mobile-nav-handle-bar" />
      </button>

      {/* Scrollable nav track */}
      <div className="mobile-nav-track" ref={trackRef}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `mobile-nav-item ${isActive ? 'active' : ''}`
            }
            onClick={() => setExpanded(false)}
          >
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}
