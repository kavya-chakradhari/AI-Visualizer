import { create } from "zustand";
import type { CommandInput, DashboardState } from "@ai-vis/types";
import { sendAIMessage, confirmAICommands } from "../api/ai.js";

export interface PendingConfirmation {
  commands: CommandInput[];
  prompt?: string;
  reason?: string;
  status: "pending" | "applied" | "cancelled" | "failed";
  /** Set only once status becomes "failed" — shown inline on the card. */
  errorMessage?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "ai" | "system";
  text: string;
  timestamp: string;
  /** Present on an AI message whose commands need explicit approval. */
  pendingConfirmation?: PendingConfirmation;
}

function makeId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: "welcome",
  sender: "ai",
  text: 'Ask me to build or edit your dashboard — try "create a bar chart of Sales by Region".',
  timestamp: new Date().toISOString(),
};

interface ChatStoreState {
  messages: ChatMessage[];
  isSending: boolean;
  isOpen: boolean;

  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;

  /**
   * Sends one turn. `onDashboardUpdate` is called with the fresh
   * DashboardState whenever the AI actually executed something — the chat
   * store never touches dashboard state directly, keeping the two stores
   * decoupled.
   */
  sendMessage: (
    dashboardId: string,
    text: string,
    selectedVisualId: string | undefined,
    onDashboardUpdate: (state: DashboardState) => void
  ) => Promise<void>;

  confirmPending: (
    dashboardId: string,
    messageId: string,
    onDashboardUpdate: (state: DashboardState) => void
  ) => Promise<void>;

  cancelPending: (messageId: string) => void;

  reset: () => void;
}

export const useChatStore = create<ChatStoreState>((set, get) => ({
  messages: [WELCOME_MESSAGE],
  isSending: false,
  isOpen: false,

  openChat: () => set({ isOpen: true }),
  closeChat: () => set({ isOpen: false }),
  toggleChat: () => set((s) => ({ isOpen: !s.isOpen })),

  sendMessage: async (dashboardId, text, selectedVisualId, onDashboardUpdate) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: makeId(),
      sender: "user",
      text: trimmed,
      timestamp: new Date().toISOString(),
    };
    set((s) => ({ messages: [...s.messages, userMessage], isSending: true }));

    try {
      const result = await sendAIMessage(dashboardId, trimmed, { selectedVisualId });

      if (!result.success) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: makeId(),
              sender: "system",
              text: result.message,
              timestamp: new Date().toISOString(),
            },
          ],
          isSending: false,
        }));
        return;
      }

      if (result.executed) {
        onDashboardUpdate(result.dashboard);
      }

      const aiMessage: ChatMessage = {
        id: makeId(),
        sender: "ai",
        text: result.ai.message,
        timestamp: new Date().toISOString(),
        ...(result.requiresConfirmation
          ? {
              pendingConfirmation: {
                commands: result.ai.commands,
                prompt: trimmed,
                reason: result.confirmationReason,
                status: "pending" as const,
              },
            }
          : {}),
      };

      set((s) => ({ messages: [...s.messages, aiMessage], isSending: false }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong talking to the AI assistant.";
      set((s) => ({
        messages: [
          ...s.messages,
          { id: makeId(), sender: "system", text: msg, timestamp: new Date().toISOString() },
        ],
        isSending: false,
      }));
    }
  },

  confirmPending: async (dashboardId, messageId, onDashboardUpdate) => {
    const target = get().messages.find((m) => m.id === messageId);
    if (!target?.pendingConfirmation || target.pendingConfirmation.status !== "pending") return;

    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.pendingConfirmation
          ? { ...m, pendingConfirmation: { ...m.pendingConfirmation, status: "applied" } }
          : m
      ),
      isSending: true,
    }));

    try {
      const result = await confirmAICommands(
        dashboardId,
        target.pendingConfirmation.commands,
        target.pendingConfirmation.prompt
      );

      if (!result.success) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === messageId && m.pendingConfirmation
              ? {
                  ...m,
                  pendingConfirmation: {
                    ...m.pendingConfirmation,
                    status: "failed",
                    errorMessage: result.message,
                  },
                }
              : m
          ),
          isSending: false,
        }));
        return;
      }

      onDashboardUpdate(result.dashboard);
      set((s) => ({
        messages: [
          ...s.messages,
          { id: makeId(), sender: "ai", text: result.ai.message, timestamp: new Date().toISOString() },
        ],
        isSending: false,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to apply the confirmed action.";
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === messageId && m.pendingConfirmation
            ? { ...m, pendingConfirmation: { ...m.pendingConfirmation, status: "failed", errorMessage: msg } }
            : m
        ),
        isSending: false,
      }));
    }
  },

  cancelPending: (messageId) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === messageId && m.pendingConfirmation
          ? { ...m, pendingConfirmation: { ...m.pendingConfirmation, status: "cancelled" } }
          : m
      ),
    }));
  },

  reset: () => set({ messages: [WELCOME_MESSAGE], isSending: false }),
}));
