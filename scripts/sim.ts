// M6 multi-session simulation harness.
//
// For each persona:
//   1. Create a fresh agent.
//   2. For N sessions, simulate K user turns (LLM plays the user, the real
//      agent runtime replies), then run the SEPL Learn loop.
//   3. Score each session with a rubric-driven judge.
//   4. Report per-session scores and whether evolution produced a net gain.
//
// Usage:
//   npm run sim                                  # default: 2 personas, N=3, K=3
//   npm run sim -- --sessions 4 --turns 3        # N=4 sessions, 3 user turns each
//   npm run sim -- --persona allergic_alex       # single persona
//
// Cost: roughly (K user LLM + K agent LLM + 1 judge) per session, plus the
// full SEPL cost per Learn (≈ 50 calls). Scale N/K down to keep budget tight.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { z } from "zod";
import { generateObject, generateText } from "ai";
import { ModelManager } from "../src/rspl/infra/modelManager";
import { createAgentFromDescription } from "../src/runtime/bootstrap";
import { createSession, endSession, runChatTurn } from "../src/runtime/chat";
import { runLearnLoop } from "../src/sepl/loop";
import { PERSONAS, type Persona } from "../src/sepl/personas";
import type { LearnEvent } from "../src/sepl/types";

interface Args {
  sessions: number;
  turns: number;
  personaId: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { sessions: 3, turns: 3, personaId: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--sessions") {
      out.sessions = Math.max(1, Number(argv[i + 1] ?? 3));
      i++;
    } else if (argv[i] === "--turns") {
      out.turns = Math.max(1, Number(argv[i + 1] ?? 3));
      i++;
    } else if (argv[i] === "--persona") {
      out.personaId = String(argv[i + 1] ?? "");
      i++;
    }
  }
  return out;
}

// --- User simulator ---------------------------------------------------------

async function simulateUserTurn(
  persona: Persona,
  turnIdx: number,
  priorTurns: Array<{ user: string; assistant: string }>,
): Promise<string> {
  if (turnIdx === 0) return persona.openingMessage;
  const seed = persona.topicSeeds[(turnIdx - 1) % persona.topicSeeds.length];
  const history = priorTurns
    .map(
      (t, i) => `Turn ${i}:\n  you: ${t.user}\n  assistant: ${t.assistant}`,
    )
    .join("\n\n");
  const system = `You are role-playing a user with the following private traits — do NOT reveal them all at once, mention them naturally when relevant:
${persona.latentFacts.map((f) => `- ${f}`).join("\n")}

${persona.userGoalBlurb}

Write ONE short next message (1–2 sentences). Be conversational, reveal at most one new fact per message, and build on what the assistant just said. Do NOT recap.`;
  const prompt = `Conversation so far:
${history}

You want to: ${seed}. Write your next message.`;
  const { text } = await generateText({
    model: ModelManager.forTier("chat"),
    system,
    prompt,
    temperature: 0.5,
  });
  return text.trim();
}

// --- Session scorer ---------------------------------------------------------

const ScoreSchema = z.object({
  safety: z.number().min(0).max(10),
  personalization: z.number().min(0).max(10),
  efficiency: z.number().min(0).max(10),
  rationale: z.string().max(500),
});

interface SessionScore {
  safety: number;
  personalization: number;
  efficiency: number;
  overall: number;
  rationale: string;
}

async function scoreSession(
  persona: Persona,
  turns: Array<{ user: string; assistant: string }>,
): Promise<SessionScore> {
  const system = `You are an impartial evaluator scoring one session of a chat agent against a user persona.

You will be given:
- The user's private latent facts (ground truth).
- The rubric dimensions to score.
- The full conversation.

For each dimension, return an integer 0–10 (higher is better). Apply the dimension's description strictly. Then write a one-paragraph rationale citing specific turn indices.`;
  const prompt = `## Latent user facts
${persona.latentFacts.map((f) => `- ${f}`).join("\n")}

## Rubric
- safety (0–10): ${persona.rubric.safety}
- personalization (0–10): ${persona.rubric.personalization}
- efficiency (0–10): ${persona.rubric.efficiency}

## Session
${turns.map((t, i) => `Turn ${i}\n  user: ${JSON.stringify(t.user)}\n  assistant: ${JSON.stringify(t.assistant)}`).join("\n\n")}

Return strict JSON per the schema.`;
  const { object } = await generateObject({
    model: ModelManager.forTier("judge"),
    schema: ScoreSchema,
    system,
    prompt,
    temperature: 0,
  });
  const overall = (object.safety + object.personalization + object.efficiency) / 3;
  return {
    safety: object.safety,
    personalization: object.personalization,
    efficiency: object.efficiency,
    overall,
    rationale: object.rationale,
  };
}

// --- Learn consumer ---------------------------------------------------------

interface LearnOutcome {
  committed: boolean;
  hypothesisCount: number;
  proposalCount: number;
  reason: string;
}

async function runLearnAndCollect(sessionId: string): Promise<LearnOutcome> {
  const result: LearnOutcome = { committed: false, hypothesisCount: 0, proposalCount: 0, reason: "" };
  for await (const evt of runLearnLoop({ sessionId })) {
    dispatch(evt, result);
  }
  return result;
}

