import { notFound } from "next/navigation";
import { getAgent } from "@/src/runtime/bootstrap";
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
  return <ChatView agentId={id} agentName={agent.name} />;
}
