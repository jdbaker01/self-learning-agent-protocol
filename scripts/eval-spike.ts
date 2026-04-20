// M1.5 eval spike: run ε three times on the same (trace, baseline, candidate)
// and measure commit-decision agreement. Exit criterion: ≥ 90% (i.e. 3/3 or
// 2/3 with a clear majority).
//
// Usage:
//   npx tsx scripts/eval-spike.ts            # default canned fixture
//   npx tsx scripts/eval-spike.ts --runs 5   # override run count

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { evaluate } from "../src/sepl/evaluate";
import { RECIPE_TRACE, BASELINE_STATE, CANDIDATE_STATE } from "../src/sepl/fixtures";

function parseArgs(argv: string[]): { runs: number } {
  let runs = 3;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--runs") {
      runs = Number(argv[i + 1] ?? "3");
      i++;
    }
  }
  return { runs };
}

async function main() {
  const { runs } = parseArgs(process.argv.slice(2));

  console.log("M1.5 eval spike");
  console.log(`Trace: ${RECIPE_TRACE.id} (${RECIPE_TRACE.turns.length} turns)`);
  console.log(`Runs: ${runs}`);
  console.log("Exit criterion: ≥ 90% commit-decision agreement across runs");
  console.log("---");

  const commits: boolean[] = [];
  const aggregates: string[] = [];

  for (let i = 0; i < runs; i++) {
    const t0 = Date.now();
    const result = await evaluate(RECIPE_TRACE, BASELINE_STATE, CANDIDATE_STATE, {
      runSeed: i,
    });
    const ms = Date.now() - t0;
    commits.push(result.commit);
    aggregates.push(result.judge?.aggregate ?? "rule_gate_fail");
    console.log(
      `Run ${i + 1}/${runs}: commit=${result.commit}  aggregate=${result.judge?.aggregate ?? "rule_gate_fail"}  (${ms}ms)`,
    );
    if (result.judge) {
      const w = result.judge.wins;
      console.log(
        `  wins: cand(h=${w.candidate.helpfulness} f=${w.candidate.faithfulness} fmt=${w.candidate.format})  base(h=${w.baseline.helpfulness} f=${w.baseline.faithfulness} fmt=${w.baseline.format})  tie(h=${w.tie.helpfulness} f=${w.tie.faithfulness} fmt=${w.tie.format})`,
      );
    }
  }

  console.log("---");
  const trueCount = commits.filter((c) => c).length;
  const majority = trueCount >= Math.ceil(runs / 2) ? true : false;
  const agreement = Math.max(trueCount, runs - trueCount) / runs;
  console.log(`Commit decisions: ${JSON.stringify(commits)}`);
  console.log(`Aggregates:       ${JSON.stringify(aggregates)}`);
  console.log(`Majority decision: ${majority}`);
  console.log(`Agreement rate:   ${(agreement * 100).toFixed(0)}% (${Math.max(trueCount, runs - trueCount)}/${runs})`);
  console.log(
    agreement >= 0.9
      ? "PASS — judge is stable enough to build SEPL on."
      : "FAIL — judge is unstable. Consider stricter rubric / majority-vote / lower temp.",
  );
}

main().catch((err) => {
  console.error("eval-spike failed:", err);
  process.exit(1);
});
