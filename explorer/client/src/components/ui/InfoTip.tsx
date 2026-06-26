import {
  useState, useRef, useId, useLayoutEffect, useEffect, useCallback,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getGlossary } from '../../content/glossary';
import { useGlossary } from '../../contexts/GlossaryContext';

interface InfoTipProps {
  /** Glossary id to pull the definition from. */
  term?: string;
  /** Explicit overrides (used when there is no glossary entry). */
  label?: string;
  definition?: ReactNode;
  why?: ReactNode;
  className?: string;
}

const POP_WIDTH = 270;

/**
 * An accessible "ⓘ" affordance that explains a metric or domain term in place:
 * a one-line definition plus a "Why it matters" hook, with a link into the full
 * glossary. Opens on hover, focus, or click; dismisses on blur, Escape, scroll,
 * or outside click. Content is sourced from the canonical glossary by `term`.
 */
export function InfoTip({ term, label, definition, why, className = '' }: InfoTipProps) {
  const entry = term ? getGlossary(term) : undefined;
  const title = label ?? entry?.term ?? 'Definition';
  const body = definition ?? entry?.short;
  const whyText = why ?? entry?.why;
  const { openGlossary } = useGlossary();

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const popId = useId();

  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = undefined; }
  }, []);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => setOpen(false), 140);
  }, [cancelHide]);
  const show = useCallback(() => { cancelHide(); setOpen(true); }, [cancelHide]);

  // Position the popover once it is open and measured.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const popH = popRef.current?.offsetHeight ?? 120;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = r.bottom + 8;
    if (top + popH > vh - 8) top = Math.max(8, r.top - popH - 8);
    const left = Math.min(Math.max(8, r.left), vw - POP_WIDTH - 8);
    setCoords({ top, left });
  }, [open]);

  // Dismiss on Escape / scroll / outside click while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  useEffect(() => () => cancelHide(), [cancelHide]);

  if (!body && !entry) return null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`infotip-btn ${className}`}
        aria-label={`What is ${title}?`}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        onFocus={show}
        onBlur={scheduleHide}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >
        i
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          id={popId}
          role="tooltip"
          className="infotip-pop"
          style={{
            top: coords?.top ?? -9999,
            left: coords?.left ?? -9999,
            width: POP_WIDTH,
            visibility: coords ? 'visible' : 'hidden',
          }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="infotip-pop__term">{title}</div>
          {body && <div className="infotip-pop__def">{body}</div>}
          {whyText && (
            <div className="infotip-pop__why">
              <span className="infotip-pop__why-label">Why it matters</span> {whyText}
            </div>
          )}
          {entry && (
            <button
              type="button"
              className="infotip-pop__more"
              onClick={() => { setOpen(false); openGlossary(entry.id); }}
            >
              Open glossary →
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * A label followed by an InfoTip — convenient for metric titles, column
 * headers, and badges. `children` is the visible text; `term` drives the tip.
 */
export function TermLabel({ term, children, className = '' }: { term: string; children: ReactNode; className?: string }) {
  return (
    <span className={`term-label ${className}`}>
      {children}
      <InfoTip term={term} />
    </span>
  );
}
