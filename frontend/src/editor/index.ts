/**
 * Manual property editor panel module.
 * Scaffolding stub.
 */
export interface PropertyEditorState {
  selectedVisualId: string | null;
  activeSection: "data" | "style" | "layout";
}

export const initialEditorState: PropertyEditorState = {
  selectedVisualId: null,
  activeSection: "data",
};
