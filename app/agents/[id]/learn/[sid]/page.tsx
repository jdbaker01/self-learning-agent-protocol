import { notFound } from "next/navigation";
import { getAgent } from "@/src/runtime/bootstrap";
import { getSession } from "@/src/runtime/chat";
import { LearnStream } from "@/components/LearnStream";

export const dynamic = "force-dynamic";

export default async function LearnPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id, sid } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();
  const session = getSession(sid);
  if (!session || session.agent_id !== id) notFound();

  return (
    <LearnStream
      agentId={id}
      agentName={agent.name}
      sessionId={sid}
      sessionStatus={session.status}
    />
  );
}
