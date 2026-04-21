import Link from "next/link";
import { listAgentsWithStats } from "@/src/runtime/bootstrap";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = listAgentsWithStats();
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <Link
          href="/agents/new"
          className="rounded-md bg-blue-600 px-4 py-2 text-white text-sm font-medium hover:bg-blue-700"
        >
          New agent
        </Link>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center">
          <p className="text-neutral-600">No agents yet.</p>
          <Link
            href="/agents/new"
            className="mt-3 inline-block text-blue-600 hover:underline"
          >
            Create your first one →
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {agents.map((a) => (
            <li key={a.id}>
              <div className="rounded-lg border border-neutral-200 bg-white p-4 hover:border-neutral-300 transition-colors">
                <div className="flex items-baseline justify-between gap-3">
                  <Link href={`/agents/${a.id}/chat`} className="font-medium text-neutral-900 hover:text-blue-700">
                    {a.name}
                  </Link>
                  <span className="text-[10px] text-neutral-400 font-mono shrink-0">{a.id}</span>
                </div>
                <p className="mt-1 text-sm text-neutral-600 line-clamp-2">
                  {a.description}
                </p>
                <div className="mt-3 flex items-center gap-3 text-xs">
                  <Stat label="prompt" value={a.promptVersion ? `v${a.promptVersion}` : "—"} />
                  <Stat label="sessions" value={a.sessions.toString()} />
                  <Stat label="learns" value={a.learns.toString()} />
                  <Stat label="memories" value={a.memories.toString()} />
                  <Stat label="tools" value={a.tools.toString()} />
                  <div className="ml-auto flex items-center gap-2">
                    <Link
                      href={`/agents/${a.id}/chat`}
                      className="text-neutral-600 hover:text-blue-700 hover:underline"
                    >
                      chat
                    </Link>
                    <span className="text-neutral-300">·</span>
                    <Link
                      href={`/agents/${a.id}/history`}
                      className="text-neutral-600 hover:text-blue-700 hover:underline"
                    >
                      history
                    </Link>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-1 font-mono text-neutral-700">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</span>
      <span>{value}</span>
    </span>
  );
}
