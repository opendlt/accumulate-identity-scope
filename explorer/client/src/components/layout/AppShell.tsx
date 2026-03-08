import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { MobileBottomNav } from './MobileBottomNav';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';
import { api } from '../../api/client';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: api.getStats,
    staleTime: 120000,
  });

  const handleOpenSearch = useCallback(() => setCmdOpen(true), []);
  const handleCloseSearch = useCallback(() => setCmdOpen(false), []);

  // global Ctrl+K
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(prev => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-layout">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        adiCount={stats?.counts.adis}
      />
      <div className="app-content-area">
        <Topbar onOpenSearch={handleOpenSearch} />
        <main className="app-main">
          {children}
        </main>
      </div>
      <MobileBottomNav />
      <CommandPalette open={cmdOpen} onClose={handleCloseSearch} />
    </div>
  );
}
