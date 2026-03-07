import { lazy, Suspense, Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import { ThemeProvider } from './contexts/ThemeContext';
import { AppShell } from './components/layout/AppShell';
import { PageTransition } from './components/ui/PageTransition';
import { useEffect } from 'react';

/* ── Lazy-loaded route components ─────────────── */
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const TreeExplorer = lazy(() => import('./components/TreeExplorer').then(m => ({ default: m.TreeExplorer })));
const AccountsBrowser = lazy(() => import('./components/AccountsBrowser').then(m => ({ default: m.AccountsBrowser })));
const KeysView = lazy(() => import('./components/KeysView').then(m => ({ default: m.KeysView })));
const AuthoritiesView = lazy(() => import('./components/AuthoritiesView').then(m => ({ default: m.AuthoritiesView })));
const IntelligenceView = lazy(() => import('./components/IntelligenceView').then(m => ({ default: m.IntelligenceView })));
const NetworkGraph = lazy(() => import('./components/NetworkGraph').then(m => ({ default: m.NetworkGraph })));
const SearchResultsPage = lazy(() => import('./components/SearchResultsPage').then(m => ({ default: m.SearchResultsPage })));

/* ── Loading fallback ─────────────────────────── */
function RouteFallback() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
      <div className="shimmer" style={{ height: 100, borderRadius: 16 }} />
      <div className="shimmer" style={{ height: 200, borderRadius: 16 }} />
      <div className="shimmer" style={{ height: 160, borderRadius: 16 }} />
    </div>
  );
}

/* ── Error Boundary ───────────────────────────── */
interface ErrorBoundaryState { hasError: boolean; error?: Error }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-state" style={{ marginTop: 40 }}>
          <div className="error-state-icon">{'\u26A0'}</div>
          <div className="error-state-title">Something went wrong</div>
          <div className="error-state-message">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </div>
          <button
            className="error-state-retry"
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── Query Client ─────────────────────────────── */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60000, retry: 1 } },
});

/* ── Keyboard Navigation ──────────────────────── */
const NAV_KEYS: Record<string, string> = {
  '1': '/',
  '2': '/network',
  '3': '/tree',
  '4': '/accounts',
  '5': '/keys',
  '6': '/authorities',
  '7': '/intelligence',
};

function KeyboardNav() {
  const navigate = useNavigate();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Alt+number for quick navigation
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const route = NAV_KEYS[e.key];
        if (route) {
          e.preventDefault();
          navigate(route);
        }
      }
      // Escape closes flyouts (handled by individual components)
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  return null;
}

/* ── Animated Routes ──────────────────────────── */
function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<PageTransition><Suspense fallback={<RouteFallback />}><Dashboard /></Suspense></PageTransition>} />
        <Route path="/network" element={<PageTransition><Suspense fallback={<RouteFallback />}><NetworkGraph /></Suspense></PageTransition>} />
        <Route path="/tree" element={<PageTransition><Suspense fallback={<RouteFallback />}><TreeExplorer /></Suspense></PageTransition>} />
        <Route path="/accounts" element={<PageTransition><Suspense fallback={<RouteFallback />}><AccountsBrowser /></Suspense></PageTransition>} />
        <Route path="/keys" element={<PageTransition><Suspense fallback={<RouteFallback />}><KeysView /></Suspense></PageTransition>} />
        <Route path="/authorities" element={<PageTransition><Suspense fallback={<RouteFallback />}><AuthoritiesView /></Suspense></PageTransition>} />
        <Route path="/intelligence" element={<PageTransition><Suspense fallback={<RouteFallback />}><IntelligenceView /></Suspense></PageTransition>} />
        <Route path="/search" element={<PageTransition><Suspense fallback={<RouteFallback />}><SearchResultsPage /></Suspense></PageTransition>} />
      </Routes>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AppShell>
              <KeyboardNav />
              <AnimatedRoutes />
            </AppShell>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
