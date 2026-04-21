"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LearnEvent,
  Hypothesis,
  UpdatePromptProposal,
  MemoryProposal,
} from "@/src/sepl/types";

interface Props {
  agentId: string;
  agentName: string;
  sessionId: string;
  sessionStatus: string;
}

type Stage = "idle" | "reflect" | "select" | "improve" | "evaluate" | "commit" | "done" | "error";

interface EvalSummary {
  ruleGatesPassed: boolean;
  aggregate: string;
  commit: boolean;
  reason: string;
}

interface CommitSummary {
  committed: boolean;
  newVersion?: string;
  reason: string;
}

interface MemoryOpUi {
  op: "write" | "update" | "delete";
  memoryId?: string;
  before?: string;
  after?: string;
}

export function LearnStream({ agentId, agentName, sessionId, sessionStatus }: Props) {
  // useRef, not useState: the ref mutation is synchronous so React
  // StrictMode's dev-only double-invoke of effects can't fire /learn twice.
  const startedRef = useRef(false);
  const [, setStarted] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [promptProposal, setPromptProposal] = useState<UpdatePromptProposal | null>(null);
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([]);
  const [diff, setDiff] = useState<{ before: string; after: string } | null>(null);
  const [memoryOps, setMemoryOps] = useState<MemoryOpUi[]>([]);
  const [evaluateNotes, setEvaluateNotes] = useState<string[]>([]);
  const [evalSummary, setEvalSummary] = useState<EvalSummary | null>(null);
  const [commitSummary, setCommitSummary] = useState<CommitSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);
    setStage("reflect");
    const res = await fetch(`/api/sessions/${sessionId}/learn`, { method: "POST" });
    if (!res.ok || !res.body) {
      setError(`HTTP ${res.status}`);
      setStage("error");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6);
        let evt: LearnEvent;
        try {
          evt = JSON.parse(payload) as LearnEvent;
        } catch {
          continue;
        }
        applyEvent(evt);
      }
    }
  }, [sessionId]);

  function applyEvent(evt: LearnEvent) {
    switch (evt.type) {
      case "reflect.begin":
        setStage("reflect");
        break;
      case "reflect.hypothesis":
        setHypotheses((h) => [...h, evt.hypothesis]);
        break;
      case "select.begin":
        setStage("select");
        break;
      case "select.proposal":
        if (evt.proposal.type === "update_prompt") {
          setPromptProposal(evt.proposal);
        } else {
          setMemoryProposals((m) => [...m, evt.proposal as MemoryProposal]);
        }
        break;
      case "improve.begin":
        setStage("improve");
        break;
      case "improve.promptDiff":
        setDiff({ before: evt.before, after: evt.after });
        break;
      case "improve.memoryOp":
        setMemoryOps((m) => [
          ...m,
          { op: evt.op, memoryId: evt.memoryId, before: evt.before, after: evt.after },
        ]);
        break;
      case "evaluate.begin":
        setStage("evaluate");
        break;
      case "evaluate.progress":
        setEvaluateNotes((n) => [...n, evt.note ? `${evt.stage}: ${evt.note}` : evt.stage]);
        break;
      case "evaluate.complete":
        setEvalSummary({
          ruleGatesPassed: evt.ruleGatesPassed,
          aggregate: evt.aggregate,
          commit: evt.commit,
          reason: evt.reason,
        });
        break;
      case "commit.begin":
        setStage("commit");
        break;
      case "commit.decision":
        setCommitSummary({
          committed: evt.committed,
          newVersion: evt.newVersion,
          reason: evt.reason,
        });
        break;
      case "done":
        setStage("done");
        break;
      case "error":
        setError(evt.message);
        setStage("error");
        break;
    }
  }

  useEffect(() => {
    if (sessionStatus === "ended" && !startedRef.current) {
      start();
    }
  }, [sessionStatus, start]);

  const alreadyLearned = sessionStatus === "learned";
  const hasAnyProposal = promptProposal !== null || memoryProposals.length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-sm text-neutral-500">
            <Link className="hover:underline" href={`/agents/${agentId}/chat`}>
              {agentName}
            </Link>{" "}
            <span className="font-mono">/ learn</span>
          </div>
          <h1 className="text-xl font-semibold mt-1">SEPL run</h1>
          <div className="text-xs text-neutral-500 font-mono mt-1">session: {sessionId}</div>
        </div>
        <Link
          href={`/agents/${agentId}/chat`}
          className="text-sm rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50"
        >
          Back to chat
        </Link>
      </header>

      {alreadyLearned && !startedRef.current && (
        <Callout kind="info">
          This session has already been learned from. <Link href={`/agents/${agentId}/chat`} className="underline">Start a new session</Link> to continue.
        </Callout>
      )}

      {error && <Callout kind="error">Error: {error}</Callout>}

      <StepCard
        n={1}
        title="Reflect"
        subtitle="What went well or poorly in this session?"
        active={stage === "reflect"}
        done={hypotheses.length > 0 && stage !== "reflect"}
      >
        {hypotheses.length === 0 && stage !== "reflect" && (
          <div className="text-sm text-neutral-500">No hypotheses yet.</div>
        )}
        {hypotheses.map((h) => (
          <HypothesisCard key={h.id} h={h} />
        ))}
      </StepCard>

      <StepCard
        n={2}
        title="Select"
        subtitle="Translate hypotheses into concrete change proposals"
        active={stage === "select"}
        done={hasAnyProposal && stage !== "select"}
      >
        {!hasAnyProposal && <div className="text-sm text-neutral-500">—</div>}
        {promptProposal && (
          <div className="rounded-md border border-neutral-200 p-3 space-y-1">
            <div className="text-xs uppercase tracking-wide text-neutral-500">
              Prompt proposal · addresses {promptProposal.addresses.length} hypothes{promptProposal.addresses.length === 1 ? "is" : "es"}
            </div>
            <div className="text-sm text-neutral-700">{promptProposal.rationale}</div>
          </div>
        )}
        {memoryProposals.map((p, i) => (
          <MemoryProposalCard key={i} p={p} />
        ))}
      </StepCard>

      <StepCard
        n={3}
        title="Improve"
        subtitle="Build the candidate V_evo (prompt diff + memory ops)"
        active={stage === "improve"}
        done={(diff !== null || memoryOps.length > 0) && stage !== "improve"}
      >
        {diff && <DiffView before={diff.before} after={diff.after} />}
        {memoryOps.length > 0 && (
          <div className="space-y-2">
            {memoryOps.map((op, i) => (
              <MemoryOpCard key={i} op={op} />
            ))}
          </div>
        )}
        {!diff && memoryOps.length === 0 && <div className="text-sm text-neutral-500">—</div>}
      </StepCard>

      <StepCard
        n={4}
        title="Evaluate"
        subtitle="Rule gates + LLM-judge replay (temp=0, N=3 votes/turn)"
        active={stage === "evaluate"}
        done={evalSummary !== null && stage !== "evaluate"}
      >
        {evaluateNotes.map((n, i) => (
          <div key={i} className="text-xs text-neutral-500 font-mono">· {n}</div>
        ))}
        {evalSummary && (
          <div className="mt-2 text-sm space-y-1">
            <div>
              <span className="text-neutral-500">Rule gates:</span>{" "}
              <span className={evalSummary.ruleGatesPassed ? "text-emerald-700" : "text-red-700"}>
                {evalSummary.ruleGatesPassed ? "passed" : "failed"}
              </span>
            </div>
            <div>
              <span className="text-neutral-500">Judge aggregate:</span>{" "}
              <span className="font-mono">{evalSummary.aggregate}</span>
            </div>
            <div className="text-xs text-neutral-500">{evalSummary.reason}</div>
          </div>
        )}
      </StepCard>

      <StepCard
        n={5}
        title="Commit"
        subtitle="Accept the new version, or discard the candidate"
        active={stage === "commit"}
        done={commitSummary !== null}
      >
        {commitSummary ? (
          <div className="text-sm">
            {commitSummary.committed ? (
              <div className="text-emerald-700">
                ✓ Committed{commitSummary.newVersion ? ` · prompt v${commitSummary.newVersion}` : ""}
              </div>
            ) : (
              <div className="text-neutral-700">
                ✗ Candidate rejected — no changes applied.
              </div>
            )}
            <div className="text-xs text-neutral-500 mt-1">{commitSummary.reason}</div>
          </div>
        ) : (
          <div className="text-sm text-neutral-500">—</div>
        )}
      </StepCard>

      {stage === "done" && (
        <Callout kind="info">
          Learn complete. <Link className="underline" href={`/agents/${agentId}/chat`}>Return to chat</Link> — the next session will run on {commitSummary?.committed ? "the new version" : "the existing version"}.
        </Callout>
      )}
    </div>
  );
}

