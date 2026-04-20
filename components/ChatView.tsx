"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { StateSidebar, type AgentState } from "./StateSidebar";

interface Props {
  agentId: string;
  agentName: string;
  initialSessionId: string;
}

export function ChatView({ agentId, agentName, initialSessionId }: Props) {
  const [sessionId, setSessionId] = useState<string>(initialSessionId);
  const [state, setState] = useState<AgentState | null>(null);
  const [ending, setEnding] = useState(false);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const refreshState = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/state`);
    if (res.ok) {
      const data = await res.json();
      setState(data);
    }
  }, [agentId]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const transport = useMemo(() => {
    return new DefaultChatTransport({
      api: `/api/sessions/${sessionId}/chat`,
      prepareSendMessagesRequest: ({ messages }) => {
        const last = messages[messages.length - 1];
        const text =
          last && "parts" in last
            ? last.parts
                .filter((p) => p.type === "text")
                .map((p) => (p as { text: string }).text)
                .join("")
            : "";
        return { body: { message: text } };
      },
    });
  }, [sessionId]);

  const { messages, sendMessage, status } = useChat({ transport });
  const router = useRouter();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // After a response completes, refresh the sidebar (memory / versions may have changed).
  useEffect(() => {
    if (status === "ready") refreshState();
  }, [status, refreshState]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || status !== "ready") return;
    const text = input.trim();
    setInput("");
    await sendMessage({ text });
  }

  async function onEndSession() {
    setEnding(true);
    await fetch(`/api/sessions/${sessionId}/end`, { method: "POST" });
    // For M1 there's no Learn yet — reload to get a fresh session from the page.
    router.refresh();
    setEnding(false);
  }

  return (
    <div className="grid grid-cols-[1fr_360px] gap-6">
      <div className="flex flex-col h-[calc(100vh-140px)] rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <div>
            <div className="font-medium">{agentName}</div>
            <div className="text-xs text-neutral-500 font-mono">
              session: {sessionId}
            </div>
          </div>
          <button
            onClick={onEndSession}
            disabled={ending}
            className="text-sm rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 disabled:opacity-50"
            title="End the current session and start a new one. Learn (SEPL) wires in here in M2."
          >
            {ending ? "Ending…" : "End session"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-sm text-neutral-500">
              Say hi to your agent.
            </div>
          )}
          {messages.map((m: UIMessage) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        <form onSubmit={onSubmit} className="border-t border-neutral-200 p-3 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message…"
            disabled={status === "submitted" || status === "streaming"}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || status !== "ready"}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {status === "streaming" || status === "submitted" ? "…" : "Send"}
          </button>
        </form>
      </div>

      <StateSidebar state={state} onRefresh={refreshState} />
    </div>
  );
}

function MessageBubble({ message }: { message: UIMessage }) {
  const role = message.role;
  const parts = message.parts ?? [];
  const textParts = parts.filter((p) => p.type === "text") as Array<{ type: "text"; text: string }>;
  const toolParts = parts.filter((p) => p.type.startsWith("tool-"));
  return (
    <div
      className={
        role === "user"
          ? "ml-auto max-w-[80%] rounded-lg bg-blue-600 text-white px-3 py-2 text-sm whitespace-pre-wrap"
          : "mr-auto max-w-[80%] rounded-lg bg-neutral-100 text-neutral-900 px-3 py-2 text-sm whitespace-pre-wrap"
      }
    >
      {textParts.map((p, i) => (
        <div key={i}>{p.text}</div>
      ))}
      {toolParts.length > 0 && (
        <details className="mt-2 text-xs opacity-80">
          <summary className="cursor-pointer select-none">
            {toolParts.length} tool call{toolParts.length === 1 ? "" : "s"}
          </summary>
          <pre className="mt-1 overflow-auto text-[10px] leading-snug">
            {JSON.stringify(toolParts, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
