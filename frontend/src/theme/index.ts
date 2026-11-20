/**
 * Design/theme system: maps the shared `Theme` contract onto CSS custom
 * properties (see applyTheme.ts) so every themed surface — light, dark, or an
 * AI/manual custom override — repaints instantly, with no per-component
 * theme-switching logic.
 */
export { applyThemeVars } from "./applyTheme.js";
export { useApplyTheme } from "./useApplyTheme.js";
export { ThemeSwitcher } from "./ThemeSwitcher.js";
