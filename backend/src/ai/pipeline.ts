/**
 * Turns a raw LLM completion into a validated AIResponse, with exactly one
 * retry when the first attempt cannot be parsed.
 *
 * This module is provider-agnostic: it operates on a `callModel` callback, so
 * every concrete LLMProvider gets identical parse/validate/retry behaviour for
 * free instead of re-implementing it.
 */
import { AIResponseSchema, type AIResponse } from "./contract.js";

/**
 * Thrown when the model's raw output could not be turned into a valid
 * AIResponse even after one retry with a stricter instruction. Callers MUST
 * catch this and fail gracefully — it must never surface as an unhandled 500
 * or crash the process.
 */
export class AIProtocolError extends Error {
  constructor(
    message: string,
    /** Raw text returned on each attempt, kept for logging/debugging only. */
    public readonly attempts: string[]
  ) {
    super(message);
    this.name = "AIProtocolError";
  }
}

/** Strips a ```json ... ``` (or bare ```) fence if the model wrapped its output in one. */
export function extractJsonPayload(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1]! : trimmed).trim();
}

/** Parse + validate a single attempt. Throws a plain `Error` describing what was wrong. */
export function parseAIResponse(raw: string): AIResponse {
  let json: unknown;
  try {
    json = JSON.parse(extractJsonPayload(raw));
  } catch (err) {
    throw new Error(
      `response is not valid JSON (${err instanceof Error ? err.message : String(err)})`
    );
  }

  const result = AIResponseSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.map(String).join(".") || "_root"}: ${i.message}`)
      .join("; ");
    throw new Error(`response does not match the AI output contract (${issues})`);
  }

  return result.data;
}

export const STRICT_JSON_RETRY_SUFFIX =
  "\n\nYour previous response could not be parsed. Reply again with ONLY a single valid JSON object exactly matching the required schema — no markdown code fences, no explanation, no text before or after the JSON.";

const MAX_ATTEMPTS = 2;

/**
 * Calls the model, validates its output against the AI contract, and retries
 * exactly once with a stricter "JSON only" instruction if the first attempt
 * cannot be parsed. Fails with `AIProtocolError` — never an opaque or generic
 * error — if the second attempt is also unusable.
 */
export async function runWithJsonRetry(
  callModel: (retrySuffix?: string) => Promise<string>
): Promise<AIResponse> {
  const attempts: string[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const raw = await callModel(attempt === 0 ? undefined : STRICT_JSON_RETRY_SUFFIX);
    attempts.push(raw);
    try {
      return parseAIResponse(raw);
    } catch (err) {
      lastError = err;
    }
  }

  throw new AIProtocolError(
    `The AI provider returned output that could not be parsed after ${attempts.length} attempt(s): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    attempts
  );
}
