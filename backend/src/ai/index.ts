/**
 * AI module — natural language -> structured commands -> the same Validation
 * Engine and transactional execution every manual command uses. This layer
 * never mutates dashboard state directly; see service.ts.
 */
export { processAIMessage, confirmAICommands } from "./service.js";
export type {
  AIProcessResult,
  AIProcessSuccess,
  AIProcessFailure,
  AIProcessOptions,
  AIFailureStage,
} from "./service.js";

export { AIResponseSchema } from "./contract.js";
export type { AIResponse } from "./contract.js";

export type { LLMProvider, GenerateCommandsInput, AIHistoryTurn } from "./provider.js";
export { getLLMProvider } from "./factory.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export { MockProvider } from "./providers/mock.js";

export { buildAIContext } from "./context.js";
export type {
  AIContext,
  AIFieldRole,
  AIFieldSummary,
  AIVisualSummary,
  AISelectedVisual,
  AIThemeSummary,
  ReferenceResolution,
} from "./context.js";

export { checkFieldReferences, describeUnknownFields } from "./guard.js";
export type { FieldGuardResult } from "./guard.js";
export { suggestFieldNames } from "./suggest.js";

export { detectReferenceIntent, resolveReference, describeAmbiguousReference } from "./reference.js";
export type { DetectedReference, ReferencePhrase, ResolveReferenceOptions } from "./reference.js";

export { classifyRequiresConfirmation, describeConfirmationReason } from "./confirmation.js";
export type { ConfirmationClassification, ConfirmationReason } from "./confirmation.js";

export {
  getSessionHistory,
  getLastVisualId,
  recordTurn,
  recordVisualTouch,
  clearLastVisualId,
  clearSession,
} from "./session.js";

export {
  AIProtocolError,
  parseAIResponse,
  runWithJsonRetry,
  extractJsonPayload,
} from "./pipeline.js";
