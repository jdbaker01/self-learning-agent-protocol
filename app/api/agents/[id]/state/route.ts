import { NextResponse } from "next/server";
import { getAgent } from "@/src/runtime/bootstrap";
import { PromptRegistry } from "@/src/rspl/registries/prompt";
import { AgentPolicyRegistry } from "@/src/rspl/registries/agent";
import { ToolRegistry } from "@/src/rspl/registries/tool";
import { MemoryRegistry } from "@/src/rspl/registries/memory";
import { VersionManager } from "@/src/rspl/infra/versionManager";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) return NextResponse.json({ error: "not found" }, { status: 404 });

  const prompt = PromptRegistry.get(id, "system");
  const policy = AgentPolicyRegistry.get(id, "policy");
  const tools  = ToolRegistry.listTools(id);
  const memories = MemoryRegistry.listMemories(id);
  const lineage = VersionManager.agentLineage(id);

  return NextResponse.json({
    agent,
    prompt: prompt
      ? { version: prompt.version, text: (prompt.impl as { text: string }).text }
      : null,
    policy: policy
      ? { version: policy.version, ...policy.impl as object }
      : null,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      version: t.version,
      implementationRef: (t.impl as { implementationRef: string }).implementationRef,
    })),
    memories: memories.map((m) => ({
      id: m.id,
      version: m.version,
      content: (m.impl as { content: string }).content,
      tags: (m.impl as { tags?: string[] }).tags ?? [],
    })),
    lineage,
  });
}
