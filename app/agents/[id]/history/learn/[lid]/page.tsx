import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgent } from "@/src/runtime/bootstrap";
import { getDb } from "@/src/storage/db";
import type {
  Hypothesis,
  Proposal,
  UpdatePromptProposal,
  MemoryProposal,
  ToolProposal,
} from "@/src/sepl/types";

export const dynamic = "force-dynamic";

interface LearnRunRow {
  id: string;
  agent_id: string;
  session_id: string;
  status: string;
  hypotheses: string;
  proposals: string;
  evaluation: string;
  commit_decisions: string;
  created_at: string;
  completed_at: string | null;
}

interface EvalPayload {
  ruleGates?: { passed: boolean; violations: string[] };
  judge?: {
    aggregate: string;
    wins?: {
      candidate: { helpfulness: number; faithfulness: number; format: number };
      baseline: { helpfulness: number; faithfulness: number; format: number };
      tie: { helpfulness: number; faithfulness: number; format: number };
    };
  };
  commit?: boolean;
  reason?: string;
  error?: string;
}

interface CommitDecision {
  committed: boolean;
  promptVersion?: string;
  memoryOps?: Array<{ op: string; memoryId?: string; ok: boolean; error?: string }>;
  toolOps?: Array<{ op: string; toolName?: string; toolId?: string; ok: boolean; error?: string }>;
  reason?: string;
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export default async function LearnRunPage({
  params,
}: {
  params: Promise<{ id: string; lid: string }>;
}) {
  const { id, lid } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();

  const db = getDb();
  const run = db
    .prepare<[string], LearnRunRow>(
      `SELECT id, agent_id, session_id, status, hypotheses, proposals, evaluation, commit_decisions, created_at, completed_at
       FROM learn_runs WHERE id = ?`,
    )
    .get(lid);
  if (!run || run.agent_id !== id) notFound();

  const hypotheses = safeJson<Hypothesis[]>(run.hypotheses, []);
  const proposals = safeJson<Proposal[]>(run.proposals, []);
  const evaluation = safeJson<EvalPayload>(run.evaluation, {});
  const decisions = safeJson<CommitDecision[]>(run.commit_decisions, []);
  const decision = decisions[0];

  const promptP = proposals.find((p): p is UpdatePromptProposal => p.type === "update_prompt");
  const memoryP = proposals.filter((p): p is MemoryProposal =>
    p.type === "write_memory" || p.type === "update_memory" || p.type === "delete_memory",
  );
  const toolP = proposals.filter((p): p is ToolProposal =>
    p.type === "update_tool" || p.type === "create_tool",
  );

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-sm text-neutral-500">
            <Link href={`/agents/${id}/chat`} className="hover:underline">{agent.name}</Link>{" "}
            <span className="font-mono">/ history / learn</span>
          </div>
          <h1 className="text-xl font-semibold mt-1">SEPL run (archived)</h1>
          <div className="mt-1 text-xs text-neutral-500 font-mono">{run.id}</div>
          <div className="text-xs text-neutral-500">
            status: {run.status} · session: <Link href={`/agents/${id}/history/session/${run.session_id}`} className="underline font-mono">{run.session_id}</Link>
            {run.completed_at && <> · completed {new Date(run.completed_at).toLocaleString()}</>}
          </div>
        </div>
        <Link
          href={`/agents/${id}/history`}
          className="text-sm rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50"
        >
          Back to history
        </Link>
      </header>

      {evaluation.error && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-900 px-3 py-2 text-sm">
          Error: {evaluation.error}
        </div>
      )}

