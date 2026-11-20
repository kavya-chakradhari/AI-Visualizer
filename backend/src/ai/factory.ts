/**
 * Resolves the active LLM provider from `AI_PROVIDER`.
 *
 * This is the ONLY place that references a concrete provider class — swapping
 * vendors is a one-line environment variable change, no code changes anywhere
 * else (context assembly, the guard, the Validation Engine, and the API route
 * all depend only on the `LLMProvider` interface).
 *
 * Defaults to the mock provider, so the server and its test suite run with no
 * API key configured. Set one of:
 *   - `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` to use Claude
 *   - `AI_PROVIDER=gemini`    + `GEMINI_API_KEY`    to use Google Gemini
 *   - `AI_PROVIDER=groq`      + `GROQ_API_KEY`      to use Groq
 */
import type { LLMProvider } from "./provider.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { GeminiProvider } from "./providers/gemini.js";
import { GroqProvider } from "./providers/groq.js";
import { MockProvider } from "./providers/mock.js";
import { logger } from "../utils/index.js";

export function getLLMProvider(): LLMProvider {
  const name = (process.env.AI_PROVIDER ?? "mock").trim().toLowerCase();

  switch (name) {
    case "anthropic":
      return new AnthropicProvider();
    case "gemini":
      return new GeminiProvider();
    case "groq":
      return new GroqProvider();
    case "mock":
      return new MockProvider();
    default:
      logger.warn(`[AI] Unknown AI_PROVIDER '${name}' — falling back to the mock provider.`);
      return new MockProvider();
  }
}
