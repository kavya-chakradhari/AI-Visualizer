import React, { useState, useRef, useEffect } from "react";
import { Check, ChevronDown, Palette } from "lucide-react";
import type { Theme } from "@ai-vis/types";
import { BUILT_IN_THEMES } from "@ai-vis/types";

export interface ThemeSwitcherProps {
  currentTheme: Theme | undefined;
  onSelect: (theme: Theme) => void;
}

/** True when the current theme is exactly one of the built-ins (by name), not an AI/manual override. */
function isBuiltIn(theme: Theme | undefined): boolean {
  return BUILT_IN_THEMES.some((t) => t.name === theme?.name);
}

/**
 * Lets the user pick between the built-in themes. An AI or manual
 * `update_style` (scope: dashboard) override is preserved as-is — this control
 * only ever *replaces* the theme wholesale when the user explicitly picks one
 * of the built-ins from the list.
 */
export const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ currentTheme, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  const label = isBuiltIn(currentTheme) ? currentTheme?.name : "Custom";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Theme: ${label}. Change theme`}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-app-surface hover:brightness-110 text-app-muted text-xs font-medium border border-app-border transition-all min-h-[44px]"
      >
        <Palette className="w-3.5 h-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className="w-3 h-3" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Choose a theme"
          className="absolute right-0 mt-2 w-44 rounded-xl border border-app-border bg-app-surface shadow-[var(--shadow)] overflow-hidden z-50"
        >
          {BUILT_IN_THEMES.map((theme) => {
            const selected = theme.name === currentTheme?.name;
            return (
              <button
                key={theme.name}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onSelect(theme);
                  setIsOpen(false);
                }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-xs text-app-text hover:brightness-110 transition-all min-h-[44px]"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-app-border flex-shrink-0"
                    style={{ backgroundColor: theme.background }}
                    aria-hidden="true"
                  />
                  {theme.name}
                </span>
                {selected && <Check className="w-3.5 h-3.5 text-app-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThemeSwitcher;