      <Section title="Reflect" subtitle={`${hypotheses.length} hypothes${hypotheses.length === 1 ? "is" : "es"}`}>
        {hypotheses.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-2">
            {hypotheses.map((h) => (
              <div key={h.id} className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AreaBadge area={h.area} />
                    <div className="font-medium">{h.issue}</div>
                  </div>
                  <div className="text-xs text-neutral-500 font-mono shrink-0">sev {h.severity.toFixed(2)}</div>
                </div>
                <div className="text-xs text-neutral-500 mt-1">{h.evidence}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Select" subtitle="Proposals">
        {!promptP && memoryP.length === 0 && toolP.length === 0 ? (
          <Empty />
        ) : (
          <div className="space-y-2">
            {promptP && (
              <div className="rounded-md border border-neutral-200 p-3 space-y-1 text-sm">
                <div className="text-xs uppercase tracking-wide text-neutral-500">
                  Prompt proposal · addresses {promptP.addresses.length} hypothes{promptP.addresses.length === 1 ? "is" : "es"}
                </div>
                <div className="text-neutral-700">{promptP.rationale}</div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-neutral-500">new prompt text</summary>
                  <pre className="mt-1 whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-2 font-mono text-[11px]">
                    {promptP.newPromptText}
                  </pre>
                </details>
              </div>
            )}
            {memoryP.map((p, i) => (
              <div key={`m-${i}`} className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-1 text-sm">
                <div className="text-xs uppercase tracking-wide text-amber-700">
                  Memory · {p.type === "write_memory" ? "write" : p.type === "update_memory" ? "update" : "delete"}
                  {"memoryId" in p && ` · ${p.memoryId}`}
                </div>
                <div className="text-neutral-800">
                  {p.type === "delete_memory" ? `delete ${p.memoryId}` : p.content}
                </div>
                <div className="text-xs text-neutral-500">{p.rationale}</div>
              </div>
            ))}
            {toolP.map((p, i) => (
              <div key={`t-${i}`} className="rounded-md border border-violet-200 bg-violet-50/40 p-3 space-y-1 text-sm">
                <div className="text-xs uppercase tracking-wide text-violet-700">
                  Tool · {p.type === "create_tool" ? "create" : "update"}
                  {p.type === "create_tool" ? ` · ${p.name} (impl: ${p.implementationRef})` : ` · ${p.toolName}`}
                </div>
                {p.type === "create_tool" && <div className="text-neutral-800">{p.description}</div>}
                {p.type === "update_tool" && p.description && <div className="text-neutral-800">{p.description}</div>}
                <div className="text-xs text-neutral-500">{p.rationale}</div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Evaluate" subtitle="Rule gates + judge replay">
        {evaluation.ruleGates ? (
          <div className="text-sm space-y-1">
            <div>
              <span className="text-neutral-500">Rule gates:</span>{" "}
              <span className={evaluation.ruleGates.passed ? "text-emerald-700" : "text-red-700"}>
                {evaluation.ruleGates.passed ? "passed" : "failed"}
              </span>
              {evaluation.ruleGates.violations.length > 0 && (
                <ul className="mt-1 text-xs text-red-700 list-disc list-inside">
                  {evaluation.ruleGates.violations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
            </div>
            {evaluation.judge && (
              <div>
                <span className="text-neutral-500">Judge aggregate:</span>{" "}
                <span className="font-mono">{evaluation.judge.aggregate}</span>
                {evaluation.judge.wins && (
                  <div className="text-xs text-neutral-500 mt-1">
                    wins: cand h={evaluation.judge.wins.candidate.helpfulness} f={evaluation.judge.wins.candidate.faithfulness} fmt={evaluation.judge.wins.candidate.format}; base h={evaluation.judge.wins.baseline.helpfulness} f={evaluation.judge.wins.baseline.faithfulness} fmt={evaluation.judge.wins.baseline.format}
                  </div>
                )}
              </div>
            )}
            {evaluation.reason && (
              <div className="text-xs text-neutral-500 mt-1">{evaluation.reason}</div>
            )}
          </div>
        ) : (
          <Empty />
        )}
      </Section>

      <Section title="Commit" subtitle="Accept or reject">
        {!decision ? (
          <Empty />
        ) : (
          <div className="text-sm space-y-1">
            {decision.committed ? (
              <div className="text-emerald-700">
                ✓ Committed{decision.promptVersion ? ` · prompt v${decision.promptVersion}` : ""}
              </div>
            ) : (
              <div className="text-neutral-700">✗ Candidate rejected — no changes applied.</div>
            )}
            {decision.memoryOps && decision.memoryOps.length > 0 && (
              <ul className="text-xs text-neutral-600 mt-1 space-y-0.5">
                {decision.memoryOps.map((o, i) => (
                  <li key={i} className="font-mono">
                    memory.{o.op}{o.memoryId ? ` · ${o.memoryId}` : ""} · {o.ok ? "ok" : `error: ${o.error}`}
                  </li>
                ))}
              </ul>
            )}
            {decision.toolOps && decision.toolOps.length > 0 && (
              <ul className="text-xs text-neutral-600 mt-1 space-y-0.5">
                {decision.toolOps.map((o, i) => (
                  <li key={i} className="font-mono">
                    tool.{o.op}{o.toolName ? ` · ${o.toolName}` : ""} · {o.ok ? "ok" : `error: ${o.error}`}
                  </li>
                ))}
              </ul>
            )}
            {decision.reason && <div className="text-xs text-neutral-500 mt-1">{decision.reason}</div>}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <header className="mb-2">
        <div className="font-medium">{title}</div>
        {subtitle && <div className="text-xs text-neutral-500">{subtitle}</div>}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Empty() {
  return <div className="text-sm text-neutral-500">—</div>;
}

function AreaBadge({ area }: { area: Hypothesis["area"] }) {
  const cls =
    area === "memory"
      ? "bg-amber-100 text-amber-800"
      : area === "tool"
        ? "bg-violet-100 text-violet-800"
        : "bg-blue-100 text-blue-800";
  return <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${cls}`}>{area}</span>;
}