function StepCard({
  n,
  title,
  subtitle,
  active,
  done,
  children,
}: {
  n: number;
  title: string;
  subtitle: string;
  active: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  const border = active
    ? "border-blue-400 bg-blue-50/40"
    : done
      ? "border-emerald-300 bg-white"
      : "border-neutral-200 bg-white";
  return (
    <section className={`rounded-lg border ${border} p-4`}>
      <header className="flex items-center gap-3">
        <div
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
            active
              ? "bg-blue-600 text-white"
              : done
                ? "bg-emerald-600 text-white"
                : "bg-neutral-200 text-neutral-600"
          }`}
        >
          {done ? "✓" : n}
        </div>
        <div>
          <div className="font-medium">{title}</div>
          <div className="text-xs text-neutral-500">{subtitle}</div>
        </div>
        {active && <div className="ml-auto text-xs text-blue-700 animate-pulse">running…</div>}
      </header>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function HypothesisCard({ h }: { h: Hypothesis }) {
  return (
    <div className="rounded-md border border-neutral-200 px-3 py-2 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
            h.area === "memory" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
          }`}>
            {h.area}
          </span>
          <div className="font-medium">{h.issue}</div>
        </div>
        <div className="text-xs text-neutral-500 font-mono shrink-0">sev {h.severity.toFixed(2)}</div>
      </div>
      <div className="text-xs text-neutral-500 mt-1">{h.evidence}</div>
    </div>
  );
}

