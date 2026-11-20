/**
 * Anthropic (Claude) implementation of LLMProvider.
 *
 * Talks to the Messages API directly over `fetch` — no vendor SDK dependency
 * required. The API key is read once from `ANTHROPIC_API_KEY` at construction
 * time and used only in the request header: it is never logged, never
 * embedded in an error message, and never returned to the frontend.
 */
import { runWithJsonRetry } from "../pipeline.js";
import { buildSystemPrompt } from "../prompt.js";
import type { LLMProvider, GenerateCommandsInput } from "../provider.js";
import type { AIResponse } from "../contract.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-5";
const MAX_TOKENS = 1024;

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicContentBlock[];
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Set it in the backend environment to use AI_PROVIDER=anthropic."
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
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

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      }),
    });

    if (!res.ok) {
      // Bounded excerpt of the provider's error body only — never the request
      // we sent, which carries the key in its headers.
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API request failed (HTTP ${res.status}): ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const text = data.content?.find((block) => block.type === "text")?.text;
    if (!text) {
      throw new Error("Anthropic response contained no text content block.");
    }
    return text;
  }
}
