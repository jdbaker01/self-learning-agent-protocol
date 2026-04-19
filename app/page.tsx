import Link from "next/link";
import { listAgents } from "@/src/runtime/bootstrap";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const agents = listAgents();
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
        <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
          {agents.map((a) => (
            <li key={a.id} className="p-4 hover:bg-neutral-50">
              <Link href={`/agents/${a.id}/chat`} className="block">
                <div className="flex items-baseline justify-between">
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-neutral-500 font-mono">{a.id}</div>
                </div>
                <p className="mt-1 text-sm text-neutral-600 line-clamp-2">
                  {a.description}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
