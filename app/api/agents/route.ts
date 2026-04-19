import { NextResponse } from "next/server";
import { z } from "zod";
import { createAgentFromDescription, listAgents } from "@/src/runtime/bootstrap";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(10).max(2000),
});

export async function GET() {
  return NextResponse.json({ agents: listAgents() });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { agentId } = await createAgentFromDescription(parsed.data);
    return NextResponse.json({ agentId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("createAgentFromDescription failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