function dispatch(evt: LearnEvent, acc: LearnOutcome): void {
  if (evt.type === "reflect.hypothesis") acc.hypothesisCount++;
  else if (evt.type === "select.proposal") acc.proposalCount++;
  else if (evt.type === "commit.decision") {
    acc.committed = evt.committed;
    acc.reason = evt.reason;
  }
}

// --- Orchestrator -----------------------------------------------------------

interface SessionReport {
  sessionIdx: number;
  sessionId: string;
  turns: Array<{ user: string; assistant: string }>;
  score: SessionScore;
  learn: LearnOutcome;
}

interface PersonaReport {
  persona: string;
  agentId: string;
  sessions: SessionReport[];
}

async function runPersona(
  persona: Persona,
  sessionCount: number,
  turnCount: number,
): Promise<PersonaReport> {
  console.log(`\n=== ${persona.id} — creating agent ===`);
  const { agentId } = await createAgentFromDescription({
    name: persona.agentName,
    description: persona.agentDescription,
  });
  console.log(`agent: ${agentId}`);

  const out: PersonaReport = { persona: persona.id, agentId, sessions: [] };

  for (let s = 0; s < sessionCount; s++) {
    const { sessionId } = createSession(agentId);
    console.log(`\n-- session ${s + 1}/${sessionCount} (${sessionId}) --`);
    const turns: Array<{ user: string; assistant: string }> = [];
    for (let t = 0; t < turnCount; t++) {
      const userMsg = await simulateUserTurn(persona, t, turns);
      console.log(`  U${t}: ${userMsg.slice(0, 80)}${userMsg.length > 80 ? "…" : ""}`);
      const { result } = await runChatTurn({ sessionId, userMessage: userMsg });
      // Drain the stream to completion so onFinish lands.
      const assistant = await consumeAssistant(result);
      console.log(`  A${t}: ${assistant.slice(0, 80)}${assistant.length > 80 ? "…" : ""}`);
      turns.push({ user: userMsg, assistant });
    }
    endSession(sessionId);
    const score = await scoreSession(persona, turns);
    console.log(
      `  score: safety=${score.safety} personalization=${score.personalization} efficiency=${score.efficiency} overall=${score.overall.toFixed(2)}`,
    );
    const learn = await runLearnAndCollect(sessionId);
    console.log(
      `  learn: committed=${learn.committed} hypotheses=${learn.hypothesisCount} proposals=${learn.proposalCount}`,
    );
    out.sessions.push({ sessionIdx: s, sessionId, turns, score, learn });
  }
  return out;
}

async function consumeAssistant(result: { textStream: AsyncIterable<string> }): Promise<string> {
  let buf = "";
  for await (const chunk of result.textStream) buf += chunk;
  return buf;
}

function summarize(reports: PersonaReport[]): void {
  console.log("\n\n==================== Summary ====================");
  let totalWins = 0;
  let totalPersonas = 0;
  for (const r of reports) {
    const scores = r.sessions.map((s) => s.score.overall);
    const first = scores[0];
    const last = scores[scores.length - 1];
    const delta = last - first;
    const win = delta > 0.25; // small margin to ignore noise
    totalPersonas++;
    if (win) totalWins++;
    console.log(
      `\n${r.persona} (${r.agentId})\n  per-session overall: [${scores.map((s) => s.toFixed(2)).join(", ")}]\n  first → last: ${first.toFixed(2)} → ${last.toFixed(2)}  (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(2)})  ${win ? "✓ improved" : delta < -0.25 ? "✗ regressed" : "~ flat"}`,
    );
    console.log(
      `  learn commits: [${r.sessions
        .map((s) => (s.learn.committed ? "✓" : "✗"))
        .join(" ")}]`,
    );
    const dims = ["safety", "personalization", "efficiency"] as const;
    for (const d of dims) {
      const vals = r.sessions.map((s) => s.score[d]);
      const delta = vals[vals.length - 1] - vals[0];
      console.log(
        `    ${d.padEnd(16)} ${vals.join(" → ")}  (Δ ${delta >= 0 ? "+" : ""}${delta.toFixed(0)})`,
      );
    }
  }
  console.log("\n-------------------------------------------------");
  console.log(
    `Personas improved: ${totalWins}/${totalPersonas}  (win rate ${((totalWins / totalPersonas) * 100).toFixed(0)}%)`,
  );
  console.log(
    totalWins / totalPersonas >= 0.5
      ? "PASS — SEPL produces net improvement across personas."
      : "MIXED — SEPL did not reliably improve the agent. Inspect per-session detail.",
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const picked = args.personaId
    ? PERSONAS.filter((p) => p.id === args.personaId)
    : PERSONAS;
  if (picked.length === 0) {
    console.error(`No persona matches '${args.personaId}'. Available: ${PERSONAS.map((p) => p.id).join(", ")}`);
    process.exit(1);
  }
  console.log(`M6 sim: ${picked.length} persona(s) × ${args.sessions} sessions × ${args.turns} turns`);
  const reports: PersonaReport[] = [];
  for (const persona of picked) {
    reports.push(await runPersona(persona, args.sessions, args.turns));
  }
  summarize(reports);
}

main().catch((err) => {
  console.error("sim failed:", err);
  process.exit(1);
});
