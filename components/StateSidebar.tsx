"use client";

export interface AgentState {
  agent: { id: string; name: string; description: string };
  prompt: { version: string; text: string } | null;
  policy:
    | {
        version: string;
        modelTier: string;
        maxSteps: number;
        toolChoice: string;
        replyStyle: string;
      }
    | null;
  tools: Array<{ name: string; description: string; version: string; implementationRef: string }>;
  memories: Array<{ id: string; version: string; content: string; tags: string[] }>;
  lineage: Array<{
    resourceId: string;
    entityType: string;
    name: string;
    version: string;
    createdAt: string;
    createdBy: string;
    isHead: boolean;
  }>;
}

export function StateSidebar({ state, onRefresh }: { state: AgentState | null; onRefresh: () => void }) {
  if (!state) {
    return (
      <aside className="rounded-lg border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
        Loading agent state…
      </aside>
    );
  }
  return (
    <aside className="h-[calc(100vh-140px)] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 space-y-5 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Evolvable state</h2>
        <button onClick={onRefresh} className="text-xs text-blue-600 hover:underline">
          refresh
        </button>
      </div>

      <Section label="System prompt" version={state.prompt?.version}>
        <pre className="whitespace-pre-wrap text-xs font-mono bg-neutral-50 p-2 rounded border border-neutral-200 max-h-60 overflow-auto">
          {state.prompt?.text ?? "—"}
        </pre>
      </Section>

      <Section label="Policy" version={state.policy?.version}>
        {state.policy ? (
          <ul className="text-xs space-y-0.5">
            <li><span className="text-neutral-500">model:</span> {state.policy.modelTier}</li>
            <li><span className="text-neutral-500">maxSteps:</span> {state.policy.maxSteps}</li>
            <li><span className="text-neutral-500">toolChoice:</span> {state.policy.toolChoice}</li>
            <li className="pt-1"><span className="text-neutral-500">replyStyle:</span> <span className="italic">{state.policy.replyStyle}</span></li>
          </ul>
        ) : "—"}
      </Section>

      <Section label={`Tools (${state.tools.length})`}>
        <ul className="text-xs space-y-1">
          {state.tools.map((t) => (
            <li key={t.name} className="rounded border border-neutral-200 p-2">
              <div className="flex items-center justify-between">
                <span className="font-mono">{t.name}</span>
                <span className="text-neutral-400">v{t.version}</span>
              </div>
              <div className="text-neutral-600">{t.description}</div>
              <div className="text-[10px] text-neutral-400 mt-1 font-mono">impl: {t.implementationRef}</div>
            </li>
          ))}
        </ul>
      </Section>

      <Section label={`Memories (${state.memories.length})`}>
        {state.memories.length === 0 ? (
          <div className="text-xs text-neutral-500">No memories yet.</div>
        ) : (
          <ul className="text-xs space-y-1">
            {state.memories.slice(0, 20).map((m) => (
              <li key={m.id} className="rounded border border-neutral-200 p-2">
                <div className="text-neutral-800">{m.content}</div>
                {m.tags.length > 0 && (
                  <div className="mt-1 flex gap-1 flex-wrap">
                    {m.tags.map((t) => (
                      <span key={t} className="text-[10px] bg-neutral-100 border border-neutral-200 rounded px-1">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section label={`Version timeline (${state.lineage.length})`}>
        <ul className="text-xs space-y-0.5 max-h-60 overflow-auto">
          {state.lineage.map((l, i) => (
            <li key={i} className={l.isHead ? "font-medium" : "text-neutral-600"}>
              <span className="font-mono">{l.entityType}:{l.name}</span>
              {" "}→ v{l.version}{" "}
              <span className="text-[10px] text-neutral-400">
                ({l.createdBy})
              </span>
              {l.isHead && <span className="ml-1 text-[10px] text-blue-600">HEAD</span>}
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

function Section({
  label,
  version,
  children,
}: {
  label: string;
  version?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">{label}</div>
        {version && <div className="text-[10px] text-neutral-400">v{version}</div>}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
