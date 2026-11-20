/**
 * Natural language -> structured commands -> execution.
 *
 * This module never mutates dashboard state itself. It produces commands (via
 * an LLMProvider) and hands them to `dashboardEngine.executeBatch` — the exact
 * same schema -> semantic -> scope -> transaction pipeline every manual UI
 * command runs through (see commands/validator.ts and commands/transaction.ts).
 * There is no separate or looser validation path for AI-originated commands.
 *
 * Two additional guarantees live here, both enforced regardless of what the
 * model does or claims:
 *   - reference resolution ("it", "this chart", "all charts", ...) is resolved
 *     deterministically before the model is even called, and short-circuits
 *     into a clarification if it can't be resolved (see reference.ts);
 *   - confirmation is forced for destructive, dashboard-wide, or bulk (3+
 *     visual) commands regardless of the model's own requires_confirmation
 *     flag (see confirmation.ts).
 */
import { dashboardEngine } from "../state/index.js";
import prisma from "../db/client.js";
import { logger } from "../utils/index.js";
import { buildAIContext, type DatasetSchemaMap } from "./context.js";
import { checkFieldReferences, describeUnknownFields } from "./guard.js";
import { detectReferenceIntent, resolveReference, describeAmbiguousReference } from "./reference.js";
import { classifyRequiresConfirmation, describeConfirmationReason } from "./confirmation.js";
import {
  getSessionHistory,
  getLastVisualId,
  recordTurn,
  recordVisualTouch,
  clearLastVisualId,
} from "./session.js";
import { getLLMProvider } from "./factory.js";
import { AIProtocolError } from "./pipeline.js";
import type { LLMProvider } from "./provider.js";
import type { AIResponse } from "./contract.js";
import type { AIHistoryTurn } from "./provider.js";
import type {
  AIFailureStage,
  AIMessageResult,
  AIMessageSuccess,
  AIMessageFailure,
  ColumnProfile,
  Command,
  CommandInput,
  Dashboard,
  DashboardState,
} from "@ai-vis/types";

// Local names kept for readability within this module and for existing
// imports elsewhere in the backend; these are the shared contract types from
// @ai-vis/types (see packages/types/src/ai.ts) — the frontend consumes the
// exact same shapes.
export type { AIFailureStage };
export type AIProcessSuccess = AIMessageSuccess;
export type AIProcessFailure = AIMessageFailure;
export type AIProcessResult = AIMessageResult;

export interface AIProcessOptions {
  selectedVisualId?: string;
  userId?: string;
  /** Correlates this turn's structured logs (including command execution) with the originating HTTP request. */
  requestId?: string;
  /** Overrides the server-tracked session history — mainly for tests. */
  history?: AIHistoryTurn[];
  /** Override the AI_PROVIDER-resolved provider. Primarily for tests. */
  provider?: LLMProvider;
}

async function loadDatasetSchemas(datasetIds: string[]): Promise<DatasetSchemaMap> {
  const map: DatasetSchemaMap = new Map();
  if (datasetIds.length === 0) return map;

  const records = await prisma.dataset.findMany({
    where: { id: { in: datasetIds } },
    select: { id: true, name: true, schemaJson: true },
  });

  for (const record of records) {
    if (!record.schemaJson) continue;
    try {
      const schema = JSON.parse(record.schemaJson) as ColumnProfile[];
      map.set(record.id, { name: record.name, schema });
    } catch {
      logger.warn(`[AI] Dataset '${record.id}' has unparseable schemaJson; proceeding with no field list.`);
    }
  }
  return map;
}

function clarification(message: string, dashboard: DashboardState): AIProcessSuccess {
  return {
    success: true,
    executed: false,
    requiresConfirmation: false,
    dashboard,
    ai: {
      intent: "clarification",
      commands: [],
      requires_confirmation: false,
      clarification_needed: true,
      message,
    },
  };
}

/**
 * Processes one natural-language turn: resolves any pronoun/demonstrative
 * reference, builds context, asks the provider for commands, guards against
 * hallucinated fields, classifies confirmation, and — if safe and unambiguous
 * — executes through the Validation Engine.
 */
