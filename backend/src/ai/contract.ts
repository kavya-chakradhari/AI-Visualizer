/**
 * The strict AI output contract.
 *
 * Every LLM response is parsed as JSON and validated against this schema
 * immediately on arrival — nothing downstream (the field-hallucination guard,
 * the Validation Engine, the transaction executor) ever sees a response that
 * hasn't passed this check first.
 *
 * `commands` reuses the exact same envelope schema every manual command is
 * validated against (see commands/schemas.ts): this layer does not define a
 * second, looser command shape for AI output. Per-type payload strictness
 * remains entirely the Validation Engine's job — this contract only pins down
 * the outer AI response envelope.
 */
import { z } from "zod";
import { CommandEnvelopeSchema } from "../commands/schemas.js";

export const AIResponseSchema = z
  .object({
    /** Short phrase describing what the user asked for, e.g. "create_visual". */
    intent: z.string().min(1, "intent is required"),
    /** Proposed commands. Empty when nothing should change (a reply, or a clarification). */
    commands: z.array(CommandEnvelopeSchema),
    /** True only for a destructive or hard-to-reverse change — must be approved before executing. */
    requires_confirmation: z.boolean(),
    /** True when the assistant cannot proceed without asking the user something first. */
    clarification_needed: z.boolean(),
    /** A short, human-readable reply to show the user. */
    message: z.string().min(1, "message is required"),
  })
  .strict();

export type AIResponse = z.infer<typeof AIResponseSchema>;
