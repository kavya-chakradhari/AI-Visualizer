/**
 * Provider-agnostic LLM adapter.
 *
 * Swapping the concrete vendor (Anthropic, OpenAI, ...) is a single
 * `AI_PROVIDER` environment variable change — see factory.ts, the only module
 * that references a concrete provider class. Nothing else in the codebase
 * (context assembly, the guard, the Validation Engine, the API route) knows
 * or cares which vendor is behind this interface.
 */
import type { AIContext } from "./context.js";
import type { AIResponse } from "./contract.js";

export interface AIHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateCommandsInput {
  /** The user's natural-language message. */
  message: string;
  /** Compact context assembled by buildAIContext — never the raw dataset. */
  context: AIContext;
  /** Prior turns in this conversation, oldest first. Optional. */
  history?: AIHistoryTurn[];
}

export interface LLMProvider {
  readonly name: string;
  generateCommands(input: GenerateCommandsInput): Promise<AIResponse>;
}
