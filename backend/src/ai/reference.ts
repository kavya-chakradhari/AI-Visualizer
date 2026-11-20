/**
 * Pronoun / demonstrative reference resolution.
 *
 * When a message contains "it", "this chart", "the sales chart", "all
 * charts", or "this page", the AI must know which visual(s) that refers to
 * before it can act. This is resolved deterministically, in this order:
 *
 *   1. the visual explicitly selected in the frontend (if any)
 *   2. the last-created / last-modified visual in this dashboard's session
 *   3. name/type matching against the visuals that currently exist
 *   4. otherwise: ambiguous — the caller must ask the user to specify
 *
 * This runs independently of which LLMProvider is active — the resolution is
 * attached to the context every provider receives (`context.resolvedReference`),
 * and an unresolvable reference is short-circuited into a clarification by the
 * service *before* the provider is even called, so behavior here does not
 * depend on a model choosing to follow instructions.
 */
import type { AIContext, AIVisualSummary, ReferenceResolution } from "./context.js";
import type { VisualKind } from "@ai-vis/types";

export type ReferencePhrase = "all_charts" | "this_page" | "this_chart";

export interface DetectedReference {
  phrase: ReferencePhrase;
  /** The descriptive phrase extracted from "the <descriptor> chart", if any. */
  descriptor?: string;
}

/** Keywords that identify a visual by its kind rather than its title. */
const KIND_KEYWORDS: Record<string, VisualKind> = {
  bar: "bar",
  line: "line",
  area: "area",
  pie: "pie",
  donut: "pie",
  scatter: "scatter",
  table: "table",
  kpi: "kpi",
  scorecard: "kpi",
  textbox: "textbox",
  text: "textbox",
  filter: "filter",
};

/**
 * Scans a message for reference language. Returns `null` when the message
 * doesn't reference anything — the common case, and the signal for the
 * service to skip resolution entirely and proceed as normal.
 */
export function detectReferenceIntent(message: string): DetectedReference | null {
  if (/\ball\s+(?:the\s+)?(?:charts?|visuals?|widgets?)\b/i.test(message)) {
    return { phrase: "all_charts" };
  }

  if (/\b(?:this|the|current)\s+page\b/i.test(message)) {
    return { phrase: "this_page" };
  }

  const named = message.match(/\bthe\s+(?<descriptor>[a-z0-9][\w\s]*?)\s+chart\b/i);
  const descriptor = named?.groups?.descriptor?.trim();
  if (descriptor) {
    return { phrase: "this_chart", descriptor };
  }

  if (
    /\b(?:this|that|the)\s+(?:chart|visual|kpi|widget)\b/i.test(message) ||
    /\bit\b/i.test(message)
  ) {
    return { phrase: "this_chart" };
  }

  return null;
}

interface DescriptorMatch {
  matches: AIVisualSummary[];
  via: "name" | "type";
}

function matchByNameOrType(descriptor: string, visuals: AIVisualSummary[]): DescriptorMatch {
  const term = descriptor.toLowerCase().trim();

  const byTitle = visuals.filter((v) => v.title.toLowerCase().includes(term));
  if (byTitle.length > 0) return { matches: byTitle, via: "name" };

  const kindWord = Object.keys(KIND_KEYWORDS).find((k) => term.includes(k));
  if (kindWord) {
    const kind = KIND_KEYWORDS[kindWord];
    return { matches: visuals.filter((v) => v.kind === kind), via: "type" };
  }

  return { matches: [], via: "name" };
}

function toSingle(
  v: AIVisualSummary,
  pageId: string,
  matchedVia: Extract<ReferenceResolution, { kind: "single" }>["matchedVia"]
): ReferenceResolution {
  return {
    kind: "single",
    visualId: v.id,
    pageId,
    title: v.title,
    visualKind: v.kind,
    layout: v.layout,
    matchedVia,
  };
}

export interface ResolveReferenceOptions {
  /** The visual explicitly selected in the frontend, if any. */
  selectedVisualId?: string;
  /** The dashboard session's last-created/last-modified visual, if any. */
  lastVisualId?: string;
}

export function resolveReference(
  detected: DetectedReference,
  context: AIContext,
  options: ResolveReferenceOptions
): ReferenceResolution {
  if (detected.phrase === "all_charts") {
    return { kind: "all", pageId: context.pageId, visualIds: context.visuals.map((v) => v.id) };
  }
  if (detected.phrase === "this_page" && !detected.descriptor) {
    return { kind: "page", pageId: context.pageId };
  }

  // 1. explicitly selected visual
  if (options.selectedVisualId) {
    const v = context.visuals.find((v) => v.id === options.selectedVisualId);
    if (v) return toSingle(v, context.pageId, "selected");
  }

  // 2. last-created / last-modified visual
  if (options.lastVisualId) {
    const v = context.visuals.find((v) => v.id === options.lastVisualId);
    if (v) return toSingle(v, context.pageId, "last");
  }

  // 3. name/type matching — only meaningful when a descriptor was given
  if (detected.descriptor) {
    const { matches, via } = matchByNameOrType(detected.descriptor, context.visuals);
    if (matches.length === 1) return toSingle(matches[0]!, context.pageId, via);
    return {
      kind: "ambiguous",
      term: detected.descriptor,
      candidates: (matches.length > 0 ? matches : context.visuals).map((v) => v.title),
    };
  }

  // A bare pronoun ("it") with nothing else to anchor it: if there is exactly
  // one visual on the page, there is nothing else it could mean.
  if (context.visuals.length === 1) {
    return toSingle(context.visuals[0]!, context.pageId, "only");
  }

  // 4. still ambiguous
  return {
    kind: "ambiguous",
    term: detected.descriptor ?? "it",
    candidates: context.visuals.map((v) => v.title),
  };
}

/** Builds the user-facing clarification message for an ambiguous reference. */
export function describeAmbiguousReference(resolution: Extract<ReferenceResolution, { kind: "ambiguous" }>): string {
  if (resolution.candidates.length === 0) {
    return `I don't see any charts on this page to refer to as "${resolution.term}". Try creating one first, or select a chart.`;
  }
  return `I'm not sure which chart you mean by "${resolution.term}". Did you mean one of: ${resolution.candidates.join(", ")}? You can also select a chart first.`;
}
