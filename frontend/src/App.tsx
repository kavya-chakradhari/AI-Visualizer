import React, { useState, useEffect, useCallback } from "react";
import {
  BarChart3,
  Layers,
  Table as TableIcon,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Plus,
  Undo2,
  Redo2,
  History as HistoryIcon,
  LayoutGrid,
  X,
  AlertCircle,
  Database,
} from "lucide-react";
import { FileUploadZone } from "./components/FileUploadZone.js";
import { ColumnSummaryPanel } from "./components/ColumnSummaryPanel.js";
import { DataPreviewTable } from "./components/DataPreviewTable.js";
import { ExportMenu } from "./components/ExportMenu.js";
import { DashboardCanvas } from "./canvas/DashboardCanvas.js";
import { AddChartModal } from "./editor/AddChartModal.js";
import { PropertyEditor } from "./editor/PropertyEditor.js";
import { ManageDatasetsPanel } from "./editor/ManageDatasetsPanel.js";
import { ChatPanel, useChatStore } from "./ai-chat/index.js";
import { HistoryPanel, useHistoryStore } from "./history/index.js";
import { useApplyTheme, ThemeSwitcher } from "./theme/index.js";
import { useDashboard } from "./hooks/useDashboard.js";
import { useDashboardStore } from "./state/index.js";
import { exportNodeToPng } from "./export/pngExport.js";
import { exportDatasetCsv, syncDataset } from "./api/datasets.js";
import type {
  DatasetUploadResponse,
  FieldSemanticType,
  CommandPayloadMap,
  Theme,
  Visual,
} from "@ai-vis/types";

