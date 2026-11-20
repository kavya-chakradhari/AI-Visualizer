/**
 * Field-hallucination guard.
 *
 * Critical rule: if the user (or the model, on their behalf) references a
 * field or measure that doesn't exist in the dataset, the AI must never
 * invent one. This check is authoritative, not advisory — it re-verifies
 * every field name in every proposed command against the real dataset schema
 * regardless of what the model claims (`clarification_needed: false` does not
 * exempt a command from this check). A model that ignores its instructions
 * can produce a command referencing a made-up field; this guard is what
 * actually stops it from reaching execution.
 */
import type { CommandInput } from "@ai-vis/types";
import type { AIContext } from "./context.js";
import { suggestFieldNames } from "./suggest.js";

export interface FieldGuardResult {
  ok: boolean;
  invalidFields: string[];
  suggestions: Record<string, string[]>;
}

const SINGLE_FIELD_KEYS = [
  "xField",
  "seriesField",
  "colorField",
  "sizeField",
  "labelField",
  "field",
] as const;

function addFilterField(filter: unknown, out: Set<string>): void {
  if (!filter || typeof filter !== "object") return;
  const field = (filter as { field?: unknown }).field;
  if (typeof field === "string" && field) out.add(field);
}

/** Walks a command payload (and any nested `encoding`/`patch`) collecting every field reference it names. */
function collectFieldRefs(payload: unknown, out: Set<string>): void {
  if (!payload || typeof payload !== "object") return;
  const p = payload as Record<string, unknown>;

  for (const key of SINGLE_FIELD_KEYS) {
    if (typeof p[key] === "string" && p[key]) out.add(p[key] as string);
  }

  if (typeof p.yField === "string" && p.yField) {
    out.add(p.yField);
  } else if (Array.isArray(p.yField)) {
    for (const f of p.yField) if (typeof f === "string" && f) out.add(f);
  }

  if (Array.isArray(p.measures)) {
    for (const m of p.measures as { field?: unknown }[]) {
      if (typeof m?.field === "string" && m.field) out.add(m.field);
    }
  }

  addFilterField(p.filter, out);
  if (Array.isArray(p.filters)) {
    for (const f of p.filters) addFilterField(f, out);
  }

  // Field references can also live nested one level down.
  if (p.encoding && typeof p.encoding === "object") collectFieldRefs(p.encoding, out);
  if (p.patch && typeof p.patch === "object") collectFieldRefs(p.patch, out);
}

export function checkFieldReferences(
  commands: CommandInput[],
  context: AIContext
): FieldGuardResult {
  const known = new Set(context.fields.map((f) => f.name.toLowerCase()));

  const invalidFields: string[] = [];
  const suggestions: Record<string, string[]> = {};

  for (const c of commands) {
    // A command that names a specific dataset is checked against only that
    // dataset's fields (stricter — catches a field from the wrong dataset);
    // one with no explicit datasetId falls back to the union of every
    // attached dataset's fields, matching the single-dataset behavior this
    // guard always had.
    const targetDatasetId = (c.payload as { datasetId?: unknown } | undefined)?.datasetId;
    const scopedKnown =
      typeof targetDatasetId === "string" && targetDatasetId
        ? new Set(
            context.fields
              .filter((f) => !f.datasetId || f.datasetId === targetDatasetId)
              .map((f) => f.name.toLowerCase())
          )
        : known;

    const referenced = new Set<string>();
    collectFieldRefs(c.payload, referenced);

    for (const field of referenced) {
      if (scopedKnown.has(field.toLowerCase())) continue;
      if (invalidFields.includes(field)) continue;
      invalidFields.push(field);
      const s = suggestFieldNames(field, context);
      if (s.length > 0) suggestions[field] = s;
    }
  }

  return { ok: invalidFields.length === 0, invalidFields, suggestions };
}

/** Builds the user-facing clarification message for a failed field check. */
export function describeUnknownFields(result: FieldGuardResult): string {
  const parts = result.invalidFields.map((field) => {
    const s = result.suggestions[field];
    return s?.length ? `'${field}' (did you mean: ${s.join(", ")}?)` : `'${field}' (no similar field found)`;
  });
  return `I can't find ${parts.length > 1 ? "these fields" : "this field"} in the dataset: ${parts.join("; ")}. Please choose from the available fields, or tell me which one you meant.`;
}
