// ε — the SEPL evaluator (paper §3.2.2).
// Two layers:
//   1. Rule gates (safety invariants — deterministic, hard-block).
//   2. LLM-judge pairwise replay: rerun each held-out turn under the candidate,
//      pairwise-compare candidate vs baseline reply with position randomization,
//      require monotonic improvement across helpfulness / faithfulness / format.
//
// Isolated from DB / registries so M1.5 can run on canned fixtures without
// touching agent state.

import { z } from "zod";
import { generateText, generateObject } from "ai";
import { ModelManager } from "@/src/rspl/infra/modelManager";
import { ALLOWLIST } from "@/src/rspl/registries/tool";

export interface EvoTool {
  name: string;
  description: string;
  implementationRef: string;
  argsSchema: Record<string, unknown>;
}

export interface EvoState {
  systemPrompt: string;
  replyStyle: string;
  tools: EvoTool[];
  memories: Array<{ content: string; tags?: string[] }>;
}

export interface CannedTurn {
  user: string;
  /** What the agent actually said under baseline (what we compare against). */
  assistant: string;
}

export interface CannedTrace {
  id: string;
  description: string;
  turns: CannedTurn[];
}

// --- Rule gates ---------------------------------------------------------------

export interface RuleGateResult {
  passed: boolean;
  violations: string[];
}

const PROMPT_TOKEN_BUDGET = 4_000; // ~4 chars/token rough estimate
const MEMORY_ENTRY_BUDGET = 200;
const MEMORY_CONTENT_MAX = 500;
const TOOL_COUNT_MAX = 12;
const TOOL_DESC_MAX = 400;

export function ruleGates(state: EvoState): RuleGateResult {
  const violations: string[] = [];
  // Prompt size.
  const approxTokens = Math.ceil(state.systemPrompt.length / 4);
  if (approxTokens > PROMPT_TOKEN_BUDGET) {
    violations.push(`prompt exceeds token budget (${approxTokens} > ${PROMPT_TOKEN_BUDGET})`);
  }
  if (!state.systemPrompt.trim()) violations.push("prompt is empty");

  // Tools: each tool's impl ref must be on the allowlist; argsSchema must be an object.
  if (state.tools.length > TOOL_COUNT_MAX) {
    violations.push(`too many tools (${state.tools.length} > ${TOOL_COUNT_MAX})`);
  }
  const names = new Set<string>();
  for (const t of state.tools) {
    if (!(t.implementationRef in ALLOWLIST)) {
      violations.push(`tool '${t.name}' ref '${t.implementationRef}' not on allowlist`);
    }
    if (!t.description || t.description.length > TOOL_DESC_MAX) {
      violations.push(`tool '${t.name}' has invalid description`);
    }
    if (!t.argsSchema || typeof t.argsSchema !== "object" || Array.isArray(t.argsSchema)) {
      violations.push(`tool '${t.name}' has invalid argsSchema`);
    } else {
      const s = t.argsSchema as Record<string, unknown>;
      if (s.type !== "object") {
        violations.push(`tool '${t.name}' argsSchema.type must be "object"`);
      }
    }
    if (names.has(t.name)) violations.push(`duplicate tool name '${t.name}'`);
    names.add(t.name);
  }

  // Memory budget.
  if (state.memories.length > MEMORY_ENTRY_BUDGET) {
    violations.push(`too many memory entries (${state.memories.length} > ${MEMORY_ENTRY_BUDGET})`);
  }
  for (const m of state.memories) {
    if (m.content.length > MEMORY_CONTENT_MAX) {
      violations.push(`memory entry too long (${m.content.length} > ${MEMORY_CONTENT_MAX})`);
    }
  }

  return { passed: violations.length === 0, violations };
}

// --- Candidate replay ---------------------------------------------------------

/**
 * Replay a canned trace under a candidate state. For each turn, constructs the
 * conversation up to that turn (using the *baseline* assistant replies as prior
 * context, to keep the user's next message coherent) and generates the
 * candidate reply.
 *
 * This deliberately does NOT hit tools — M1.5's canned fixtures are prompt-only.
 * M2+ will extend this to tool replay.
 */
export async function generateCandidateReplies(
  trace: CannedTrace,
  candidate: EvoState,
): Promise<string[]> {
  const effectiveSystem = buildSystem(candidate);
  const replies: string[] = [];
  for (let i = 0; i < trace.turns.length; i++) {
    const prior: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (let j = 0; j < i; j++) {
      prior.push({ role: "user", content: trace.turns[j].user });
      prior.push({ role: "assistant", content: trace.turns[j].assistant });
    }
    const { text } = await generateText({
      model: ModelManager.forTier("chat"),
      system: effectiveSystem,
      messages: [...prior, { role: "user" as const, content: trace.turns[i].user }],
      temperature: 0,
    });
    replies.push(text);
  }
  return replies;
}

