import { useTheme } from '../contexts/ThemeContext';

export interface ThemeColors {
  canvasBg: string;
  canvasText: string;
  canvasTextDim: string;
  canvasTextMuted: string;
  tooltipBg: string;
  tooltipBorder: string;
  gridLine: string;
  cursorFill: string;
}

// Dim/muted match the --text-secondary/--text-tertiary tokens, raised to pass
// WCAG AA on the canvas background (previous muted #4a5078 was ~2.3:1).
const DARK: ThemeColors = {
  canvasBg: '#06080f',
  canvasText: '#e8ecf4',
  canvasTextDim: '#9aa2c8',
  canvasTextMuted: '#828ab0',
  tooltipBg: '#111628',
  tooltipBorder: 'rgba(108,140,255,0.12)',
  gridLine: 'rgba(108,140,255,0.08)',
  cursorFill: 'rgba(108,140,255,0.04)',
};

const LIGHT: ThemeColors = {
  canvasBg: '#f5f7fa',
  canvasText: '#1a1d2e',
  canvasTextDim: '#5a6178',
  canvasTextMuted: '#6a7290',
  tooltipBg: '#ffffff',
  tooltipBorder: 'rgba(108,140,255,0.18)',
  gridLine: 'rgba(108,140,255,0.12)',
  cursorFill: 'rgba(108,140,255,0.06)',
};

export function getThemeColors(isDark: boolean): ThemeColors {
  return isDark ? DARK : LIGHT;
}

export function getTooltipStyle(isDark: boolean) {
  const c = getThemeColors(isDark);
  return {
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    borderRadius: 8,
    fontSize: 11,
    color: c.canvasText,
  };
}

export function useThemeColors(): ThemeColors {
  const { isDark } = useTheme();
  return getThemeColors(isDark);
}
