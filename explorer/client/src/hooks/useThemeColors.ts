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

const DARK: ThemeColors = {
  canvasBg: '#06080f',
  canvasText: '#e8ecf4',
  canvasTextDim: '#7b83a6',
  canvasTextMuted: '#4a5078',
  tooltipBg: '#111628',
  tooltipBorder: 'rgba(108,140,255,0.12)',
  gridLine: 'rgba(108,140,255,0.08)',
  cursorFill: 'rgba(108,140,255,0.04)',
};

const LIGHT: ThemeColors = {
  canvasBg: '#f5f7fa',
  canvasText: '#1a1d2e',
  canvasTextDim: '#5a6178',
  canvasTextMuted: '#8b92ab',
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
