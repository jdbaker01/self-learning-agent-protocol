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
  return <ChatView agentId={id} agentName={agent.name} initialSessionId={sessionId} />;
}
