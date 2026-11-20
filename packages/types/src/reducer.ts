import type {
  Command,
  CommandActionType,
  CommandPayloadMap,
  DimensionSlot,
} from "./command.js";
import { normalizeCommandType } from "./command.js";
import type {
  Dashboard,
  DashboardState,
  Page,
  Visual,
  Layout,
  Style,
  Theme,
  Measure,
  VisualEncoding,
  FilterConfig,
  CalculatedField,
} from "./dashboard.js";
import { DARK_THEME } from "./dashboard.js";

// ─────────────────────────────────────────────
// Universal UUID generator
// ─────────────────────────────────────────────

function generateId(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return "v_" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function now(): string {
  return new Date().toISOString();
}

function defaultLayout(partial?: Partial<Layout>): Layout {
  return {
    x: partial?.x ?? 0,
    y: partial?.y ?? 0,
    width: partial?.width ?? 6,
    height: partial?.height ?? 4,
    zIndex: partial?.zIndex ?? 0,
  };
}

function requirePage(pages: Page[], pageId: string): Page {
  const page = pages.find((p) => p.id === pageId);
  if (!page) {
    throw new Error(`Page '${pageId}' not found in dashboard.`);
  }
  return page;
}

function requireVisualOnPage(page: Page, visualId: string): Visual {
  const visual = page.visuals.find((v) => v.id === visualId);
  if (!visual) {
    throw new Error(`Visual '${visualId}' not found on page '${page.id}'.`);
  }
  return visual;
}

/** Replace one page in the dashboard and bump the version/timestamp. */
function withPage(dashboard: Dashboard, pageId: string, updated: Page): Dashboard {
  const ts = now();
  return {
    ...dashboard,
    pages: dashboard.pages.map((p) => (p.id === pageId ? updated : p)),
    updatedAt: ts,
    version: dashboard.version + 1,
  };
}

/** Replace one visual on one page and bump the version/timestamp. */
function withVisual(
  dashboard: Dashboard,
  pageId: string,
  visualId: string,
  update: (visual: Visual) => Visual
): Dashboard {
  const page = requirePage(dashboard.pages, pageId);
  requireVisualOnPage(page, visualId);
  const ts = now();

  return withPage(dashboard, pageId, {
    ...page,
    visuals: page.visuals.map((v) =>
      v.id === visualId ? { ...update(v), updatedAt: ts } : v
    ),
    updatedAt: ts,
  });
}

/** Shallow-merges a patch onto a base object, dropping keys explicitly set to undefined. */
function shallowMerge<T extends object>(base: T | undefined, patch: Partial<T>): T {
  const merged: T = { ...(base ?? ({} as T)), ...patch };
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (patch[key] === undefined) delete merged[key];
  }
  return merged;
}

/**
 * Merges a theme patch onto a base theme. Mostly a shallow merge, except
 * `fontSizes` and `spacingScale` are merged one level deeper — so patching
 * just the "base" font size doesn't blow away xs/sm/lg/xl/xxl, which a plain
 * shallow merge would (it would replace the whole nested object).
 */
function mergeTheme(base: Theme, patch: Partial<Theme>, replace: boolean): Theme {
  // "replace" resets every OTHER field to the given base first, then applies
  // the patch — but fontSizes/spacingScale still deep-merge either way: a
  // scale is never intentionally left with missing steps.
  const merged = replace ? ({ ...base, ...patch } as Theme) : shallowMerge(base, patch);
  if (patch.fontSizes) merged.fontSizes = { ...base.fontSizes, ...patch.fontSizes };
  if (patch.spacingScale) merged.spacingScale = { ...base.spacingScale, ...patch.spacingScale };
  return merged;
}

/** Which encoding key a CHANGE_DIMENSION slot writes to. */
const DIMENSION_SLOT_KEYS: Record<DimensionSlot, keyof VisualEncoding> = {
  x: "xField",
  y: "yField",
  series: "seriesField",
  color: "colorField",
  size: "sizeField",
  label: "labelField",
};

/**
 * Add a filter to a list, replacing any existing filter on the same field so a
 * field never ends up with two conflicting predicates at the same scope.
 */
function upsertFilter(
  existing: FilterConfig[] | undefined,
  filter: FilterConfig
): FilterConfig[] {
  const rest = (existing ?? []).filter((f) => f.field !== filter.field);
  return [...rest, filter];
}

