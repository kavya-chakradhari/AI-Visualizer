/**
 * Suggests real field names for a term the user or model mentioned that does
 * not exist in the dataset.
 *
 * Prefers spelling-close matches (Levenshtein, shared with the Validation
 * Engine). When nothing is textually close — "revenue" vs "Sales" are not
 * close spellings, but a user asking for one very plausibly means the other —
 * falls back to fields that play the same likely role, so a same-shaped real
 * alternative is offered instead of an empty suggestion list.
 */
import { findSuggestions } from "../commands/validator.js";
import type { AIContext, AIFieldRole } from "./context.js";

const MEASURE_KEYWORDS =
  /(revenue|sales|price|cost|amount|spend|budget|profit|margin|total|earnings|units|quantity|count|value|income)/i;
const DIMENSION_KEYWORDS =
  /(region|category|country|segment|status|type|name|channel|department|group|state|city|product)/i;

function guessRole(term: string): AIFieldRole {
  if (MEASURE_KEYWORDS.test(term)) return "measure";
  if (DIMENSION_KEYWORDS.test(term)) return "dimension";
  return "unknown";
}

export function suggestFieldNames(term: string, context: AIContext): string[] {
  const knownNames = context.fields.map((f) => f.name);
  const close = findSuggestions(term, knownNames);
  if (close.length > 0) return close;

  const role = guessRole(term);
  if (role === "unknown") return [];

  return context.fields
    .filter((f) => f.role === role)
    .map((f) => f.name)
    .slice(0, 5);
}
