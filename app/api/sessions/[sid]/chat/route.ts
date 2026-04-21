import { NextResponse } from "next/server";
import { z } from "zod";
import { runChatTurn } from "@/src/runtime/chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  message: z.string().min(1).max(8000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sid: string }> },
) {
  const { sid } = await params;
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid input" }, { status: 400 });
  }
  try {
    const { result } = await runChatTurn({
      sessionId: sid,
      userMessage: parsed.data.message,
    });
    // Stream the assistant's plain text tokens as text/event-stream.
    return result.toUIMessageStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
