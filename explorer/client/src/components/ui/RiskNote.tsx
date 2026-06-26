import type { ReactNode } from 'react';
import { getRisk, type RiskTone } from '../../content/risks';

interface RiskNoteProps {
  /** Risk id from content/risks.ts (drives why/fix/tone). */
  risk?: string;
  /** Explicit overrides when there is no canonical risk entry. */
  why?: ReactNode;
  fix?: ReactNode;
  tone?: RiskTone;
  /** Optional call-to-action (e.g. "Investigate →") rendered as a button. */
  action?: { label: string; onClick: () => void };
  className?: string;
  /** Compact single-line variant for dense panels. */
  compact?: boolean;
}

const TONE_ICON: Record<RiskTone, string> = {
  danger: '⚠',
  warning: '⚠',
  info: 'ℹ',
};

/**
 * A persistent "why it matters + what to do" callout for a security signal —
 * the non-hover counterpart to InfoTip, used on the headline risk panels so the
 * threat model and remediation are always visible, not hidden behind a tooltip.
 */
export function RiskNote({ risk, why, fix, tone, action, className = '', compact }: RiskNoteProps) {
  const entry = risk ? getRisk(risk) : undefined;
  const resolvedTone: RiskTone = tone ?? entry?.tone ?? 'info';
  const whyText = why ?? entry?.why;
  const fixText = fix ?? entry?.fix;
  if (!whyText && !fixText) return null;

  return (
    <div className={`risk-note risk-note--${resolvedTone} ${compact ? 'risk-note--compact' : ''} ${className}`}>
      <span className="risk-note__icon" aria-hidden="true">{TONE_ICON[resolvedTone]}</span>
      <div className="risk-note__body">
        {whyText && <div className="risk-note__why">{whyText}</div>}
        {fixText && (
          <div className="risk-note__fix">
            <span className="risk-note__fix-label">Fix</span> {fixText}
          </div>
        )}
        {action && (
          <button type="button" className="risk-note__action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