export async function processAIMessage(
  dashboardId: string,
  message: string,
  options: AIProcessOptions = {}
): Promise<AIProcessResult> {
  const state = await dashboardEngine.loadState(dashboardId);
  if (!state) {
    return { success: false, stage: "not_found", message: `Dashboard '${dashboardId}' not found.` };
  }

  recordTurn(dashboardId, "user", message);

  const datasetSchemas = await loadDatasetSchemas(state.dashboard.datasetIds);
  const context = buildAIContext(state, datasetSchemas, options.selectedVisualId);

  // Reference resolution — "it", "this chart", "the sales chart", "all
  // charts", "this page" — happens BEFORE the model is called. An
  // unresolvable reference is a clarification regardless of provider.
  const detected = detectReferenceIntent(message);
  if (detected) {
    const resolution = resolveReference(detected, context, {
      selectedVisualId: options.selectedVisualId,
      lastVisualId: getLastVisualId(dashboardId),
    });
    if (resolution.kind === "ambiguous") {
      const result = clarification(describeAmbiguousReference(resolution), state);
      recordTurn(dashboardId, "assistant", result.ai.message);
      return result;
    }
    context.resolvedReference = resolution;
  }

  let provider: LLMProvider;
  try {
    provider = options.provider ?? getLLMProvider();
  } catch (err) {
    // Misconfiguration (e.g. missing API key) must never crash the request —
    // and the API key itself must never appear in this message.
    logger.error("[AI] Failed to initialize LLM provider:", err instanceof Error ? err.message : err);
    return {
      success: false,
      stage: "provider_error",
      message: "The AI assistant is not configured. Set AI_PROVIDER and its API key on the backend.",
    };
  }

  let response: AIResponse;
  try {
    response = await provider.generateCommands({
      message,
      context,
      history: options.history ?? getSessionHistory(dashboardId),
    });
  } catch (err) {
    if (err instanceof AIProtocolError) {
      logger.warn(
        `[AI] Provider '${provider.name}' returned unparseable output after retry: ${err.message}`
      );
      return {
        success: false,
        stage: "ai_protocol",
        message:
          "The AI assistant returned a response that couldn't be understood. Please rephrase your request and try again.",
      };
    }
    logger.error(`[AI] Provider '${provider.name}' failed:`, err instanceof Error ? err.message : err);
    return {
      success: false,
      stage: "provider_error",
      message: "The AI assistant is currently unavailable. Please try again shortly.",
    };
  }

  // Critical rule, enforced regardless of what the model claims: a command
  // referencing a field that doesn't exist in the dataset must never execute.
  const fieldCheck = checkFieldReferences(response.commands, context);
  if (!fieldCheck.ok) {
    const result = clarification(describeUnknownFields(fieldCheck), state);
    recordTurn(dashboardId, "assistant", result.ai.message);
    return result;
  }

  if (response.clarification_needed) {
    const result: AIProcessSuccess = {
      success: true,
      executed: false,
      requiresConfirmation: false,
      dashboard: state,
      ai: { ...response, commands: [] },
    };
    recordTurn(dashboardId, "assistant", result.ai.message);
    return result;
  }

  if (response.commands.length === 0) {
    // A conversational reply with nothing to change — not a failure.
    recordTurn(dashboardId, "assistant", response.message);
    return { success: true, executed: false, requiresConfirmation: false, dashboard: state, ai: response };
  }

  const classification = classifyRequiresConfirmation(response.commands);
  const requiresConfirmation = response.requires_confirmation || classification.required;

  if (requiresConfirmation) {
    recordTurn(dashboardId, "assistant", response.message);
    return {
      success: true,
      executed: false,
      requiresConfirmation: true,
      confirmationReason: describeConfirmationReason(classification),
      dashboard: state,
      ai: response,
    };
  }

  const result = await executeAIProposedCommands(
    dashboardId,
    response.commands,
    message,
    options.userId,
    response,
    options.requestId
  );
  if (result.success) recordTurn(dashboardId, "assistant", result.ai.message);
  return result;
}

/**
 * Executes a batch of AI-proposed commands the user has explicitly approved
 * (the `requiresConfirmation: true` path from `processAIMessage`). Runs
 * through exactly the same pipeline as the direct auto-execute path.
 */
export async function confirmAICommands(
  dashboardId: string,
  commands: CommandInput[],
  prompt: string | undefined,
  userId?: string,
  requestId?: string
): Promise<AIProcessResult> {
  const state = await dashboardEngine.loadState(dashboardId);
  if (!state) {
    return { success: false, stage: "not_found", message: `Dashboard '${dashboardId}' not found.` };
  }

  const confirmedResponse: AIResponse = {
    intent: "confirmed_action",
    commands,
    requires_confirmation: false,
    clarification_needed: false,
    message: prompt ? `Executed the confirmed action: ${prompt}` : "Executed the confirmed action.",
  };

  const result = await executeAIProposedCommands(
    dashboardId,
    commands,
    prompt,
    userId,
    confirmedResponse,
    requestId
  );
  if (result.success) recordTurn(dashboardId, "assistant", result.ai.message);
  return result;
}

/** Every visual id currently on the dashboard, across all pages. */
function allVisualIds(dashboard: Dashboard): Set<string> {
  const ids = new Set<string>();
  for (const page of dashboard.pages) {
    for (const visual of page.visuals) ids.add(visual.id);
  }
  return ids;
}

/**
 * Updates the session's "last visual" anchor after a successful execution.
 * A delete never becomes the new anchor (there's nothing left to point at);
 * if the batch didn't touch any surviving visual, and the previous anchor no
 * longer exists, it's cleared rather than left dangling.
 */
function syncSessionAfterExecution(dashboardId: string, applied: Command[], dashboard: Dashboard): void {
  const existing = allVisualIds(dashboard);
  let lastTouched: string | undefined;

  for (const command of applied) {
    if (command.type.toUpperCase() === "DELETE_VISUAL") continue;
    const payload = command.payload as Record<string, unknown>;
    if (typeof payload.visualId === "string" && existing.has(payload.visualId)) {
      lastTouched = payload.visualId;
    }
  }

  if (lastTouched) {
    recordVisualTouch(dashboardId, lastTouched);
    return;
  }

  const current = getLastVisualId(dashboardId);
  if (current && !existing.has(current)) clearLastVisualId(dashboardId);
}

async function executeAIProposedCommands(
  dashboardId: string,
  commands: CommandInput[],
  prompt: string | undefined,
  userId: string | undefined,
  response: AIResponse,
  requestId?: string
): Promise<AIProcessResult> {
  const inputs: CommandInput[] = commands.map((c) => ({
    type: c.type,
    payload: c.payload,
    origin: "ai",
    ...(prompt !== undefined ? { prompt } : {}),
  }));

  const outcome = await dashboardEngine.executeBatch(dashboardId, inputs, userId, requestId);

  if (!outcome.success) {
    logger.warn(`[AI] Proposed batch rejected at stage '${outcome.stage}': ${outcome.message}`);
    return { success: false, stage: outcome.stage, message: outcome.message };
  }

  syncSessionAfterExecution(dashboardId, outcome.applied, outcome.dashboard.dashboard);

  return {
    success: true,
    executed: true,
    requiresConfirmation: false,
    ai: response,
    dashboard: outcome.dashboard,
    executedCount: outcome.executedCount,
  };
}
