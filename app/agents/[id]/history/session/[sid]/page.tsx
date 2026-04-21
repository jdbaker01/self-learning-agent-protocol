import { notFound } from "next/navigation";
import Link from "next/link";
import { getAgent } from "@/src/runtime/bootstrap";
import { getDb } from "@/src/storage/db";

export const dynamic = "force-dynamic";

interface SessionRow {
  id: string;
  agent_id: string;
  status: string;
  created_at: string;
  ended_at: string | null;
}

interface TurnRow {
  id: string;
  idx: number;
  user_message: string;
  assistant_message: string;
  created_at: string;
}

interface TraceRow {
  turn_id: string;
  payload: string;
}

export default async function SessionViewerPage({
  params,
}: {
  params: Promise<{ id: string; sid: string }>;
}) {
  const { id, sid } = await params;
  const agent = getAgent(id);
  if (!agent) notFound();

  const db = getDb();
  const session = db
    .prepare<[string], SessionRow>(
      `SELECT id, agent_id, status, created_at, ended_at FROM sessions WHERE id = ?`,
    )
    .get(sid);
  if (!session || session.agent_id !== id) notFound();

  const turns = db
    .prepare<[string], TurnRow>(
      `SELECT id, idx, user_message, assistant_message, created_at
       FROM turns WHERE session_id = ? ORDER BY idx ASC`,
    )
    .all(sid);

  const traces = db
    .prepare<[string], TraceRow>(
      `SELECT t.id AS turn_id, tr.payload FROM turns t
       LEFT JOIN traces tr ON tr.turn_id = t.id
       WHERE t.session_id = ?`,
    )
    .all(sid);
  const traceByTurn = new Map<string, TraceRow>();
  for (const t of traces) if (t.payload) traceByTurn.set(t.turn_id, t);

  const learnRun = db
    .prepare<[string], { id: string }>(
      `SELECT id FROM learn_runs WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sid);

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <div className="text-sm text-neutral-500">
            <Link href={`/agents/${id}/chat`} className="hover:underline">{agent.name}</Link>{" "}
            <span className="font-mono">/ history / session</span>
          </div>
          <h1 className="text-xl font-semibold mt-1">Session</h1>
          <div className="mt-1 text-xs text-neutral-500 font-mono">{session.id}</div>
          <div className="text-xs text-neutral-500">
            {session.status} · {turns.length} turn{turns.length === 1 ? "" : "s"} · started {new Date(session.created_at).toLocaleString()}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/agents/${id}/history`}
            className="text-sm rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50"
          >
            Back to history
          </Link>
          {learnRun && (
            <Link
              href={`/agents/${id}/history/learn/${learnRun.id}`}
              className="text-sm rounded-md border border-emerald-300 bg-emerald-50 text-emerald-900 px-3 py-1.5 hover:bg-emerald-100"
            >
              View learn run →
            </Link>
          )}
        </div>
      </header>

      {turns.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-6 text-sm text-neutral-500 text-center">
          No turns recorded.
        </div>
      ) : (
        <div className="space-y-3">
          {turns.map((t) => {
            const trace = traceByTurn.get(t.id);
            let toolCalls: Array<{ toolName: string; args: unknown; result?: unknown; error?: string; latencyMs: number }> = [];
            let latencyMs = 0;
            let modelId = "";
            if (trace) {
              try {
                const p = JSON.parse(trace.payload) as {
                  toolCalls?: typeof toolCalls;
                  latencyMs?: number;
                  modelId?: string;
                };
                toolCalls = p.toolCalls ?? [];
                latencyMs = p.latencyMs ?? 0;
                modelId = p.modelId ?? "";
              } catch {
                /* ignore */
              }
            }
            return (
              <article key={t.id} className="rounded-lg border border-neutral-200 bg-white overflow-hidden">
                <header className="px-3 py-2 border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 flex items-center justify-between">
                  <span className="font-mono">turn {t.idx} · {t.id}</span>
                  <span className="font-mono">{modelId} · {latencyMs}ms</span>
                </header>
                <div className="p-3 space-y-3 text-sm">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">user</div>
                    <div className="whitespace-pre-wrap rounded-md bg-blue-50 border border-blue-100 px-3 py-2">{t.user_message}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-500 mb-1">assistant</div>
                    <div className="whitespace-pre-wrap rounded-md bg-neutral-50 border border-neutral-200 px-3 py-2">
                      {t.assistant_message || <span className="text-neutral-400 italic">(empty)</span>}
                    </div>
                  </div>
                  {toolCalls.length > 0 && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-neutral-500">
                        {toolCalls.length} tool call{toolCalls.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 space-y-2">
                        {toolCalls.map((c, i) => (
                          <li key={i} className="rounded-md border border-neutral-200 p-2">
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-neutral-800">{c.toolName}</span>
                              <span className="text-neutral-500">{c.latencyMs}ms</span>
                            </div>
                            <pre className="mt-1 text-[11px] whitespace-pre-wrap overflow-auto text-neutral-700">
{JSON.stringify({ args: c.args, result: c.result, error: c.error }, null, 2)}
                            </pre>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
