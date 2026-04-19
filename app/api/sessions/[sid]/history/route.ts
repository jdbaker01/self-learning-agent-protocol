import { NextResponse } from "next/server";
import { getSessionHistory, getSession } from "@/src/runtime/chat";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  const session = getSession(sid);
  if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    session: { id: session.id, status: session.status, agentId: session.agent_id },
    messages: getSessionHistory(sid),
  });
}