function buildSystem(state: EvoState): string {
  const toolBlock = state.tools.length
    ? `\n\n# Available tools (for reference — describe using them naturally; do not call them in this reply)\n${state.tools
        .map((t) => `- ${t.name} (${t.implementationRef}): ${t.description}`)
        .join("\n")}`
    : "";
  const memBlock = state.memories.length
    ? `\n\n# Memories (persisted about the user)\n${state.memories.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  return `${state.systemPrompt}\n\n# Reply style\n${state.replyStyle}${toolBlock}${memBlock}`;
}

// --- Judge --------------------------------------------------------------------

const VerdictEnum = z.enum(["A", "B", "tie"]);

const JudgeSchema = z.object({
  helpfulness: VerdictEnum,
  faithfulness: VerdictEnum,
  format: VerdictEnum,
  rationale: z.string().max(400),
});

export interface TurnJudgement {
  turnIdx: number;
  user: string;
  baselineReply: string;
  candidateReply: string;
  /** Which label (A or B) was shown as the candidate to the judge. Position-randomized. */
  candidateLabel: "A" | "B";
  verdicts: {
    helpfulness: "baseline" | "candidate" | "tie";
    faithfulness: "baseline" | "candidate" | "tie";
    format: "baseline" | "candidate" | "tie";
  };
  rationale: string;
}

export interface JudgeReport {
  perTurn: TurnJudgement[];
  wins: {
    candidate: { helpfulness: number; faithfulness: number; format: number };
    baseline: { helpfulness: number; faithfulness: number; format: number };
    tie: { helpfulness: number; faithfulness: number; format: number };
  };
  /** Aggregate verdict: candidate commits iff it ties-or-wins on all 3 dimensions. */
  aggregate: "candidate_better" | "baseline_better" | "equivalent";
}

const JUDGE_SYSTEM = `You are an impartial evaluator comparing two candidate assistant replies to the same user message. You must decide which reply is better on three independent dimensions:

- helpfulness: does it actually address the user's need?
- faithfulness: does it stay grounded, avoid fabrication, and respect stated constraints (e.g. dietary restrictions)?
- format: is it appropriately concise, well-structured, and easy to read?

For each dimension, answer exactly one of: "A", "B", "tie".
- Default to "tie" when the two replies are substantively equivalent or differ only in minor wording, ordering, or length. A meaningful difference must change how well the reply actually serves the user on that specific dimension.
- Pick a winner ONLY when one reply is clearly and materially better on that dimension (e.g. it catches a safety issue the other misses, includes concrete content the other omits, or is substantially more readable).
- Ignore positional bias: do not prefer A over B or vice versa. Ignore verbosity bias: longer is not better.
- Judge on substance, not style.

Return a strict JSON object with the four fields below.`;

/** Call the judge once with a specific A/B labeling; return verdict normalized to candidate/baseline/tie. */
async function judgeOnce(args: {
  user: string;
  candidateReply: string;
  baselineReply: string;
  candidateLabel: "A" | "B";
}): Promise<{
  verdicts: { helpfulness: "baseline" | "candidate" | "tie"; faithfulness: "baseline" | "candidate" | "tie"; format: "baseline" | "candidate" | "tie" };
  rationale: string;
}> {
  const replyA = args.candidateLabel === "A" ? args.candidateReply : args.baselineReply;
  const replyB = args.candidateLabel === "A" ? args.baselineReply : args.candidateReply;

  const userPrompt = `User message:
"""
${args.user}
"""

Reply A:
"""
${replyA}
"""

Reply B:
"""
${replyB}
"""

Return your verdict as JSON matching the schema.`;

  const { object } = await generateObject({
    model: ModelManager.forTier("judge"),
    schema: JudgeSchema,
    system: JUDGE_SYSTEM,
    prompt: userPrompt,
    temperature: 0,
  });

  const mapLabel = (v: "A" | "B" | "tie"): "baseline" | "candidate" | "tie" => {
    if (v === "tie") return "tie";
    if (v === args.candidateLabel) return "candidate";
    return "baseline";
  };

  return {
    verdicts: {
      helpfulness: mapLabel(object.helpfulness),
      faithfulness: mapLabel(object.faithfulness),
      format: mapLabel(object.format),
    },
    rationale: object.rationale,
  };
}

type Verdict = "baseline" | "candidate" | "tie";

/** Majority-vote a verdict over multiple calls. Ties in the vote count collapse to "tie". */
function majorityVerdict(votes: Verdict[]): Verdict {
  const counts = { baseline: 0, candidate: 0, tie: 0 };
  for (const v of votes) counts[v]++;
  const max = Math.max(counts.baseline, counts.candidate, counts.tie);
  const winners = (Object.entries(counts) as Array<[Verdict, number]>).filter(([, c]) => c === max).map(([k]) => k);
  if (winners.length === 1) return winners[0];
  // If baseline and candidate both have equal top votes with no majority, call it a tie.
  return "tie";
}

/**
 * Judge one turn with N=votesPerTurn independent calls that alternate A/B
 * position, then majority-vote each dimension. This kills positional bias
 * and smooths small-sample noise on near-equivalent replies.
 */
