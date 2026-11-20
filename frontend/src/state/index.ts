import { create } from "zustand";
import type {
  Dashboard,
  DashboardState,
  Dataset,
  Command,
  CommandActionType,
  CommandAuditLog,
} from "@ai-vis/types";
import { applyCommand } from "@ai-vis/types";
import {
  createDashboard as apiCreateDashboard,
  fetchDashboard as apiFetchDashboard,
  sendCommandToBackend,
  undoCommand as apiUndoCommand,
  redoCommand as apiRedoCommand,
  fetchCommandLog as apiFetchCommandLog,
} from "../api/dashboards.js";
import { ApiError } from "../api/errors.js";

/** Error codes the backend returns for a harmless no-op — never a real failure. */
const NOOP_ERROR_CODES = new Set(["NOTHING_TO_UNDO", "NOTHING_TO_REDO"]);

export interface ToastNotification {
  id: string;
  text: string;
  type: "error" | "info" | "success";
  timestamp: number;
}

export interface DashboardStoreState {
  // Authoritative server state
  currentDashboardState: DashboardState | null;
  // Active/optimistic state
  dashboardState: DashboardState | null;
  // Convenience getter for existing components
  currentDashboard: Dashboard | null;

  // Every dataset attached to the current dashboard, keyed by id, plus its preview rows.
  datasetsById: Record<string, Dataset>;
  sampleRowsByDatasetId: Record<string, Record<string, unknown>[]>;
  // Convenience getters for the dashboard's primary dataset — most of the UI
  // (profiling tab, raw data preview, CSV export, live-sync) still only cares
  // about "the" dataset even once others are attached.
  currentDataset: Dataset | null;
  sampleRows: Record<string, unknown>[];

  // Audit log
  commandLog: CommandAuditLog[];

  // Loading & syncing statuses
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  toast: ToastNotification | null;

