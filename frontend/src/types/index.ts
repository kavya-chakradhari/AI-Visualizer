/**
 * Re-exports shared domain interfaces from @ai-vis/types and defines frontend-specific UI contracts.
 */
export * from "@ai-vis/types";

export interface UiThemeState {
  theme: "light" | "dark";
  sidebarOpen: boolean;
  activeTab: "canvas" | "chat" | "editor";
}
