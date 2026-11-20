/**
 * AI conversational chat panel module: message list, confirmation cards, and
 * the store/hook wiring that keeps chat state and dashboard state in sync.
 */
export { ChatPanel } from "./ChatPanel.js";
export { ConfirmationCard } from "./ConfirmationCard.js";
export { useAIChat } from "./useAIChat.js";
export { useChatStore } from "./store.js";
export type { ChatMessage, PendingConfirmation } from "./store.js";
