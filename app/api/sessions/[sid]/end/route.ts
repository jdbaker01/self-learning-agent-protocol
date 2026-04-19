import { NextResponse } from "next/server";
import { endSession, getSession } from "@/src/runtime/chat";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  if (!getSession(sid)) return NextResponse.json({ error: "not found" }, { status: 404 });
  endSession(sid);
  return NextResponse.json({ ok: true });
}
