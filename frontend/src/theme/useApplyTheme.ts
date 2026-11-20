import { useEffect } from "react";
import type { Theme } from "@ai-vis/types";
import { DARK_THEME } from "@ai-vis/types";
import { applyThemeVars } from "./applyTheme.js";

/**
 * Applies `dashboard.theme` (or the default dark theme, before any dashboard
 * is loaded) to the document's CSS variables. This is the entire bridge
 * between "the server said the theme changed" and "the app looks different" —
 * no per-component theme logic is needed anywhere else.
 */
export function useApplyTheme(theme: Theme | undefined): void {
  useEffect(() => {
    applyThemeVars(theme ?? DARK_THEME);
  }, [theme]);
}
