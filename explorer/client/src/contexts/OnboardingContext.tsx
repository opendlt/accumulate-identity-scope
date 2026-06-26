import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { WelcomeOverlay } from '../components/ui/WelcomeOverlay';

interface OnboardingCtxValue {
  /** Open the "Start here" welcome overlay. */
  openWelcome: () => void;
}

const OnboardingContext = createContext<OnboardingCtxValue>({ openWelcome: () => {} });

export function useOnboarding() {
  return useContext(OnboardingContext);
}

const SEEN_KEY = 'scope.welcomeSeen.v1';

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  // Auto-show once on first visit.
  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch { /* storage unavailable */ }
  }, []);

  const openWelcome = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
  }, []);

  return (
    <OnboardingContext.Provider value={{ openWelcome }}>
      {children}
      <WelcomeOverlay open={open} onClose={handleClose} />
    </OnboardingContext.Provider>
  );
}
