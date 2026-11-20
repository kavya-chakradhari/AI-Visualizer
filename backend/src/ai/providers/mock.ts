/**
 * Deterministic stand-in for a real LLM.
 *
 * Used as the default provider (no API key required, so the server and its
 * tests run out of the box) and directly in tests, so command-generation
 * tests do not depend on network access or a real model's non-determinism.
 * It follows the same rules real providers are instructed to:
 *   - it never invents a field, asking for clarification instead;
 *   - it uses `context.resolvedReference` (set by the service) to act on
 *     "it" / "this chart" / "all charts" rather than resolving references
 *     itself — that is deliberately not this module's job.
 */
import type { LLMProvider, GenerateCommandsInput } from "../provider.js";
import type { AIResponse } from "../contract.js";
import type { AIContext } from "../context.js";
import { suggestFieldNames } from "../suggest.js";
import type { VisualKind, Layout } from "@ai-vis/types";

const KIND_WORDS = new Set(["bar", "line", "area", "pie", "scatter", "table", "kpi"]);

const CHART_WITH_BY =
  /create\s+(?:a\s+|an\s+)?(?<kind>bar|line|area|pie|scatter|table|kpi)?\s*chart\s+(?:of|for|showing)\s+(?<measure>.+?)\s+by\s+(?<dimension>.+)/i;
const KPI_OR_SCORECARD =
  /create\s+(?:a\s+|an\s+)?(?<term>[\w\s]+?)\s+(?:kpi|scorecard)\b/i;
const SIMPLE_CHART = /create\s+(?:a\s+|an\s+)?(?<term>[\w\s]+?)\s+chart\b/i;

const DELETE_ACTION = /\b(?:delete|remove)\b/i;
const COLOR_ACTION = /\b(?:make|change|set|color|colour)\b/i;
const MOVE_ACTION = /\bmove\b/i;

const COLOR_MAP: Record<string, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  green: "#22c55e",
  purple: "#a855f7",
  orange: "#f97316",
  yellow: "#eab308",
  pink: "#ec4899",
  teal: "#14b8a6",
  gray: "#6b7280",
  grey: "#6b7280",
  black: "#111827",
  white: "#f8fafc",
  indigo: "#6366f1",
  cyan: "#06b6d4",
  amber: "#f59e0b",
};

type MoveDirection = "top" | "bottom" | "left" | "right";