async function judgeOneTurn(args: {
  turnIdx: number;
  user: string;
  baselineReply: string;
  candidateReply: string;
  baseLabel: "A" | "B";
  votes: number;
}): Promise<TurnJudgement> {
  const results: Array<Awaited<ReturnType<typeof judgeOnce>>> = [];
  for (let i = 0; i < args.votes; i++) {
    // Alternate the label on each vote so a 3-vote run covers both positions.
    const label: "A" | "B" = ((args.baseLabel === "A" ? 0 : 1) + i) % 2 === 0 ? "A" : "B";
    results.push(
      await judgeOnce({
        user: args.user,
        candidateReply: args.candidateReply,
        baselineReply: args.baselineReply,
        candidateLabel: label,
      }),
    );
  }
  const pickMajority = (dim: keyof typeof results[0]["verdicts"]): Verdict =>
    majorityVerdict(results.map((r) => r.verdicts[dim]));
  return {
    turnIdx: args.turnIdx,
    user: args.user,
    baselineReply: args.baselineReply,
    candidateReply: args.candidateReply,
    candidateLabel: args.baseLabel,
    verdicts: {
      helpfulness: pickMajority("helpfulness"),
      faithfulness: pickMajority("faithfulness"),
      format: pickMajority("format"),
    },
    rationale: results.map((r) => r.rationale).join(" | "),
  };
}

export async function judgeReplay(
  trace: CannedTrace,
  baseline: EvoState,
  candidate: EvoState,
  opts: { runSeed: number; votesPerTurn?: number },
): Promise<JudgeReport> {
  const votes = opts.votesPerTurn ?? 3;
  const candidateReplies = await generateCandidateReplies(trace, candidate);

  // Also replay baseline under its own state so we compare two generated
  // replies (not the canned reply vs generated), giving both sides equal footing.
  const baselineReplies = await generateCandidateReplies(trace, baseline);

  const perTurn: TurnJudgement[] = [];
  for (let i = 0; i < trace.turns.length; i++) {
    // Starting position alternates across runs + turns; N-vote loop flips further.
    const baseLabel: "A" | "B" = (opts.runSeed + i) % 2 === 0 ? "A" : "B";
    const j = await judgeOneTurn({
      turnIdx: i,
      user: trace.turns[i].user,
      baselineReply: baselineReplies[i],
      candidateReply: candidateReplies[i],
      baseLabel,
      votes,
    });
    perTurn.push(j);
  }

  const wins = {
    candidate: { helpfulness: 0, faithfulness: 0, format: 0 },
    baseline: { helpfulness: 0, faithfulness: 0, format: 0 },
    tie: { helpfulness: 0, faithfulness: 0, format: 0 },
  };
  for (const t of perTurn) {
    for (const dim of ["helpfulness", "faithfulness", "format"] as const) {
      wins[t.verdicts[dim]][dim]++;
    }
  }

  // Dimension-wise monotonic rule (paper §3.2.2): a commit must strictly
  // improve at least one dimension AND not regress any dimension. This is
  // both the correct semantic AND more stable at the decision boundary than
  // aggregating raw win counts, because pooled counts flip on small noise
  // while per-dimension leads are robust.
  const dims = ["helpfulness", "faithfulness", "format"] as const;
  let anyStrictImprovement = false;
  let anyRegression = false;
  for (const d of dims) {
    if (wins.candidate[d] > wins.baseline[d]) anyStrictImprovement = true;
    if (wins.candidate[d] < wins.baseline[d]) anyRegression = true;
  }
  let aggregate: JudgeReport["aggregate"];
  if (anyRegression) aggregate = "baseline_better";
  else if (anyStrictImprovement) aggregate = "candidate_better";
  else aggregate = "equivalent";

  return { perTurn, wins, aggregate };
}

// --- Top-level evaluator ------------------------------------------------------

export interface EvaluationResult {
  ruleGates: RuleGateResult;
  judge: JudgeReport | null;
  /** true iff rule gates pass AND judge aggregate is candidate_better or equivalent. */
  commit: boolean;
  reason: string;
}

export async function evaluate(
  trace: CannedTrace,
  baseline: EvoState,
  candidate: EvoState,
  opts: { runSeed: number; votesPerTurn?: number },
): Promise<EvaluationResult> {
  const rg = ruleGates(candidate);
  if (!rg.passed) {
    return {
      ruleGates: rg,
      judge: null,
      commit: false,
      reason: `rule gates failed: ${rg.violations.join("; ")}`,
    };
  }
  const judge = await judgeReplay(trace, baseline, candidate, opts);
  // Strict monotonicity: commit only when candidate is actually better.
  // Equivalent candidates are rejected as no-ops (keeps the lineage clean).
  const commit = judge.aggregate === "candidate_better";
  const reason = `rule gates ok; judge=${judge.aggregate} (cand wins: h=${judge.wins.candidate.helpfulness} f=${judge.wins.candidate.faithfulness} fmt=${judge.wins.candidate.format}; base wins: h=${judge.wins.baseline.helpfulness} f=${judge.wins.baseline.faithfulness} fmt=${judge.wins.baseline.format})`;
  return { ruleGates: rg, judge, commit, reason };
}
