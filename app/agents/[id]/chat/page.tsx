import { notFound } from "next/navigation";
import { getAgent } from "@/src/runtime/bootstrap";
import { createSession } from "@/src/runtime/chat";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  const { sessionId } = createSession(id);
  // key={sessionId} forces a full remount after router.refresh() on End Session,
  // so useChat picks up the new transport and messages reset cleanly.
  return (
    <ChatView
      key={sessionId}
      agentId={id}
      agentName={agent.name}
      initialSessionId={sessionId}
    />
  );
}