export const App: React.FC = () => {
  const {
    dashboard,
    dashboardState,
    visuals,
    currentDataset,
    sampleRows,
    datasetsById,
    sampleRowsByDatasetId,
    isSyncing,
    toast,
    dispatch,
    createDashboard,
    undo,
    redo,
    clearToast,
  } = useDashboard();

  const [activeTab, setActiveTab] = useState<"canvas" | "profiling" | "preview">("canvas");
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [isAddChartOpen, setIsAddChartOpen] = useState<boolean>(false);
  const [isManageDatasetsOpen, setIsManageDatasetsOpen] = useState<boolean>(false);

  // Every dataset actually attached to this dashboard, in `datasetIds` order —
  // the single source of truth for pickers and the "Manage Datasets" panel.
  const attachedDatasets = (dashboard?.datasetIds ?? [])
    .map((id) => datasetsById[id])
    .filter((d): d is NonNullable<typeof d> => Boolean(d));
  // A plain useRef's `.current` doesn't trigger a re-render when it's first
  // attached, so ExportMenu (rendered as a sibling, above this node in the
  // tree) could keep seeing `null` until some unrelated state change happened
  // to re-render App. A callback ref + state makes the capture target arrive
  // reliably the moment the tab content actually mounts.
  const [exportCaptureNode, setExportCaptureNode] = useState<HTMLDivElement | null>(null);

  // ── Theme: CSS variables follow dashboard.theme everywhere, instantly ──
  useApplyTheme(dashboard?.theme);

  // ── Layout strategy: at most one auxiliary panel is ever visible ──
  // (AI Chat, Command History, or the Properties editor). Each is a fixed
  // overlay — full-screen on mobile, a side panel from tablet up — and they
  // never compete for the same screen edge at once, so the canvas is never
  // squeezed and no two panels can ever clip or overlap one another.
  // Selecting a visual re-opens Properties without losing chat/history's own
  // sense of "what's selected" (selectedVisualId itself is never cleared here).
  const isChatOpen = useChatStore((s) => s.isOpen);
  const isHistoryOpen = useHistoryStore((s) => s.isOpen);
  const isPropertiesVisible = selectedVisualId !== null && !isChatOpen && !isHistoryOpen;

  const handleSelectVisual = useCallback((id: string | null) => {
    setSelectedVisualId(id);
    if (id !== null) {
      useChatStore.getState().closeChat();
      useHistoryStore.getState().close();
    }
  }, []);

  // Chat and History are also mutually exclusive with EACH OTHER: at some
  // viewport widths their fixed side-panel widths (400px + 380px) would
  // otherwise overlap (e.g. both open at once on a 768px tablet), and on
  // mobile both go full-screen, so they'd always stack.
  useEffect(() => {
    if (isChatOpen) useHistoryStore.getState().close();
  }, [isChatOpen]);
  useEffect(() => {
    if (isHistoryOpen) useChatStore.getState().closeChat();
  }, [isHistoryOpen]);

  // Auto-dismiss toast after 5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        clearToast();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [toast, clearToast]);

  // Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo).
  // Skipped while typing in a text field — e.g. the AI chat input — so a
  // native text-undo there doesn't get hijacked into a dashboard undo.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isUndoRedoKey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z";
      if (!isUndoRedoKey) return;

      const active = document.activeElement;
      const isTextInput =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable);
      if (isTextInput) return;

      e.preventDefault();
      if (e.shiftKey) {
        void redo();
      } else {
        void undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // Keep an open History panel in sync with whatever just landed as confirmed
  // backend state (a new command, an undo, a redo — any of them).
  useEffect(() => {
    const dashboardId = dashboardState?.dashboard.id;
    if (dashboardId && useHistoryStore.getState().isOpen) {
      void useHistoryStore.getState().refresh(dashboardId);
    }
  }, [dashboardState]);

  const [isSyncingLive, setIsSyncingLive] = useState<boolean>(false);

  // Live Auto-Refresh polling if refreshIntervalSeconds is configured
  useEffect(() => {
    if (!currentDataset?.id || !currentDataset.refreshIntervalSeconds || currentDataset.refreshIntervalSeconds <= 0) {
      return;
    }
    const intervalMs = currentDataset.refreshIntervalSeconds * 1000;
    const intervalId = setInterval(async () => {
      try {
        const syncRes = await syncDataset(currentDataset.id);
        useDashboardStore.getState().setCurrentDataset(syncRes.dataset, syncRes.sampleRows);
      } catch (err) {
        console.warn("Auto-sync error:", err);
      }
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [currentDataset?.id, currentDataset?.refreshIntervalSeconds]);

  const handleSyncLiveDataset = async () => {
    if (!currentDataset?.id) return;
    setIsSyncingLive(true);
    try {
      const syncRes = await syncDataset(currentDataset.id);
      useDashboardStore.getState().setCurrentDataset(syncRes.dataset, syncRes.sampleRows);
      useDashboardStore.getState().showToast(
        `Live data refreshed! ${syncRes.rowsCount} records updated.`,
        "success"
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to sync live data.";
      useDashboardStore.getState().showToast(msg, "error");
    } finally {
      setIsSyncingLive(false);
    }
  };

  // When a dataset is uploaded or connected, ensure a dashboard exists
  const handleUploadSuccess = async (data: DatasetUploadResponse) => {
    useDashboardStore.getState().setCurrentDataset(data.dataset, data.sampleRows);

    if (!dashboard) {
      try {
        await createDashboard(`${data.dataset.name} Dashboard`, data.dataset.id);
      } catch {
        // Handled in store
      }
    }
    setActiveTab("canvas");
  };

  // Attaching a dataset to an already-existing dashboard (via the "Manage
  // Datasets" panel) — additive, unlike handleUploadSuccess's bootstrap path.
  const handleAttachDataset = async (data: DatasetUploadResponse) => {
    useDashboardStore.getState().upsertDataset(data.dataset, data.sampleRows);
    await dispatch("ATTACH_DATASET", { datasetId: data.dataset.id });
  };

  const handleDetachDataset = async (datasetId: string) => {
    await dispatch("DETACH_DATASET", { datasetId });
    const latest = useDashboardStore.getState().dashboardState?.dashboard;
    if (!latest || latest.datasetIds.includes(datasetId)) return; // rejected — keep local state as-is

    useDashboardStore.getState().removeDatasetLocal(datasetId);
    if (latest.datasetId && latest.datasetId !== currentDataset?.id) {
      const store = useDashboardStore.getState();
      const promoted = store.datasetsById[latest.datasetId];
      if (promoted) {
        store.setCurrentDataset(promoted, store.sampleRowsByDatasetId[promoted.id] ?? []);
      }
    } else if (!latest.datasetId) {
      useDashboardStore.getState().setCurrentDataset(null, []);
    }
  };

  const handleReset = () => {
    useDashboardStore.getState().setCurrentDataset(null, []);
    useDashboardStore.getState().setCurrentDashboard(null);
  };

  const handleUpdateColumnType = (columnName: string, newSemanticType: FieldSemanticType) => {
    if (!currentDataset) return;
    const updatedSchema = currentDataset.schema.map((col) =>
      col.name === columnName
        ? { ...col, semanticType: newSemanticType, isAmbiguous: false }
        : col
    );
    useDashboardStore.getState().setCurrentDataset({ ...currentDataset, schema: updatedSchema }, sampleRows);
  };

  // Commands dispatching through the single authoritative path (applyCommand)
  const activePageId = dashboard?.activePageId || dashboard?.pages[0]?.id || "default";

  const handleAddChartSubmit = async (payload: CommandPayloadMap["CREATE_VISUAL"]) => {
    await dispatch("CREATE_VISUAL", payload);
  };

  const handleMoveVisual = async (visualId: string, x: number, y: number) => {
    await dispatch("MOVE_VISUAL", {
      pageId: activePageId,
      visualId,
      x,
      y,
    });
  };

  const handleResizeVisual = async (visualId: string, width: number, height: number) => {
    await dispatch("RESIZE_VISUAL", {
      pageId: activePageId,
      visualId,
      width,
      height,
    });
  };

  const handleDeleteVisual = async (visualId: string) => {
    await dispatch("DELETE_VISUAL", {
      pageId: activePageId,
      visualId,
    });
    if (selectedVisualId === visualId) {
      setSelectedVisualId(null);
    }
  };

  const handleZIndexChange = async (visualId: string, zIndex: number) => {
    await dispatch("UPDATE_VISUAL", {
      pageId: activePageId,
      visualId,
      patch: {
        layout: {
          ...visuals.find((v) => v.id === visualId)?.layout,
          zIndex,
        } as never,
      },
    });
  };

  const handleUpdateVisualProperties = async (visualId: string, patch: Partial<Visual>) => {
    // Changing a visual's kind has its own dedicated command — UPDATE_VISUAL's
    // patch schema deliberately doesn't accept `kind`/`type` (switching chart
    // type has different validation needs than a generic field patch), so
    // routing it there would always fail schema validation.
    if (patch.kind) {
      await dispatch("CHANGE_CHART_TYPE", {
        pageId: activePageId,
        visualId,
        kind: patch.kind,
      });
      return;
    }
    await dispatch("UPDATE_VISUAL", {
      pageId: activePageId,
      visualId,
      patch,
    });
  };

  const handleSelectTheme = async (theme: Theme) => {
    await dispatch("SET_THEME", { theme });
  };

  const exportFilenameBase = (dashboard?.title || currentDataset?.name || "dashboard")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_");

  const handleExportPng = async (node: HTMLElement, filenameBase: string) => {
    await exportNodeToPng(node, filenameBase);
  };

  const handleExportCsv = async () => {
    if (!currentDataset) return;
    await exportDatasetCsv(currentDataset.id);
  };

  const selectedVisual = visuals.find((v) => v.id === selectedVisualId) || null;

  return (
    <div className="min-h-screen bg-app-bg text-app-text font-app flex flex-col selection:bg-app-primary selection:text-white relative">
      {/* Toast Notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2 fade-in duration-200"
        >
          <div
            className={`px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 text-xs font-medium ${
              toast.type === "error"
                ? "bg-rose-950/90 border-rose-800 text-rose-200"
                : "bg-app-surface border-app-border text-app-text"
            }`}
          >
            {toast.type === "error" ? (
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-app-success flex-shrink-0" aria-hidden="true" />
            )}
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={clearToast}
              aria-label="Dismiss notification"
              className="ml-2 -mr-1 w-8 h-8 flex items-center justify-center text-app-muted hover:text-app-text"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 bg-app-surface/80 backdrop-blur-md border-b border-app-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-app-primary to-app-secondary flex items-center justify-center shadow-md flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-base tracking-tight text-app-text flex items-center gap-1.5">
                AI VIS <span className="text-xs font-normal text-app-primary font-mono">v0.1</span>
              </span>
              <p className="text-[11px] text-app-muted hidden sm:block truncate">
                Manual Dashboard Canvas & Interactive Visual Studio
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
            {currentDataset && <ThemeSwitcher currentTheme={dashboard?.theme} onSelect={handleSelectTheme} />}
            {currentDataset && (
              <>
                <button
                  type="button"
                  onClick={() => setIsManageDatasetsOpen(true)}
                  title="Manage datasets attached to this dashboard"
                  className="hidden sm:flex items-center space-x-2 bg-app-bg/60 hover:bg-app-bg px-3 py-1.5 rounded-lg border border-app-border text-xs transition-colors min-h-[44px]"
                >
                  {currentDataset.sourceType && currentDataset.sourceType !== "file" ? (
                    <span className="flex items-center gap-1.5 font-bold text-[11px] text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                      LIVE {currentDataset.sourceType.toUpperCase()}
                    </span>
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-app-success animate-pulse" aria-hidden="true" />
                  )}
                  <span className="text-app-text font-medium truncate max-w-[180px]">
                    {attachedDatasets.length > 1
                      ? `${attachedDatasets.length} datasets`
                      : currentDataset.name}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsManageDatasetsOpen(true)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-app-bg hover:brightness-125 text-app-muted text-xs font-medium border border-app-border transition-all min-h-[44px]"
                >
                  <Database className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Datasets</span>
                </button>

                {currentDataset.sourceType && currentDataset.sourceType !== "file" && (
                  <button
                    type="button"
                    onClick={handleSyncLiveDataset}
                    disabled={isSyncingLive}
                    title="Refresh and sync data from live source"
                    className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition-all min-h-[44px]"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingLive ? "animate-spin" : ""}`} aria-hidden="true" />
                    <span>Sync Now</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleReset}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-app-bg hover:brightness-125 text-app-muted text-xs font-medium border border-app-border transition-all min-h-[44px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">New Data</span>
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2 sm:px-6 lg:px-8 py-4 sm:py-6 flex flex-col">
        {!currentDataset ? (
          <div className="space-y-8 py-4 sm:py-8 max-w-4xl mx-auto w-full">
            <div className="text-center max-w-2xl mx-auto space-y-3">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-app-primary/10 border border-app-primary/20 text-app-primary text-xs font-medium">
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Deterministic Ingestion & Live Visual Studio</span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-app-text tracking-tight">
                Connect Data & Build Live Dashboards
              </h1>
              <p className="text-sm sm:text-base text-app-muted leading-relaxed">
                Upload CSV/Excel files, connect live REST APIs, or query PostgreSQL, MySQL, SQLite, and Google BigQuery with automated live sync.
              </p>
            </div>

            <FileUploadZone onUploadSuccess={handleUploadSuccess} />
          </div>
        ) : (
          <div className="space-y-4 flex-1 flex flex-col">
            {/* Top Toolbar Card */}
            <div className="bg-app-surface/60 border border-app-border rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              {/* Dataset & Dashboard Title */}
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center space-x-2">
                  <h2 className="text-base sm:text-lg font-bold text-app-text truncate">
                    {dashboard?.title || `${currentDataset.name} Dashboard`}
                  </h2>
                  {isSyncing && (
                    <span
                      role="status"
                      className="text-[10px] px-2 py-0.5 rounded-full bg-app-primary/10 text-app-primary border border-app-primary/20 animate-pulse font-mono flex-shrink-0"
                    >
                      Syncing...
                    </span>
                  )}
                </div>
                <p className="text-xs text-app-muted truncate">
                  {currentDataset.name} • {currentDataset.rowCount.toLocaleString()} rows • {visuals.length} {visuals.length === 1 ? "visual" : "visuals"} on page
                </p>
              </div>

              {/* Action Buttons & Tabs with touch-friendly hit targets */}
              <div className="flex flex-wrap items-center gap-2">
                {/* View Switcher Tabs */}
                <div role="tablist" aria-label="Dashboard view" className="flex bg-app-bg/80 p-1 rounded-xl border border-app-border">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "canvas"}
                    onClick={() => setActiveTab("canvas")}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
                      activeTab === "canvas"
                        ? "bg-app-primary text-white shadow-sm"
                        : "text-app-muted hover:text-app-text"
                    }`}
                  >
                    <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Canvas</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "profiling"}
                    onClick={() => setActiveTab("profiling")}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
                      activeTab === "profiling"
                        ? "bg-app-primary text-white shadow-sm"
                        : "text-app-muted hover:text-app-text"
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Profiling</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "preview"}
                    onClick={() => setActiveTab("preview")}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
                      activeTab === "preview"
                        ? "bg-app-primary text-white shadow-sm"
                        : "text-app-muted hover:text-app-text"
                    }`}
                  >
                    <TableIcon className="w-3.5 h-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Raw Data</span>
                  </button>
                </div>

                {/* Undo & Redo buttons */}
                <div className="flex items-center space-x-1 bg-app-bg/80 p-1 rounded-xl border border-app-border">
                  <button
                    type="button"
                    onClick={() => undo()}
                    disabled={dashboardState?.appliedCommandCount === 0}
                    aria-label="Undo last edit (Ctrl/Cmd+Z)"
                    title="Undo last edit (Ctrl/Cmd+Z)"
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text disabled:opacity-30 disabled:hover:text-app-muted transition-colors"
                  >
                    <Undo2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => redo()}
                    disabled={(dashboardState?.revertedCommandCount || 0) === 0}
                    aria-label="Redo edit (Ctrl/Cmd+Shift+Z)"
                    title="Redo edit (Ctrl/Cmd+Shift+Z)"
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text disabled:opacity-30 disabled:hover:text-app-muted transition-colors"
                  >
                    <Redo2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <div className="w-px h-6 bg-app-border mx-0.5" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => dashboard?.id && void useHistoryStore.getState().toggle(dashboard.id)}
                    aria-label="Toggle command history"
                    aria-pressed={isHistoryOpen}
                    title="Command history"
                    className="w-10 h-10 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text transition-colors"
                  >
                    <HistoryIcon className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>

                {/* Export current view (PNG) / raw dataset (CSV) */}
                <ExportMenu
                  captureTarget={exportCaptureNode}
                  filenameBase={exportFilenameBase}
                  onExportPng={handleExportPng}
                  onExportCsv={handleExportCsv}
                />

                {/* Prominent + Add Chart button */}
                <button
                  type="button"
                  onClick={() => setIsAddChartOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-app-primary hover:brightness-110 text-white text-xs font-semibold shadow-md transition-all active:scale-[0.98] min-h-[44px]"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Add Chart</span>
                </button>
              </div>
            </div>

            {/* Active View Container — also the PNG export's screenshot target */}
            <div ref={setExportCaptureNode} className="space-y-4 flex-1 flex flex-col">
            {activeTab === "canvas" && (
              <DashboardCanvas
                visuals={visuals}
                sampleRowsByDatasetId={sampleRowsByDatasetId}
                primaryDatasetId={dashboard?.datasetId}
                theme={dashboard?.theme}
                selectedVisualId={selectedVisualId}
                onSelectVisual={handleSelectVisual}
                onMoveVisual={handleMoveVisual}
                onResizeVisual={handleResizeVisual}
                onDeleteVisual={handleDeleteVisual}
                onZIndexChange={handleZIndexChange}
                onOpenAddChart={() => setIsAddChartOpen(true)}
              />
            )}

            {activeTab === "profiling" && (
              <div className="space-y-6">
                <ColumnSummaryPanel
                  dataset={currentDataset}
                  onUpdateColumnType={handleUpdateColumnType}
                />
              </div>
            )}

            {activeTab === "preview" && (
              <DataPreviewTable
                columns={currentDataset.schema}
                rows={sampleRows}
                totalRowCount={currentDataset.rowCount}
              />
            )}
            </div>
          </div>
        )}
      </main>

      {/* Manual Add Chart Modal */}
      <AddChartModal
        isOpen={isAddChartOpen}
        onClose={() => setIsAddChartOpen(false)}
        pageId={activePageId}
        datasetSchema={currentDataset?.schema || []}
        datasets={attachedDatasets.map((d) => ({ id: d.id, name: d.name, schema: d.schema }))}
        defaultDatasetId={dashboard?.datasetId}
        existingVisuals={visuals}
        onSubmit={handleAddChartSubmit}
      />

      {/* Property Editor Drawer — hidden (not deselected) while Chat/History are frontmost */}
      <PropertyEditor
        visual={isPropertiesVisible ? selectedVisual : null}
        datasetSchema={currentDataset?.schema || []}
        datasets={attachedDatasets.map((d) => ({ id: d.id, name: d.name, schema: d.schema }))}
        primaryDatasetId={dashboard?.datasetId}
        onClose={() => setSelectedVisualId(null)}
        onUpdate={handleUpdateVisualProperties}
        onDelete={handleDeleteVisual}
      />

      {/* Manage Datasets — attach/detach additional datasets on this dashboard */}
      <ManageDatasetsPanel
        isOpen={isManageDatasetsOpen}
        onClose={() => setIsManageDatasetsOpen(false)}
        datasets={attachedDatasets}
        primaryDatasetId={dashboard?.datasetId}
        onAttach={handleAttachDataset}
        onDetach={handleDetachDataset}
      />

      {/* AI Chat Panel — floating toggle; full-screen overlay on mobile, side panel on larger screens.
          Its FAB hides while Properties occupies the same bottom-right corner. */}
      <ChatPanel dashboardId={dashboard?.id} selectedVisual={selectedVisual} hideFab={isPropertiesVisible} />

      {/* Command History — opened from the toolbar's history icon */}
      <HistoryPanel dashboardId={dashboard?.id} />
    </div>
  );
};

export default App;
