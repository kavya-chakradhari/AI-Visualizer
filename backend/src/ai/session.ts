/**
 * Conversation session store — one per dashboard.
 *
 * Keeps the last N turns of chat text (for a real LLM's benefit — mirrors the
 * pattern already used by `dashboardEngine`'s in-memory cache, keyed by
 * dashboardId) and the id of the last visual created or modified in this
 * dashboard, which is the primary anchor for resolving "it" / "this chart".
 *
 * In-memory and per-process, matching the rest of this codebase's dev-scope
 * caching (see dashboardEngine.cache): a restart clears it. That's acceptable
 * here — a lost "last visual" anchor degrades gracefully to a clarification
 * question, it never causes an incorrect command to execute.
 */
import type { AIHistoryTurn } from "./provider.js";

interface ConversationTurn extends AIHistoryTurn {
  timestamp: string;
}

interface ConversationSession {
  dashboardId: string;
  turns: ConversationTurn[];
  lastVisualId?: string;
  updatedAt: string;
}

/** Turns kept per session — roughly the last 10 user/assistant exchanges. */
const MAX_TURNS = 20;

const sessions = new Map<string, ConversationSession>();

function getOrCreateSession(dashboardId: string): ConversationSession {
  let session = sessions.get(dashboardId);
  if (!session) {
    session = { dashboardId, turns: [], updatedAt: new Date().toISOString() };
    sessions.set(dashboardId, session);
  }
  return session;
}

/** Conversation history for this dashboard, oldest first, as the LLMProvider interface expects. */
export function getSessionHistory(dashboardId: string): AIHistoryTurn[] {
  return getOrCreateSession(dashboardId).turns.map(({ role, content }) => ({ role, content }));
}

export function getLastVisualId(dashboardId: string): string | undefined {
  return sessions.get(dashboardId)?.lastVisualId;
}

export function recordTurn(dashboardId: string, role: "user" | "assistant", content: string): void {
  const session = getOrCreateSession(dashboardId);
  session.turns.push({ role, content, timestamp: new Date().toISOString() });
  if (session.turns.length > MAX_TURNS) {
    session.turns.splice(0, session.turns.length - MAX_TURNS);
  }
  session.updatedAt = new Date().toISOString();
}

export function recordVisualTouch(dashboardId: string, visualId: string): void {
  const session = getOrCreateSession(dashboardId);
  session.lastVisualId = visualId;
  session.updatedAt = new Date().toISOString();
}

/** Stops anchoring future "it"/"this chart" references to a visual that no longer exists. */
export function clearLastVisualId(dashboardId: string): void {
  const session = sessions.get(dashboardId);
  if (session) session.lastVisualId = undefined;
}

/** Test/dev helper: wipe a dashboard's conversation session entirely. */
export function clearSession(dashboardId: string): void {
  sessions.delete(dashboardId);
}
