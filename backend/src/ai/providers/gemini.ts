/**
 * Google Gemini implementation of LLMProvider.
 *
 * Uses the Gemini REST API (`generativelanguage.googleapis.com`) directly
 * over `fetch` — no vendor SDK required, keeping the dependency tree lean.
 * The API key is read once from `GEMINI_API_KEY` at construction time and
 * used only in the URL query parameter: it is never logged, never embedded
 * in an error message, and never returned to the frontend.
 *
 * Defaults to `gemini-2.5-flash` (fast + capable; great instruction-following).
 * Override with `GEMINI_MODEL=gemini-2.5-pro` for higher accuracy on complex
 * multi-chart requests.
 *
 * Set `AI_PROVIDER=gemini` in the backend environment to activate.
 */
import { runWithJsonRetry } from "../pipeline.js";
import { buildSystemPrompt } from "../prompt.js";
import type { LLMProvider, GenerateCommandsInput, AIHistoryTurn } from "../provider.js";
import type { AIResponse } from "../contract.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-2.5-flash";

/** Gemini generateContent request body (minimal shape, only what we use). */
interface GeminiContent {
  role: "user" | "model";
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  system_instruction: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    maxOutputTokens: number;
  };
}

interface GeminiResponseCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiAPIResponse {
  candidates?: GeminiResponseCandidate[];
  error?: { code: number; message: string; status: string };
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY is not set. Set it in the backend environment to use AI_PROVIDER=gemini."
      );
    }
    this.apiKey = apiKey;
    this.model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  }

  async generateCommands(input: GenerateCommandsInput): Promise<AIResponse> {
    const systemPrompt = buildSystemPrompt(input.context);
    return runWithJsonRetry((retrySuffix) =>
      this.callModel(systemPrompt, input.message, input.history, retrySuffix)
    );
  }

  private async callModel(
    systemPrompt: string,
    message: string,
    history: AIHistoryTurn[] | undefined,
    retrySuffix?: string
  ): Promise<string> {
    const userContent = retrySuffix ? `${message}${retrySuffix}` : message;

    // Build conversation history as Gemini contents array (alternating user/model).
    const historyContents: GeminiContent[] = (history ?? []).map((turn) => ({
      role: turn.role === "user" ? "user" : "model",
      parts: [{ text: turn.content }],
    }));

    const body: GeminiRequest = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        ...historyContents,
        { role: "user", parts: [{ text: userContent }] },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 2048,
      },
    };

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(this.model)}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      // Only expose bounded error body — the URL contains the API key so we
      // never log it; only the response body from the provider is acceptable.
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Gemini API request failed (HTTP ${res.status}): ${errBody.slice(0, 500)}`
      );
    }

    const data = (await res.json()) as GeminiAPIResponse;

    // Surface Gemini's structured error if present in a 200 response.
    if (data.error) {
      throw new Error(
        `Gemini API error ${data.error.code} (${data.error.status}): ${data.error.message.slice(0, 300)}`
      );
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const finishReason = data.candidates?.[0]?.finishReason ?? "unknown";
      throw new Error(
        `Gemini response contained no text content (finishReason: ${finishReason}).`
      );
    }

    return text;
  }
}