function MemoryProposalCard({ p }: { p: MemoryProposal }) {
  const label: Record<MemoryProposal["type"], string> = {
    write_memory: "write",
    update_memory: "update",
    delete_memory: "delete",
  };
  const content = p.type === "delete_memory" ? `delete ${p.memoryId}` : p.content;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 space-y-1 text-sm">
      <div className="text-xs uppercase tracking-wide text-amber-700">
        Memory · {label[p.type]}
        {"memoryId" in p && ` · ${p.memoryId}`}
      </div>
      <div className="text-neutral-800">{content}</div>
      <div className="text-xs text-neutral-500">{p.rationale}</div>
    </div>
  );
}

function MemoryOpCard({ op }: { op: MemoryOpUi }) {
  const colors =
    op.op === "write"
      ? "border-emerald-200 bg-emerald-50/40"
      : op.op === "delete"
        ? "border-red-200 bg-red-50/40"
        : "border-sky-200 bg-sky-50/40";
  return (
    <div className={`rounded-md border ${colors} p-2 text-xs`}>
      <div className="uppercase tracking-wide font-mono text-neutral-600">
        {op.op}
        {op.memoryId && ` · ${op.memoryId}`}
      </div>
      {op.before && (
        <div className="mt-1">
          <span className="text-neutral-500">before: </span>
          <span className="line-through text-neutral-700">{op.before}</span>
        </div>
      )}
      {op.after && (
        <div>
          <span className="text-neutral-500">after: </span>
          <span className="text-neutral-900">{op.after}</span>
        </div>
      )}
    </div>
  );
}

function DiffView({ before, after }: { before: string; after: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs font-mono">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">before</div>
        <pre className="whitespace-pre-wrap rounded-md border border-neutral-200 bg-neutral-50 p-2 h-64 overflow-auto">{before}</pre>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">after</div>
        <pre className="whitespace-pre-wrap rounded-md border border-emerald-200 bg-emerald-50/40 p-2 h-64 overflow-auto">{after}</pre>
      </div>
    </div>
  );
}

function Callout({ kind, children }: { kind: "info" | "error"; children: React.ReactNode }) {
  const cls =
    kind === "error"
      ? "border-red-300 bg-red-50 text-red-900"
      : "border-blue-300 bg-blue-50 text-blue-900";
  return <div className={`rounded-md border ${cls} px-3 py-2 text-sm`}>{children}</div>;
}
