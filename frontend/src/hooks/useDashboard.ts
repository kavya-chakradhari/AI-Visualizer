import { useCallback } from "react";
import { useDashboardStore } from "../state/index.js";
import type { CommandActionType, Command, Page, Visual } from "@ai-vis/types";

/**
 * Convenience hook for accessing and dispatching commands to the active dashboard.
 * Both manual UI interactions and AI assistants dispatch through this same hook.
 */
export function useDashboard() {
  const {
    dashboardState,
    currentDashboard,
    currentDataset,
    sampleRows,
    datasetsById,
    sampleRowsByDatasetId,
    commandLog,
    isLoading,
    isSyncing,
    error,
    toast,
    applyLocalCommand,
    loadDashboard,
    createDashboard,
    undo,
    redo,
    loadCommandLog,
    clearToast,
    showToast,
  } = useDashboardStore();

  const activePage: Page | null =
    currentDashboard?.pages.find((p) => p.id === currentDashboard.activePageId) ??
    currentDashboard?.pages[0] ??
    null;

  const visuals: Visual[] = activePage?.visuals ?? [];

  const dispatch = useCallback(
    async (
      type: CommandActionType,
      payload: Record<string, unknown>,
      options?: { origin?: Command["origin"]; prompt?: string }
    ) => {
      await applyLocalCommand({
        type,
        payload,
        origin: options?.origin ?? "user",
        prompt: options?.prompt,
      });
    },
    [applyLocalCommand]
  );

  return {
    dashboard: currentDashboard,
    dashboardState,
    activePage,
    visuals,
    currentDataset,
    sampleRows,
    datasetsById,
    sampleRowsByDatasetId,
    commandLog,
    isLoading,
    isSyncing,
    error,
    toast,
    dispatch,
    loadDashboard,
    createDashboard,
    undo,
    redo,
    loadCommandLog,
    clearToast,
    showToast,
  };
}

export default useDashboard;
