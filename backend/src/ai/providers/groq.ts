/**
 * Groq implementation of LLMProvider.
 *
 * Groq exposes an OpenAI-compatible chat completions endpoint, so this talks
 * to it directly over `fetch` — no vendor SDK dependency required, mirroring
 * AnthropicProvider's shape exactly. The API key is read once from
 * `GROQ_API_KEY` at construction time and used only in the request header:
 * it is never logged, never embedded in an error message, and never returned
 * to the frontend.
 */
import { runWithJsonRetry } from "../pipeline.js";
import { buildSystemPrompt } from "../prompt.js";
import type { LLMProvider, GenerateCommandsInput } from "../provider.js";
import type { AIResponse } from "../contract.js";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
// This account's key only has access to Groq's reasoning-model lineup
// (gpt-oss / qwen3), not the plain llama-3.x chat models — verified against
// GET /openai/v1/models. gpt-oss-120b is the largest of those available.
// Reasoning models spend part of the token budget "thinking" in a separate
// `message.reasoning` field before the actual `content`; low reasoning
// effort plus a generous max_tokens keeps that from starving the JSON reply.
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const MAX_TOKENS = 2048;

interface GroqChoice {
  message?: { content?: string };
}

interface GroqChatResponse {
  choices?: GroqChoice[];
}

export class GroqProvider implements LLMProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Set it in the backend environment to use AI_PROVIDER=groq."
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  }

  async generateCommands(input: GenerateCommandsInput): Promise<AIResponse> {
    const systemPrompt = buildSystemPrompt(input.context);
    return runWithJsonRetry((retrySuffix) =>
      this.callModel(systemPrompt, input.message, retrySuffix)
    );
  }

  private async callModel(
    systemPrompt: string,
    message: string,
    retrySuffix?: string
  ): Promise<string> {
    const userContent = retrySuffix ? `${message}${retrySuffix}` : message;

    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        reasoning_effort: "low",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      // Bounded excerpt of the provider's error body only — never the request
      // we sent, which carries the key in its headers.
      const body = await res.text().catch(() => "");
      throw new Error(`Groq API request failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as GroqChatResponse;
    const text = data.choices?.[0]?.message?.content;
    if (!text) {
      throw new Error("Groq response contained no message content.");
    }
    return text;
  }
}