function clean(text: string): string {
  return text.trim().replace(/["'.!?]+$/g, "").trim();
}

function detectColor(message: string): string | undefined {
  if (!COLOR_ACTION.test(message)) return undefined;
  const words = message.toLowerCase().match(/[a-z]+/g) ?? [];
  const match = words.find((w) => w in COLOR_MAP);
  return match ? COLOR_MAP[match] : undefined;
}

function detectMoveDirection(message: string): MoveDirection | undefined {
  if (!MOVE_ACTION.test(message)) return undefined;
  if (/\btop\b/i.test(message)) return "top";
  if (/\bbottom\b/i.test(message)) return "bottom";
  if (/\bleft\b/i.test(message)) return "left";
  if (/\bright\b/i.test(message)) return "right";
  return undefined;
}

function computeMove(direction: MoveDirection, layout: Layout): { x: number; y: number } {
  switch (direction) {
    case "top":
      return { x: layout.x, y: 0 };
    case "left":
      return { x: 0, y: layout.y };
    case "bottom":
      return { x: layout.x, y: layout.y + layout.height };
    case "right":
      return { x: layout.x + layout.width, y: layout.y };
  }
}

export class MockProvider implements LLMProvider {
  readonly name = "mock";

  async generateCommands(input: GenerateCommandsInput): Promise<AIResponse> {
    const { message, context } = input;
    const ref = context.resolvedReference;

    if (ref) {
      const referenced = this.handleReferencedAction(message, ref);
      if (referenced) return referenced;
    }

    return this.handleCreation(message, context);
  }

  /** "delete it" / "make it blue" / "move it to the top" / bulk equivalents over "all charts". */
  private handleReferencedAction(
    message: string,
    ref: NonNullable<AIContext["resolvedReference"]>
  ): AIResponse | null {
    if (ref.kind === "page") return null; // no page-level action verbs implemented in the mock

    const targets = ref.kind === "single" ? [ref] : ref.visualIds.map((visualId) => ({ visualId }));
    if (targets.length === 0) return null;

    if (DELETE_ACTION.test(message)) {
      return {
        intent: "delete_visual",
        commands: targets.map((t) => ({
          type: "delete_visual",
          payload: { pageId: ref.pageId, visualId: t.visualId },
        })),
        requires_confirmation: false, // the confirmation classifier forces this regardless
        clarification_needed: false,
        message:
          targets.length === 1
            ? "Deleting that chart."
            : `Deleting ${targets.length} charts.`,
      };
    }

    const color = detectColor(message);
    if (color) {
      return {
        intent: "update_style",
        commands: targets.map((t) => ({
          type: "update_style",
          payload: { scope: "visual", pageId: ref.pageId, visualId: t.visualId, style: { colors: [color] } },
        })),
        requires_confirmation: false,
        clarification_needed: false,
        message:
          targets.length === 1
            ? "Updated the chart's color."
            : `Updated the color of ${targets.length} charts.`,
      };
    }

    const direction = detectMoveDirection(message);
    if (direction) {
      if (ref.kind !== "single") {
        // Moving a whole set uniformly isn't meaningful without more context from the user.
        return {
          intent: "clarification",
          commands: [],
          requires_confirmation: false,
          clarification_needed: true,
          message: "Which chart would you like to move? Please select one or name it.",
        };
      }
      const { x, y } = computeMove(direction, ref.layout);
      return {
        intent: "move_visual",
        commands: [{ type: "move_visual", payload: { pageId: ref.pageId, visualId: ref.visualId, x, y } }],
        requires_confirmation: false,
        clarification_needed: false,
        message: `Moved the chart to the ${direction}.`,
      };
    }

    return null;
  }

  /** "create a bar chart of Sales by Region" / "create a revenue KPI" / "create a Sales chart". */
  private handleCreation(message: string, context: AIContext): AIResponse {
    const knownFields = context.fields.map((f) => f.name);
    const resolve = (phrase: string): string | undefined => {
      const target = clean(phrase).toLowerCase();
      return knownFields.find((f) => f.toLowerCase() === target);
    };

    const withBy = message.match(CHART_WITH_BY);
    if (withBy?.groups) {
      const kindWord = (withBy.groups.kind ?? "").toLowerCase();
      const kind = (KIND_WORDS.has(kindWord) ? kindWord : "bar") as VisualKind;
      const measureTerm = clean(withBy.groups.measure ?? "");
      const dimensionTerm = clean(withBy.groups.dimension ?? "");
      const measureField = resolve(measureTerm);
      const dimensionField = resolve(dimensionTerm);

      const unresolved = [
        ...(measureField ? [] : [measureTerm]),
        ...(dimensionField ? [] : [dimensionTerm]),
      ];
      if (unresolved.length > 0) return this.clarify(unresolved, context);

      return {
        intent: "create_visual",
        commands: [
          {
            type: "create_chart",
            payload: {
              pageId: context.pageId,
              kind,
              title: `${measureField} by ${dimensionField}`,
              encoding: {
                xField: dimensionField,
                measures: [{ field: measureField, aggregation: "sum" }],
              },
            },
          },
        ],
        requires_confirmation: false,
        clarification_needed: false,
        message: `Created a ${kind} chart of ${measureField} by ${dimensionField}.`,
      };
    }

    const kpi = message.match(KPI_OR_SCORECARD);
    if (kpi?.groups?.term) {
      const term = clean(kpi.groups.term);
      const field = resolve(term);
      if (!field) return this.clarify([term], context);

      return {
        intent: "create_visual",
        commands: [
          {
            type: "create_chart",
            payload: {
              pageId: context.pageId,
              kind: "kpi",
              title: `${field} KPI`,
              encoding: { measures: [{ field, aggregation: "sum" }] },
            },
          },
        ],
        requires_confirmation: false,
        clarification_needed: false,
        message: `Created a ${field} KPI.`,
      };
    }

    const simple = message.match(SIMPLE_CHART);
    if (simple?.groups?.term) {
      const term = clean(simple.groups.term);

      if (KIND_WORDS.has(term.toLowerCase())) {
        return {
          intent: "clarification",
          commands: [],
          requires_confirmation: false,
          clarification_needed: true,
          message: "Which field would you like this chart to show?",
        };
      }

      const field = resolve(term);
      if (!field) return this.clarify([term], context);

      return {
        intent: "create_visual",
        commands: [
          {
            type: "create_chart",
            payload: {
              pageId: context.pageId,
              kind: "bar",
              title: field,
              encoding: { measures: [{ field, aggregation: "sum" }] },
            },
          },
        ],
        requires_confirmation: false,
        clarification_needed: false,
        message: `Created a chart of ${field}.`,
      };
    }

    return {
      intent: "unknown",
      commands: [],
      requires_confirmation: false,
      clarification_needed: true,
      message:
        'I\'m not sure how to do that yet. Try something like "create a bar chart of Sales by Region".',
    };
  }

  private clarify(terms: string[], context: AIContext): AIResponse {
    const parts = terms.map((t) => {
      const s = suggestFieldNames(t, context);
      return s.length > 0 ? `'${t}' (did you mean: ${s.join(", ")}?)` : `'${t}'`;
    });
    return {
      intent: "clarification",
      commands: [],
      requires_confirmation: false,
      clarification_needed: true,
      message: `I couldn't find ${parts.length > 1 ? "these fields" : "this field"} in the dataset: ${parts.join("; ")}.`,
    };
  }
}
