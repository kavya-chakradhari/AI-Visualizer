import React, { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Send,
  MessageSquare,
  MousePointerClick,
  Loader2,
} from "lucide-react";
import clsx from "clsx";
import type { Visual } from "@ai-vis/types";
import { useAIChat } from "./useAIChat.js";
import { ConfirmationCard } from "./ConfirmationCard.js";
import type { ChatMessage } from "./store.js";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

const MessageBubble: React.FC<{
  message: ChatMessage;
  isBusy: boolean;
  onApply: (id: string) => void;
  onCancel: (id: string) => void;
}> = ({ message, isBusy, onApply, onCancel }) => {
  const isUser = message.sender === "user";
  const isSystem = message.sender === "system";

  return (
    <div className={clsx("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser && "bg-app-primary text-white rounded-br-sm",
          !isUser && !isSystem && "bg-app-surface text-app-text rounded-bl-sm border border-app-border/60",
          isSystem && "bg-app-danger/10 text-app-danger border border-app-danger/30 text-xs"
        )}
      >
        {message.text}
      </div>
      <span className="text-[10px] text-app-muted mt-1 px-1">{formatTime(message.timestamp)}</span>

      {message.pendingConfirmation && (
        <div className="w-full max-w-[85%]">
          <ConfirmationCard
            pending={message.pendingConfirmation}
            isBusy={isBusy}
            onApply={() => onApply(message.id)}
            onCancel={() => onCancel(message.id)}
          />
        </div>
      )}
    </div>
  );
};

export interface ChatPanelProps {
  dashboardId: string | undefined;
  /** The visual currently selected on the canvas — shown in the header so the
   * user knows what "it" / "this chart" will resolve to. */
  selectedVisual: Visual | null;
  /**
   * True while another fixed overlay (currently: the Properties panel) is
   * occupying the same bottom-right corner as the floating toggle. The FAB is
   * hidden rather than left showing-but-unclickable underneath that panel —
   * a control a user can see but can't actually click is worse than no
   * control at all.
   */
  hideFab?: boolean;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ dashboardId, selectedVisual, hideFab = false }) => {
  const {
    messages,
    isSending,
    isOpen,
    openChat,
    closeChat,
    sendMessage,
    confirmPending,
    cancelPending,
  } = useAIChat(dashboardId);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSend = () => {
    const text = draft.trim();
    if (!text || isSending) return;
    setDraft("");
    void sendMessage(text, selectedVisual?.id);
  };

  return (
    <>
      {/* Floating toggle — hidden while the panel is open (so it never overlaps
          the close button) or while another overlay covers this corner. */}
      {!isOpen && !hideFab && (
        <button
          type="button"
          onClick={openChat}
          aria-label="Open AI assistant"
          className="fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full bg-gradient-to-tr from-app-primary to-app-secondary text-white shadow-xl flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        >
          <MessageSquare className="w-6 h-6" aria-hidden="true" />
        </button>
      )}

      {/* Backdrop on mobile only, so tapping outside closes the full-screen overlay. */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 sm:hidden"
          onClick={closeChat}
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "fixed z-40 flex flex-col bg-app-bg shadow-2xl transition-transform duration-200 ease-out",
          // Mobile: full-screen overlay. sm+: a right-anchored panel below the header, not squeezing the canvas.
          "inset-0 sm:inset-auto sm:top-16 sm:bottom-0 sm:right-0 sm:w-[400px] sm:border-l sm:border-app-border",
          isOpen ? "translate-x-0" : "translate-x-full pointer-events-none sm:pointer-events-none"
        )}
        role="dialog"
        aria-modal="true"
        aria-label="AI assistant"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 h-16 border-b border-app-border flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-app-primary to-app-secondary flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-app-text leading-tight">AI Assistant</p>
              <p className="text-[11px] text-app-muted flex items-center gap-1 truncate">
                {selectedVisual ? (
                  <>
                    <MousePointerClick className="w-3 h-3 flex-shrink-0 text-app-primary" aria-hidden="true" />
                    <span className="truncate">
                      Editing: <span className="text-app-text font-medium">{selectedVisual.title}</span>
                    </span>
                  </>
                ) : (
                  <span className="italic">Nothing selected — I'll infer "it" from context</span>
                )}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeChat}
            aria-label="Close AI assistant"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-app-muted hover:text-app-text hover:bg-app-surface transition-colors flex-shrink-0"
          >
            <X className="w-4.5 h-4.5" aria-hidden="true" />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isBusy={isSending}
              onApply={(id) => void confirmPending(id)}
              onCancel={cancelPending}
            />
          ))}
          {isSending && (
            <div className="flex items-center gap-2 text-app-muted text-xs">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              <span>Thinking…</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-app-border flex-shrink-0">
          <div className="flex items-center gap-2 bg-app-surface border border-app-border rounded-xl px-3 py-1.5 focus-within:border-app-primary transition-colors">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              aria-label="Message to AI assistant"
              placeholder={dashboardId ? "Ask me to build or edit a chart…" : "Upload a dataset first"}
              disabled={!dashboardId || isSending}
              className="flex-1 bg-transparent text-sm text-app-text placeholder:text-app-muted py-2 outline-none disabled:opacity-50 min-h-[44px]"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!dashboardId || isSending || !draft.trim()}
              aria-label="Send message"
              className="w-9 h-9 flex items-center justify-center rounded-lg bg-app-primary hover:brightness-110 text-white disabled:opacity-30 transition-colors flex-shrink-0"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default ChatPanel;
