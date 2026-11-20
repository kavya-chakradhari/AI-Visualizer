/**
 * Semantic type detection module: infer column types and semantic categories.
 * Scaffolding stub. Logic to be implemented.
 */
import type { FieldSemanticType } from "@ai-vis/types";

export interface SemanticDetector {
  detectType(sampleValues: unknown[]): FieldSemanticType;
}

export const semanticDetectorStub: SemanticDetector = {
  detectType: () => "unknown",
};
