/**
 * Shared AI conversation types — the contract between the AI layer's HTTP
 * responses (backend/src/api/ai.ts) and anything that consumes them
 * (currently the frontend chat panel). Kept in the shared package so neither
 * side re-declares this shape by hand.
 */
import type { CommandInput } from "./command.js";
import type { DashboardState } from "./dashboard.js";

/** The strict AI output contract — see backend/src/ai/contract.ts for the runtime (zod) source of truth. */
export interface AIResponse {
  intent: string;
  commands: CommandInput[];
  requires_confirmation: boolean;
  clarification_needed: boolean;
  message: string;
}

export type AIFailureStage =
  | "not_found"
  | "provider_error"
  | "ai_protocol"
  | "schema"
  | "semantic"
  | "scope"
  | "execution"
  | "persistence";

export interface AIMessageSuccess {
  success: true;
  /** True once the proposed commands were actually applied and persisted. */
  executed: boolean;
  /** True when a destructive/broad change is waiting on user approval via /ai/confirm. */
  requiresConfirmation: boolean;
  /** Human-readable reason confirmation was required, for the confirmation card. */
  confirmationReason?: string;
  ai: AIResponse;
  dashboard: DashboardState;
  executedCount?: number;
}

export interface AIMessageFailure {
  success: false;
  stage: AIFailureStage;
  message: string;
}

export type AIMessageResult = AIMessageSuccess | AIMessageFailure;
