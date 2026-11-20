import type { Theme } from "@ai-vis/types";

/**
 * Maps every Theme field onto a CSS custom property on :root. This is the
 * ONLY place a Theme object touches the DOM — every themed surface in the
 * app reads one of these variables (via Tailwind's semantic color tokens, see
 * tailwind.config.js) rather than a hardcoded color, so an AI-driven or
 * manual theme change repaints the whole app the instant this runs, with no
 * component re-render logic of its own.
 */
export function applyThemeVars(theme: Theme): void {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--color-background", theme.background);
  set("--color-surface", theme.surface);
  set("--color-text", theme.text);
  set("--color-muted-text", theme.mutedText);
  set("--color-primary", theme.primary);
  set("--color-secondary", theme.secondary);
  set("--color-success", theme.success);
  set("--color-warning", theme.warning);
  set("--color-danger", theme.danger);
  set("--color-border", theme.border);

  theme.chartPalette.forEach((color, i) => set(`--chart-color-${i + 1}`, color));
  set("--chart-palette-length", String(theme.chartPalette.length));

  set("--font-family", theme.fontFamily);
  set("--font-size-xs", `${theme.fontSizes.xs}px`);
  set("--font-size-sm", `${theme.fontSizes.sm}px`);
  set("--font-size-base", `${theme.fontSizes.base}px`);
  set("--font-size-lg", `${theme.fontSizes.lg}px`);
  set("--font-size-xl", `${theme.fontSizes.xl}px`);
  set("--font-size-xxl", `${theme.fontSizes.xxl}px`);

  set("--radius", `${theme.borderRadius}px`);
  set("--shadow", theme.shadow);

  set("--space-xs", `${theme.spacingScale.xs}px`);
  set("--space-sm", `${theme.spacingScale.sm}px`);
  set("--space-md", `${theme.spacingScale.md}px`);
  set("--space-lg", `${theme.spacingScale.lg}px`);
  set("--space-xl", `${theme.spacingScale.xl}px`);

  root.setAttribute("data-theme-mode", theme.mode);
  root.style.colorScheme = theme.mode;
}
