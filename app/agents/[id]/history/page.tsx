import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgent } from "@/src/runtime/bootstrap";
import { getDb } from "@/src/storage/db";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  turn_count: number;
  learn_run_id: string | null;
  learn_committed: number | null;
}

interface LearnRunRow {
  id: string;
  session_id: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  commit_decisions: string;
}

export default async function HistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();

  const db = getDb();
  const sessions = db
    .prepare<[string], SessionRow>(
      `SELECT
         s.id, s.status, s.created_at, s.ended_at,
         (SELECT COUNT(*) FROM turns t WHERE t.session_id = s.id) AS turn_count,
         (SELECT lr.id FROM learn_runs lr WHERE lr.session_id = s.id ORDER BY lr.created_at DESC LIMIT 1) AS learn_run_id,
         (SELECT CASE WHEN lr.commit_decisions LIKE '%"committed":true%' THEN 1 ELSE 0 END
            FROM learn_runs lr WHERE lr.session_id = s.id ORDER BY lr.created_at DESC LIMIT 1) AS learn_committed
       FROM sessions s
       WHERE s.agent_id = ?
       ORDER BY s.created_at DESC`,
    )
    .all(id);

  const learnRuns = db
    .prepare<[string], LearnRunRow>(
      `SELECT id, session_id, status, created_at, completed_at, commit_decisions
       FROM learn_runs
       WHERE agent_id = ?
       ORDER BY created_at DESC`,
    )
    .all(id);

  function learnSummary(row: LearnRunRow): { committed: boolean; label: string } {
    try {
      const decisions = JSON.parse(row.commit_decisions) as Array<{
        committed: boolean;
        promptVersion?: string;
        memoryOps?: Array<{ ok: boolean }>;
        toolOps?: Array<{ ok: boolean }>;
      }>;
      if (decisions.length === 0) return { committed: false, label: "no changes" };
      const d = decisions[0];
      const parts: string[] = [];
      if (d.promptVersion) parts.push(`prompt v${d.promptVersion}`);
      const memOk = (d.memoryOps ?? []).filter((o) => o.ok).length;
      if (memOk) parts.push(`${memOk} memory op${memOk === 1 ? "" : "s"}`);
      const toolOk = (d.toolOps ?? []).filter((o) => o.ok).length;
      if (toolOk) parts.push(`${toolOk} tool op${toolOk === 1 ? "" : "s"}`);
      return {
        committed: d.committed,
        label: d.committed ? parts.join(", ") || "committed" : "rejected",
      };
    } catch {
      return { committed: false, label: "—" };
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-sm text-neutral-500">
            <Link href={`/agents/${id}/chat`} className="hover:underline">
              {agent.name}
            </Link>{" "}
            <span className="font-mono">/ history</span>
          </div>
          <h1 className="text-xl font-semibold mt-1">History</h1>
          <div className="mt-1 text-xs text-neutral-500">
            {sessions.length} session{sessions.length === 1 ? "" : "s"}, {learnRuns.length} learn run{learnRuns.length === 1 ? "" : "s"}
          </div>
        </div>
        <Link
          href={`/agents/${id}/chat`}
          className="text-sm rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50"
        >
          Back to chat
        </Link>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-600 uppercase tracking-wide">Sessions</h2>
        {sessions.length === 0 ? (
          <div className="text-sm text-neutral-500">No sessions yet.</div>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {sessions.map((s) => (
              <li key={s.id} className="p-3 hover:bg-neutral-50">
                <Link href={`/agents/${id}/history/session/${s.id}`} className="block">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <StatusBadge status={s.status} />
                      <span className="font-mono text-xs text-neutral-500">{s.id}</span>
                      <span className="text-xs text-neutral-500">
                        {s.turn_count} turn{s.turn_count === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500">{formatTs(s.created_at)}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-neutral-600 uppercase tracking-wide">Learn runs</h2>
        {learnRuns.length === 0 ? (
          <div className="text-sm text-neutral-500">No learn runs yet.</div>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
            {learnRuns.map((lr) => {
              const s = learnSummary(lr);
              return (
                <li key={lr.id} className="p-3 hover:bg-neutral-50">
                  <Link href={`/agents/${id}/history/learn/${lr.id}`} className="block">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <LearnBadge status={lr.status} committed={s.committed} />
                        <span className="font-mono text-xs text-neutral-500 shrink-0">{lr.id}</span>
                        <span className="text-xs text-neutral-600 truncate">{s.label}</span>
                      </div>
                      <div className="text-xs text-neutral-500 shrink-0">{formatTs(lr.completed_at ?? lr.created_at)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "open"
      ? "bg-blue-100 text-blue-800"
      : status === "ended"
        ? "bg-amber-100 text-amber-800"
        : status === "learned"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-neutral-100 text-neutral-600";
  return (
    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${cls}`}>
      {status}
    </span>
  );
}

function LearnBadge({ status, committed }: { status: string; committed: boolean }) {
  if (status === "failed") return (
    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-800">failed</span>
  );
  if (status === "running") return (
    <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">running</span>
  );
  const cls = committed ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600";
  return <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${cls}`}>{committed ? "committed" : "rejected"}</span>;
}

function formatTs(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
