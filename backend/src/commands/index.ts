/**
 * Command module.
 *
 * Exactly ONE state transition engine (the pure reducer in @ai-vis/types) runs
 * on both frontend and backend, and exactly ONE validation pipeline processes
 * every command regardless of whether a person or the AI produced it.
 */
export {
  applyCommand,
  applyCommandToDashboard,
  createEmptyDashboard,
  createEmptyDashboardState,
  normalizeCommandType,
  COMMAND_SCHEMA_VERSION,
  COMMAND_SCOPES,
  COMMAND_TYPE_ALIASES,
} from "@ai-vis/types";

// ── Validation engine ──
export { validateCommand, validateCommandFull, findSuggestions } from "./validator.js";
export type {
  ValidationSuccess,
  ValidationFailure,
  ValidationOutcome,
  ValidationStage,
  ValidationContext,
  ValidationResult,
} from "./validator.js";

// ── Transactional execution ──
export { executeCommandBatch } from "./transaction.js";
export type {
  BatchOutcome,
  BatchSuccess,
  BatchFailure,
  CommandBatchStore,
  ExecuteBatchOptions,
  ExecutionStage,
} from "./transaction.js";

// ── Schemas ──
export * from "./schemas.js";
