/**
 * Single source of truth for resolving design-token CSS custom properties into
 * concrete values usable from JS/canvas code. Reads the live computed value of
 * a `--var` off :root so the dark/light token definitions in tokens.css are the
 * one place colors are defined. Results are cached per active theme to avoid
 * repeated getComputedStyle calls in hot canvas-render loops; the cache is
 * invalidated automatically when the `data-theme` attribute changes.
 */

let _theme = '';
let _cache: Record<string, string> = {};

function activeTheme(): string {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

export function cssVar(name: string, fallback = ''): string {
  const theme = activeTheme();
  if (theme !== _theme) {
    _theme = theme;
    _cache = {};
  }
  let v = _cache[name];
  if (v === undefined) {
    if (typeof document !== 'undefined') {
      v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    } else {
      v = '';
    }
    if (!v) v = fallback;
    _cache[name] = v;
  }
  return v || fallback;
}
