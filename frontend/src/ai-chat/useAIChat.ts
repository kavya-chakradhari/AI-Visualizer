import { useCallback } from "react";
import type { DashboardState } from "@ai-vis/types";
import { useChatStore } from "./store.js";
import { useDashboardStore } from "../state/index.js";

/**
 * Wires the chat store to the dashboard store: whenever an AI turn actually
 * executes (directly, or via a confirmed pending action), the fresh
 * DashboardState it returns is adopted as the new authoritative state — the
 * same way undo/redo and manual commands already update the canvas.
 */
export function useAIChat(dashboardId: string | undefined) {
  const { messages, isSending, isOpen, openChat, closeChat, toggleChat, sendMessage, confirmPending, cancelPending } =
    useChatStore();

  const onDashboardUpdate = useCallback((state: DashboardState) => {
    useDashboardStore.getState().applyRemoteDashboardState(state);
  }, []);

  const send = useCallback(
    (text: string, selectedVisualId: string | undefined) => {
      if (!dashboardId) return Promise.resolve();
      return sendMessage(dashboardId, text, selectedVisualId, onDashboardUpdate);
    },
    [dashboardId, sendMessage, onDashboardUpdate]
  );

  const confirm = useCallback(
    (messageId: string) => {
      if (!dashboardId) return Promise.resolve();
      return confirmPending(dashboardId, messageId, onDashboardUpdate);
    },
    [dashboardId, confirmPending, onDashboardUpdate]
  );

  return {
    messages,
    isSending,
    isOpen,
    openChat,
    closeChat,
    toggleChat,
    sendMessage: send,
    confirmPending: confirm,
    cancelPending,
  };
}

export default useAIChat;
