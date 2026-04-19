import { NextResponse } from "next/server";
import { getAgent } from "@/src/runtime/bootstrap";
import { createSession } from "@/src/runtime/chat";
import { getDb } from "@/src/storage/db";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!getAgent(id)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { sessionId } = createSession(id);
  return NextResponse.json({ sessionId });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  type Row = { id: string; status: string; created_at: string; ended_at: string | null };
  const sessions = getDb()
    .prepare<[string], Row>(
      `SELECT id, status, created_at, ended_at FROM sessions
       WHERE agent_id = ? ORDER BY created_at DESC`,
    )
    .all(id);
  return NextResponse.json({ sessions });
}
