import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { GlossaryDrawer } from '../components/ui/GlossaryDrawer';

interface GlossaryCtxValue {
  /** Open the glossary drawer, optionally scrolled to a specific term id. */
  openGlossary: (termId?: string) => void;
}

const GlossaryContext = createContext<GlossaryCtxValue>({ openGlossary: () => {} });

export function useGlossary() {
  return useContext(GlossaryContext);
}

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | undefined>(undefined);

  const openGlossary = useCallback((termId?: string) => {
    setFocusId(termId);
    setOpen(true);
  }, []);

  return (
    <GlossaryContext.Provider value={{ openGlossary }}>
      {children}
      <GlossaryDrawer open={open} focusId={focusId} onClose={() => setOpen(false)} />
    </GlossaryContext.Provider>
  );
}
