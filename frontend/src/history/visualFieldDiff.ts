import type { Visual } from "@ai-vis/types";

export interface FieldChange {
  label: string;
  before: string;
  after: string;
}

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.map(fmt).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Compares a small, curated set of user-visible fields — not a generic deep diff. */
export function diffVisualFields(before: Visual | null, after: Visual | null): FieldChange[] {
  const changes: FieldChange[] = [];

  const compare = (label: string, beforeValue: unknown, afterValue: unknown) => {
    const b = fmt(beforeValue);
    const a = fmt(afterValue);
    if (b !== a) changes.push({ label, before: b, after: a });
  };

  compare("Title", before?.title, after?.title);
  compare("Type", before?.kind, after?.kind);
  compare("Position", before && `${before.layout.x}, ${before.layout.y}`, after && `${after.layout.x}, ${after.layout.y}`);
  compare("Size", before && `${before.layout.width}×${before.layout.height}`, after && `${after.layout.width}×${after.layout.height}`);
  compare("X field", before?.encoding.xField, after?.encoding.xField);
  compare("Y field", before?.encoding.yField, after?.encoding.yField);
  compare("Series field", before?.encoding.seriesField, after?.encoding.seriesField);
  compare("Measures", before?.encoding.measures, after?.encoding.measures);
  compare("Colors", before?.style.colors, after?.style.colors);
  compare("Background", before?.style.background, after?.style.background);

  return changes;
}