  // Actions
  loadDashboard: (id: string) => Promise<void>;
  createDashboard: (title: string, datasetId?: string) => Promise<DashboardState>;
  setCurrentDashboard: (dashboard: Dashboard | null) => void;
  /** Adopts a full authoritative DashboardState — used after an AI turn executes. */
  applyRemoteDashboardState: (state: DashboardState) => void;
  setCurrentDataset: (
    dataset: Dataset | null,
    sampleRows?: Record<string, unknown>[]
  ) => void;
  /** Adds or refreshes one dataset (and its preview rows) attached to the current dashboard. */
  upsertDataset: (dataset: Dataset, sampleRows?: Record<string, unknown>[]) => void;
  /** Drops a dataset from local state after it's been detached from the dashboard. */
  removeDatasetLocal: (datasetId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearToast: () => void;
  showToast: (text: string, type?: "error" | "info" | "success") => void;

  // Single-source-of-truth mutation function with optimistic update & rollback
  applyLocalCommand: (command: {
    type: CommandActionType;
    payload: Record<string, unknown>;
    origin?: Command["origin"];
    prompt?: string;
  }) => Promise<void>;

  // Undo / Redo
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  loadCommandLog: (limit?: number) => Promise<void>;
}

export const useDashboardStore = create<DashboardStoreState>((set, get) => ({
  currentDashboardState: null,
  dashboardState: null,
  currentDashboard: null,
  datasetsById: {},
  sampleRowsByDatasetId: {},
  currentDataset: null,
  sampleRows: [],
  commandLog: [],
  isLoading: false,
  isSyncing: false,
  error: null,
  toast: null,

  setCurrentDashboard: (dashboard) => {
    if (!dashboard) {
      set({
        currentDashboard: null,
        dashboardState: null,
        currentDashboardState: null,
      });
      return;
    }
    const state: DashboardState = {
      dashboard,
      commandLogLength: 0,
      appliedCommandCount: 0,
      revertedCommandCount: 0,
      version: dashboard.version,
    };
    set({
      currentDashboard: dashboard,
      dashboardState: state,
      currentDashboardState: state,
    });
  },

  applyRemoteDashboardState: (state) =>
    set({
      currentDashboardState: state,
      dashboardState: state,
      currentDashboard: state.dashboard,
    }),

  setCurrentDataset: (dataset, sampleRows = []) => {
    set((state) => ({
      currentDataset: dataset,
      sampleRows,
      datasetsById: dataset
        ? { ...state.datasetsById, [dataset.id]: dataset }
        : state.datasetsById,
      sampleRowsByDatasetId: dataset
        ? { ...state.sampleRowsByDatasetId, [dataset.id]: sampleRows }
        : state.sampleRowsByDatasetId,
    }));
  },

  upsertDataset: (dataset, sampleRows = []) =>
    set((state) => ({
      datasetsById: { ...state.datasetsById, [dataset.id]: dataset },
      sampleRowsByDatasetId: { ...state.sampleRowsByDatasetId, [dataset.id]: sampleRows },
      // The very first attached dataset also becomes "the" primary dataset,
      // matching the existing single-dataset bootstrap flow.
      ...(state.currentDataset
        ? {}
        : { currentDataset: dataset, sampleRows }),
    })),

  removeDatasetLocal: (datasetId) =>
    set((state) => {
      const { [datasetId]: _removedDataset, ...datasetsById } = state.datasetsById;
      const { [datasetId]: _removedRows, ...sampleRowsByDatasetId } = state.sampleRowsByDatasetId;
      const wasCurrent = state.currentDataset?.id === datasetId;
      return {
        datasetsById,
        sampleRowsByDatasetId,
        ...(wasCurrent ? { currentDataset: null, sampleRows: [] } : {}),
      };
    }),

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  clearToast: () => set({ toast: null }),
  showToast: (text, type = "info") =>
    set({
      toast: {
        id: Math.random().toString(36).slice(2),
        text,
        type,
        timestamp: Date.now(),
      },
    }),

  loadDashboard: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const state = await apiFetchDashboard(id);
      set({
        currentDashboardState: state,
        dashboardState: state,
        currentDashboard: state.dashboard,
        isLoading: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load dashboard";
      set({ isLoading: false, error: msg });
      get().showToast(msg, "error");
    }
  },

  createDashboard: async (title: string, datasetId?: string) => {
    set({ isLoading: true, error: null });
    try {
      const state = await apiCreateDashboard(title, datasetId);
      set({
        currentDashboardState: state,
        dashboardState: state,
        currentDashboard: state.dashboard,
        isLoading: false,
      });
      return state;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create dashboard";
      set({ isLoading: false, error: msg });
      get().showToast(msg, "error");
      throw err;
    }
  },

  /**
   * Apply local command:
   * 1. Optimistically updates the store immediately using shared applyCommand reducer.
   * 2. Syncs to backend via PATCH /api/dashboards/:id.
   * 3. On rejection: rolls back to previous snapshot and triggers an error toast.
   */
  applyLocalCommand: async (commandInput) => {
    const { dashboardState } = get();
    if (!dashboardState) {
      const msg = "Cannot apply command: No active dashboard.";
      set({ error: msg });
      get().showToast(msg, "error");
      return;
    }

    const previousSnapshot = dashboardState;
    const dashboardId = dashboardState.dashboard.id;
    const origin = commandInput.origin ?? "user";

    // 1. Optimistic Update
    const optimisticCommand: Command = {
      id: "optimistic_" + Date.now(),
      dashboardId,
      type: commandInput.type,
      payload: commandInput.payload as never,
      origin,
      prompt: commandInput.prompt,
      timestamp: new Date().toISOString(),
      sequenceNumber: dashboardState.commandLogLength + 1,
    };

    try {
      const optimisticState = applyCommand(previousSnapshot, optimisticCommand);
      set({
        dashboardState: optimisticState,
        currentDashboard: optimisticState.dashboard,
        isSyncing: true,
        error: null,
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to apply command locally";
      get().showToast(msg, "error");
      return;
    }

    // 2. Sync to Backend
    try {
      const result = await sendCommandToBackend(dashboardId, {
        type: commandInput.type,
        payload: commandInput.payload,
        origin,
        prompt: commandInput.prompt,
      });

      // 3. Backend Confirmed: Set Authoritative State
      set({
        currentDashboardState: result.state,
        dashboardState: result.state,
        currentDashboard: result.state.dashboard,
        isSyncing: false,
      });
    } catch (err: unknown) {
      // 4. Backend Rejected: Roll Back & Toast
      const msg =
        err instanceof Error
          ? err.message
          : "Command rejected by server. Changes reverted.";
      set({
        dashboardState: previousSnapshot,
        currentDashboard: previousSnapshot.dashboard,
        isSyncing: false,
        error: msg,
      });
      get().showToast(msg, "error");
    }
  },

  undo: async () => {
    const { dashboardState } = get();
    if (!dashboardState) return;

    set({ isSyncing: true, error: null });
    try {
      const state = await apiUndoCommand(dashboardState.dashboard.id);
      set({
        currentDashboardState: state,
        dashboardState: state,
        currentDashboard: state.dashboard,
        isSyncing: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Undo failed";
      // "Nothing to undo" is expected, harmless, and never a real failure —
      // don't set `error` (which would otherwise read as a broken dashboard)
      // and use a neutral toast instead of an alarming red one.
      const isNoop = err instanceof ApiError && NOOP_ERROR_CODES.has(err.code ?? "");
      set({ isSyncing: false, error: isNoop ? null : msg });
      get().showToast(msg, isNoop ? "info" : "error");
    }
  },

  redo: async () => {
    const { dashboardState } = get();
    if (!dashboardState) return;

    set({ isSyncing: true, error: null });
    try {
      const state = await apiRedoCommand(dashboardState.dashboard.id);
      set({
        currentDashboardState: state,
        dashboardState: state,
        currentDashboard: state.dashboard,
        isSyncing: false,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Redo failed";
      const isNoop = err instanceof ApiError && NOOP_ERROR_CODES.has(err.code ?? "");
      set({ isSyncing: false, error: isNoop ? null : msg });
      get().showToast(msg, isNoop ? "info" : "error");
    }
  },

  loadCommandLog: async (limit = 50) => {
    const { dashboardState } = get();
    if (!dashboardState) return;

    try {
      const log = await apiFetchCommandLog(dashboardState.dashboard.id, limit);
      set({ commandLog: log });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load command log";
      get().showToast(msg, "error");
    }
  },
}));