// ─────────────────────────────────────────────
// Reducer Handlers
// ─────────────────────────────────────────────

type Handler<T extends CommandActionType> = (
  dashboard: Dashboard,
  payload: CommandPayloadMap[T]
) => Dashboard;

const handlers: { [T in CommandActionType]: Handler<T> } = {
  CREATE_VISUAL(dashboard, payload) {
    const page = requirePage(dashboard.pages, payload.pageId);
    const ts = now();
    const visualId = payload.visualId ?? generateId();

    const visual: Visual = {
      id: visualId,
      pageId: payload.pageId,
      datasetId: payload.datasetId ?? dashboard.datasetId,
      title: payload.title,
      kind: payload.kind,
      type: payload.kind,
      layout: defaultLayout(payload.layout),
      encoding: payload.encoding ?? {},
      style: payload.style ?? {},
      filters: [],
      calculatedFields: [],
      createdAt: ts,
      updatedAt: ts,
      ...(payload.kind === "kpi"
        ? { valueField: payload.encoding?.measures?.[0]?.field ?? "" }
        : {}),
      ...(payload.kind === "textbox" ? { content: "" } : {}),
      ...(payload.kind === "filter"
        ? { field: "", filterType: "dropdown" as const }
        : {}),
    } as unknown as Visual;

    const updatedPage: Page = {
      ...page,
      visuals: [...page.visuals, visual],
      updatedAt: ts,
    };

    return {
      ...dashboard,
      pages: dashboard.pages.map((p) => (p.id === payload.pageId ? updatedPage : p)),
      activePageId: dashboard.activePageId ?? payload.pageId,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  UPDATE_VISUAL(dashboard, payload) {
    return withVisual(
      dashboard,
      payload.pageId,
      payload.visualId,
      (v) => ({ ...v, ...payload.patch }) as Visual
    );
  },

  DELETE_VISUAL(dashboard, payload) {
    const page = requirePage(dashboard.pages, payload.pageId);
    requireVisualOnPage(page, payload.visualId);
    const ts = now();

    const updatedPage: Page = {
      ...page,
      visuals: page.visuals.filter((v) => v.id !== payload.visualId),
      updatedAt: ts,
    };

    return {
      ...dashboard,
      pages: dashboard.pages.map((p) => (p.id === payload.pageId ? updatedPage : p)),
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  MOVE_VISUAL(dashboard, payload) {
    return withVisual(dashboard, payload.pageId, payload.visualId, (v) => ({
      ...v,
      layout: { ...v.layout, x: payload.x, y: payload.y },
    }));
  },

  RESIZE_VISUAL(dashboard, payload) {
    return withVisual(dashboard, payload.pageId, payload.visualId, (v) => ({
      ...v,
      layout: { ...v.layout, width: payload.width, height: payload.height },
    }));
  },

  CHANGE_CHART_TYPE(dashboard, payload) {
    return withVisual(
      dashboard,
      payload.pageId,
      payload.visualId,
      (v) =>
        ({
          ...v,
          kind: payload.kind,
          type: payload.kind,
          // A KPI needs a valueField and a textbox needs content; seed them so the
          // converted visual stays structurally valid for its new kind.
          ...(payload.kind === "kpi" && !("valueField" in v)
            ? { valueField: v.encoding?.xField ?? "" }
            : {}),
          ...(payload.kind === "textbox" && !("content" in v) ? { content: "" } : {}),
          ...(payload.kind === "filter" && !("field" in v)
            ? { field: v.encoding?.xField ?? "", filterType: "dropdown" as const }
            : {}),
        }) as Visual
    );
  },

  CHANGE_DIMENSION(dashboard, payload) {
    const key = DIMENSION_SLOT_KEYS[payload.slot ?? "x"];
    return withVisual(dashboard, payload.pageId, payload.visualId, (v) => {
      const encoding: VisualEncoding = { ...v.encoding };
      if (payload.field === null) {
        delete encoding[key];
      } else {
        (encoding[key] as string) = payload.field;
      }
      return { ...v, encoding } as Visual;
    });
  },

  CHANGE_MEASURE(dashboard, payload) {
    return withVisual(dashboard, payload.pageId, payload.visualId, (v) => {
      const measures: Measure[] = [...(v.encoding?.measures ?? [])];
      const index = payload.measureIndex ?? 0;
      const existing = measures[index];

      const next: Measure = {
        field: payload.field,
        aggregation: payload.aggregation ?? existing?.aggregation ?? "sum",
        ...(payload.alias !== undefined
          ? { alias: payload.alias }
          : existing?.alias !== undefined
            ? { alias: existing.alias }
            : {}),
        ...(existing?.formatString !== undefined
          ? { formatString: existing.formatString }
          : {}),
      };

      if (index < measures.length) {
        measures[index] = next;
      } else {
        measures.push(next);
      }

      return { ...v, encoding: { ...v.encoding, measures } } as Visual;
    });
  },

  CHANGE_AGGREGATION(dashboard, payload) {
    return withVisual(dashboard, payload.pageId, payload.visualId, (v) => {
      const existing = v.encoding?.measures ?? [];

      // No measures declared yet: fall back to the visual-level default aggregation
      // so `change_aggregation` still has an observable effect on a simple chart.
      if (existing.length === 0) {
        return {
          ...v,
          encoding: { ...v.encoding, aggregation: payload.aggregation },
        } as Visual;
      }

      const measures = existing.map((m, i) =>
        payload.measureIndex === undefined || payload.measureIndex === i
          ? { ...m, aggregation: payload.aggregation }
          : m
      );

      return { ...v, encoding: { ...v.encoding, measures } } as Visual;
    });
  },

  REORDER_VISUALS(dashboard, payload) {
    const page = requirePage(dashboard.pages, payload.pageId);
    const ts = now();

    const updatedPage: Page = {
      ...page,
      visuals: page.visuals.map((v) => {
        const newLayout = payload.layouts.find((l) => l.visualId === v.id);
        return newLayout ? { ...v, layout: newLayout.layout, updatedAt: ts } : v;
      }),
      updatedAt: ts,
    };

    return {
      ...dashboard,
      pages: dashboard.pages.map((p) => (p.id === payload.pageId ? updatedPage : p)),
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  CREATE_PAGE(dashboard, payload) {
    const ts = now();
    const pageId = payload.pageId ?? generateId();

    const newPage: Page = {
      id: pageId,
      dashboardId: dashboard.id,
      title: payload.title,
      order: dashboard.pages.length,
      layoutConfig: {
        columns: payload.layoutConfig?.columns ?? 12,
        rowHeight: payload.layoutConfig?.rowHeight ?? 50,
        margin: payload.layoutConfig?.margin ?? [10, 10],
      },
      visuals: [],
      createdAt: ts,
      updatedAt: ts,
    };

    return {
      ...dashboard,
      pages: [...dashboard.pages, newPage],
      activePageId: dashboard.pages.length === 0 ? pageId : dashboard.activePageId,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  DELETE_PAGE(dashboard, payload) {
    if (dashboard.pages.length <= 1) {
      throw new Error(
        "Cannot delete the last page of a dashboard. A dashboard must have at least one page."
      );
    }

    const remaining = dashboard.pages.filter((p) => p.id !== payload.pageId);
    if (remaining.length === dashboard.pages.length) {
      throw new Error(`Page '${payload.pageId}' not found.`);
    }

    const ts = now();
    const activePageId =
      dashboard.activePageId === payload.pageId
        ? remaining[0]?.id
        : dashboard.activePageId;

    return {
      ...dashboard,
      pages: remaining.map((p, idx) => ({ ...p, order: idx })),
      activePageId,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  RENAME_PAGE(dashboard, payload) {
    requirePage(dashboard.pages, payload.pageId);
    if (!payload.title?.trim()) {
      throw new Error("Page title cannot be empty.");
    }
    const ts = now();

    return {
      ...dashboard,
      pages: dashboard.pages.map((p) =>
        p.id === payload.pageId ? { ...p, title: payload.title.trim(), updatedAt: ts } : p
      ),
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  REORDER_PAGES(dashboard, payload) {
    if (payload.orderedPageIds.length !== dashboard.pages.length) {
      throw new Error("orderedPageIds must contain all page IDs exactly once.");
    }
    const ts = now();
    const reordered = payload.orderedPageIds.map((id, idx) => {
      const page = requirePage(dashboard.pages, id);
      return { ...page, order: idx, updatedAt: ts };
    });

    return {
      ...dashboard,
      pages: reordered,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  SWITCH_PAGE(dashboard, payload) {
    requirePage(dashboard.pages, payload.pageId);
    return {
      ...dashboard,
      activePageId: payload.pageId,
    };
  },

  UPDATE_DASHBOARD_META(dashboard, payload) {
    const ts = now();
    return {
      ...dashboard,
      ...(payload.title !== undefined && { title: payload.title.trim() }),
      ...(payload.description !== undefined && { description: payload.description }),
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  SET_DATASET(dashboard, payload) {
    const ts = now();
    return {
      ...dashboard,
      datasetId: payload.datasetId,
      datasetIds: dashboard.datasetIds.includes(payload.datasetId)
        ? dashboard.datasetIds
        : [...dashboard.datasetIds, payload.datasetId],
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  ATTACH_DATASET(dashboard, payload) {
    const ts = now();
    const alreadyAttached = dashboard.datasetIds.includes(payload.datasetId);
    return {
      ...dashboard,
      datasetId: dashboard.datasetId ?? payload.datasetId,
      datasetIds: alreadyAttached
        ? dashboard.datasetIds
        : [...dashboard.datasetIds, payload.datasetId],
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  DETACH_DATASET(dashboard, payload) {
    const ts = now();
    const datasetIds = dashboard.datasetIds.filter((id) => id !== payload.datasetId);
    const wasPrimary = dashboard.datasetId === payload.datasetId;
    return {
      ...dashboard,
      datasetId: wasPrimary ? datasetIds[0] : dashboard.datasetId,
      datasetIds,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  SET_THEME(dashboard, payload) {
    const ts = now();
    return {
      ...dashboard,
      theme: payload.theme,
      updatedAt: ts,
      version: dashboard.version + 1,
    };
  },

  CREATE_MEASURE(dashboard, payload) {
    const existing = dashboard.calculatedFields ?? [];
    if (existing.some((f) => f.name === payload.name)) {
      throw new Error(`A measure named '${payload.name}' already exists.`);
    }

    const measure: CalculatedField = {
      name: payload.name,
      expression: payload.expression,
      dataType: payload.dataType ?? "number",
      ...(payload.formatString !== undefined
        ? { formatString: payload.formatString }
        : {}),
    };

    return {
      ...dashboard,
      calculatedFields: [...existing, measure],
      updatedAt: now(),
      version: dashboard.version + 1,
    };
  },

  DELETE_MEASURE(dashboard, payload) {
    const existing = dashboard.calculatedFields ?? [];
    const remaining = existing.filter((f) => f.name !== payload.name);
    if (remaining.length === existing.length) {
      throw new Error(`No measure named '${payload.name}' exists.`);
    }

    return {
      ...dashboard,
      calculatedFields: remaining,
      updatedAt: now(),
      version: dashboard.version + 1,
    };
  },

  /**
   * Scope precisely determines the blast radius, and each is handled by a
   * genuinely different code path rather than one "apply somewhere" branch —
   * that's what makes "visual never touches siblings" and "page never leaks
   * to other pages" true by construction, not by convention:
   *   - "visual": rewrites exactly one visual's `style` — every other visual,
   *     on this page or any other, is untouched (a fresh Page/Dashboard
   *     object is only built for the one page that visual lives on).
   *   - "page": rewrites `style` on every visual CURRENTLY on that one page —
   *     pages are looked up by id, so no other page's `pages` entry is even
   *     read, let alone modified.
   *   - "dashboard": merges into `dashboard.theme` — the whole theme object,
   *     not any single visual or page.
   */
  UPDATE_STYLE(dashboard, payload) {
    const replace = payload.replace ?? false;
    const applyStyle = (base: Style | undefined, patch: Partial<Style>): Style =>
      replace ? { ...patch } : shallowMerge(base, patch);

    switch (payload.scope) {
      case "visual": {
        const patch = payload.style;
        return withVisual(
          dashboard,
          payload.pageId,
          payload.visualId,
          (v) => ({ ...v, style: applyStyle(v.style, patch) }) as Visual
        );
      }
      case "page": {
        const patch = payload.style;
        const page = requirePage(dashboard.pages, payload.pageId);
        const ts = now();
        return withPage(dashboard, page.id, {
          ...page,
          visuals: page.visuals.map((v) => ({ ...v, style: applyStyle(v.style, patch), updatedAt: ts }) as Visual),
          updatedAt: ts,
        });
      }
      case "dashboard": {
        const patch = payload.style;
        const base = dashboard.theme ?? DARK_THEME;
        const theme: Theme = replace ? mergeTheme(DARK_THEME, patch, true) : mergeTheme(base, patch, false);
        return {
          ...dashboard,
          theme,
          updatedAt: now(),
          version: dashboard.version + 1,
        };
      }
    }
  },

  ADD_FILTER(dashboard, payload) {
    switch (payload.scope) {
      case "visual": {
        return withVisual(
          dashboard,
          payload.pageId as string,
          payload.visualId as string,
          (v) => ({ ...v, filters: upsertFilter(v.filters, payload.filter) }) as Visual
        );
      }
      case "page": {
        const page = requirePage(dashboard.pages, payload.pageId as string);
        return withPage(dashboard, page.id, {
          ...page,
          filters: upsertFilter(page.filters, payload.filter),
          updatedAt: now(),
        });
      }
      case "dashboard":
      default:
        return {
          ...dashboard,
          filters: upsertFilter(dashboard.filters, payload.filter),
          updatedAt: now(),
          version: dashboard.version + 1,
        };
    }
  },

  REMOVE_FILTER(dashboard, payload) {
    const drop = (filters: FilterConfig[] | undefined): FilterConfig[] => {
      const remaining = (filters ?? []).filter((f) => f.field !== payload.field);
      if (remaining.length === (filters ?? []).length) {
        throw new Error(
          `No ${payload.scope}-level filter on field '${payload.field}' to remove.`
        );
      }
      return remaining;
    };

    switch (payload.scope) {
      case "visual": {
        return withVisual(
          dashboard,
          payload.pageId as string,
          payload.visualId as string,
          (v) => ({ ...v, filters: drop(v.filters) }) as Visual
        );
      }
      case "page": {
        const page = requirePage(dashboard.pages, payload.pageId as string);
        return withPage(dashboard, page.id, {
          ...page,
          filters: drop(page.filters),
          updatedAt: now(),
        });
      }
      case "dashboard":
      default:
        return {
          ...dashboard,
          filters: drop(dashboard.filters),
          updatedAt: now(),
          version: dashboard.version + 1,
        };
    }
  },

  BATCH_COMMANDS(dashboard, payload) {
    let current = dashboard;
    for (const cmd of payload.commands) {
      current = applyCommandToDashboard(current, cmd);
    }
    return current;
  },

  UNDO(dashboard, _payload) {
    return dashboard;
  },
  REDO(dashboard, _payload) {
    return dashboard;
  },
};

export function applyCommandToDashboard(
  dashboard: Dashboard,
  command: Command
): Dashboard {
  // Accept snake_case aliases (`create_chart`, `change_measure`, …) as well as the
  // canonical UPPER_SNAKE names — both resolve to the same single handler.
  const type = normalizeCommandType(command.type);
  if (!type) {
    throw new Error(`Unknown command type: '${command.type}'.`);
  }
  const handler = handlers[type] as Handler<typeof type>;
  return handler(dashboard, command.payload as CommandPayloadMap[typeof type]);
}

/**
 * Pure reducer function: (DashboardState, Command) -> DashboardState
 * Identical across backend and frontend.
 */
export function applyCommand(state: DashboardState, command: Command): DashboardState {
  const updatedDashboard = applyCommandToDashboard(state.dashboard, command);
  return {
    ...state,
    dashboard: updatedDashboard,
    appliedCommandCount: state.appliedCommandCount + 1,
    revertedCommandCount: 0,
    version: updatedDashboard.version,
  };
}

export function createEmptyDashboard(
  id: string,
  title: string,
  createdById?: string
): Dashboard {
  const ts = now();
  const pageId = generateId();

  return {
    id,
    title,
    pages: [
      {
        id: pageId,
        dashboardId: id,
        title: "Page 1",
        order: 0,
        layoutConfig: { columns: 12, rowHeight: 50, margin: [10, 10] },
        visuals: [],
        createdAt: ts,
        updatedAt: ts,
      },
    ],
    activePageId: pageId,
    datasetIds: [],
    theme: DARK_THEME,
    calculatedFields: [],
    createdById,
    createdAt: ts,
    updatedAt: ts,
    version: 0,
  };
}

export function createEmptyDashboardState(
  id: string,
  title = "New Dashboard",
  createdById?: string
): DashboardState {
  return {
    dashboard: createEmptyDashboard(id, title, createdById),
    commandLogLength: 0,
    appliedCommandCount: 0,
    revertedCommandCount: 0,
    version: 0,
  };
}
