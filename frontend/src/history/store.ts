import { create } from "zustand";
import type { CommandBatchDiff, CommandHistoryEntry } from "@ai-vis/types";
import { fetchCommandHistory, fetchBatchDiff } from "../api/dashboards.js";

interface HistoryStoreState {
  isOpen: boolean;
  isLoading: boolean;
  entries: CommandHistoryEntry[];
  error: string | null;

  /** The entry currently expanded to show its diff, if any. */
  selectedEntryId: string | null;
  isDiffLoading: boolean;
  diffs: Record<string, CommandBatchDiff>;

  open: (dashboardId: string) => Promise<void>;
  close: () => void;
  toggle: (dashboardId: string) => Promise<void>;
  refresh: (dashboardId: string) => Promise<void>;
  selectEntry: (dashboardId: string, batchId: string) => Promise<void>;
}

export const useHistoryStore = create<HistoryStoreState>((set, get) => ({
  isOpen: false,
  isLoading: false,
  entries: [],
  error: null,
  selectedEntryId: null,
  isDiffLoading: false,
  diffs: {},

  open: async (dashboardId) => {
    set({ isOpen: true });
    await get().refresh(dashboardId);
  },

  close: () => set({ isOpen: false, selectedEntryId: null }),

  toggle: async (dashboardId) => {
    if (get().isOpen) {
      get().close();
    } else {
      await get().open(dashboardId);
    }
  },

  refresh: async (dashboardId) => {
    set({ isLoading: true, error: null });
    try {
      const entries = await fetchCommandHistory(dashboardId);
      set({ entries, isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load command history.";
      set({ isLoading: false, error: msg });
    }
  },

  selectEntry: async (dashboardId, batchId) => {
    const { selectedEntryId, diffs } = get();

    // Toggle closed if the same entry is clicked again.
    if (selectedEntryId === batchId) {
      set({ selectedEntryId: null });
      return;
    }

    set({ selectedEntryId: batchId });
    if (diffs[batchId]) return; // already cached

    set({ isDiffLoading: true });
    try {
      const diff = await fetchBatchDiff(dashboardId, batchId);
      set((s) => ({ diffs: { ...s.diffs, [batchId]: diff }, isDiffLoading: false }));
    } catch (err) {
      set({ isDiffLoading: false, error: err instanceof Error ? err.message : "Failed to load detail." });
    }
  },
}));
