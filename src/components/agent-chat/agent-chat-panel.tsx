import {
  Bot,
  LoaderCircle,
  MessageCircle,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RagAnswer } from "../../api.ts";

type ChatRole = "assistant" | "user";
type ChatStatus = "complete" | "error" | "pending" | "streaming";

interface ChatMessage {
  content: string;
  evidence: string[];
  id: string;
  mode?: "ai" | "summary";
  notice?: string;
  role: ChatRole;
  status: ChatStatus;
}

interface AgentChatPanelProps {
  ask: (question: string, signal: AbortSignal) => Promise<RagAnswer>;
  className?: string;
  disabled?: boolean;
  onInspectEvidence: () => void;
  scopeLabel: string;
}

const starterPrompts = [
  "What changed in this process recently?",
  "Where does this workflow branch?",
  "Which observations support the main path?",
];

const tokenDelayMs = 22;

export function AgentChatPanel({
  ask,
  className = "",
  disabled = false,
  onInspectEvidence,
  scopeLabel,
}: AgentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      content:
        "I can answer from the current process evidence and keep the thread here while you explore.",
      evidence: [],
      id: "welcome",
      mode: "summary",
      role: "assistant",
      status: "complete",
    },
  ]);
  const [activeResponseId, setActiveResponseId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamTimer = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = activeResponseId !== null;
  const scrollTarget = messages
    .map(
      (message) => `${message.id}:${message.content.length}:${message.status}`
    )
    .join("|");

  const canSend = Boolean(draft.trim()) && !(busy || disabled);
  const statusLabel = useMemo(() => {
    const active = messages.find((message) => message.id === activeResponseId);
    if (active?.status === "pending") {
      return "Reading evidence";
    }
    if (active?.status === "streaming") {
      return "Streaming response";
    }
    return "Ready";
  }, [activeResponseId, messages]);

  useEffect(() => {
    if (!scrollTarget) {
      return;
    }
    scrollRef.current?.scrollTo({
      behavior: "smooth",
      top: scrollRef.current.scrollHeight,
    });
  }, [scrollTarget]);

  useEffect(
    () => () => {
      if (streamTimer.current !== null) {
        window.clearInterval(streamTimer.current);
        streamTimer.current = null;
      }
      abortRef.current?.abort();
    },
    []
  );

  async function submitQuestion(nextQuestion = draft) {
    const question = nextQuestion.trim();
    if (!question || busy || disabled) {
      return;
    }
    stopStream();
    abortRef.current?.abort();
    const userId = messageId("user");
    const responseId = messageId("assistant");
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft("");
    setActiveResponseId(responseId);
    setMessages((current) => [
      ...current,
      {
        content: question,
        evidence: [],
        id: userId,
        role: "user",
        status: "complete",
      },
      {
        content: "",
        evidence: [],
        id: responseId,
        role: "assistant",
        status: "pending",
      },
    ]);
    try {
      const result = await ask(question, controller.signal);
      streamAnswer(responseId, result);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      finishMessage(responseId, {
        content:
          error instanceof Error
            ? error.message
            : "Ariadne could not answer right now.",
        evidence: [],
        mode: "summary",
        notice: "Request failed. Try again.",
        status: "error",
      });
      setActiveResponseId(null);
    }
  }

  function cancelActiveResponse() {
    abortRef.current?.abort();
    stopStream();
    if (activeResponseId) {
      finishMessage(activeResponseId, {
        content: "Response stopped.",
        evidence: [],
        mode: "summary",
        status: "error",
      });
    }
    setActiveResponseId(null);
  }

  function streamAnswer(responseId: string, answer: RagAnswer) {
    const tokens = tokenize(answer.answer);
    let index = 0;
    setMessages((current) =>
      current.map((message) =>
        message.id === responseId
          ? {
              ...message,
              content: "",
              evidence: answer.evidence ?? [],
              mode: answer.mode ?? "ai",
              notice: answer.notice,
              status: "streaming",
            }
          : message
      )
    );
    streamTimer.current = window.setInterval(() => {
      index += 1;
      const nextContent = tokens.slice(0, index).join("");
      setMessages((current) =>
        current.map((message) =>
          message.id === responseId
            ? {
                ...message,
                content: nextContent,
              }
            : message
        )
      );
      if (index >= tokens.length) {
        stopStream();
        finishMessage(responseId, {
          content: answer.answer,
          evidence: answer.evidence ?? [],
          mode: answer.mode ?? "ai",
          notice: answer.notice,
          status: "complete",
        });
        setActiveResponseId(null);
      }
    }, tokenDelayMs);
  }

  function finishMessage(
    responseId: string,
    patch: Pick<
      ChatMessage,
      "content" | "evidence" | "mode" | "notice" | "status"
    >
  ) {
    setMessages((current) =>
      current.map((message) =>
        message.id === responseId
          ? {
              ...message,
              ...patch,
            }
          : message
      )
    );
  }

  function stopStream() {
    if (streamTimer.current !== null) {
      window.clearInterval(streamTimer.current);
      streamTimer.current = null;
    }
  }

  return (
    <section className={`agent-chat-panel ${className}`}>
      <div className="agent-chat-header">
        <span className="assistant-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <h2>Ask Ariadne</h2>
          <p>{scopeLabel}</p>
        </div>
        <span className="chat-status">
          {busy ? <LoaderCircle className="spin" size={13} /> : null}
          {statusLabel}
        </span>
      </div>
      <div aria-live="polite" className="chat-history" ref={scrollRef}>
        {messages.map((message) => (
          <article
            className={`chat-message ${message.role} ${message.status}`}
            key={message.id}
          >
            <span className="chat-avatar">
              {message.role === "assistant" ? (
                <Bot size={14} />
              ) : (
                <UserRound size={14} />
              )}
            </span>
            <div className="chat-bubble">
              <span className="chat-role">
                {message.role === "assistant" ? "Ariadne" : "You"}
                {message.mode ? <small>{message.mode}</small> : null}
              </span>
              {message.notice ? <small>{message.notice}</small> : null}
              <p>
                {message.content ||
                  (message.status === "pending" ? "Reading evidence..." : "")}
                {message.status === "streaming" ? (
                  <span className="stream-cursor" />
                ) : null}
              </p>
              {message.evidence.length > 0 ? (
                <button
                  className="text-link"
                  onClick={onInspectEvidence}
                  type="button"
                >
                  Inspect evidence <MessageCircle size={12} />
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
      {messages.length === 1 ? (
        <div className="chat-prompts">
          {starterPrompts.map((prompt) => (
            <button
              disabled={disabled || busy}
              key={prompt}
              onClick={() => submitQuestion(prompt)}
              type="button"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="question-form chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          submitQuestion();
        }}
      >
        <input
          aria-label="Message Ariadne"
          disabled={disabled}
          maxLength={400}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about this process"
          value={draft}
        />
        {busy ? (
          <button
            aria-label="Stop response"
            onClick={cancelActiveResponse}
            type="button"
          >
            <X size={17} />
          </button>
        ) : (
          <button aria-label="Send message" disabled={!canSend} type="submit">
            <Send size={17} />
          </button>
        )}
      </form>
    </section>
  );
}

function tokenize(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [text];
}

function messageId(prefix: ChatRole) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
