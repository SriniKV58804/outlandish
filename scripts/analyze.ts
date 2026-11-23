import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadCollection } from "../lib/collection/store.ts";
import { analyzeDiscovery, type AnalysisRun } from "../lib/discovery/analyze.ts";

const help = `Usage
  node --env-file-if-exists=.env.local scripts/analyze.ts --run RUN_ID
  node scripts/analyze.ts --replay saved-run.json [--aliases reviewed-merges.json] [--out .outlandish/discovery.json]

A run ID reads stored observations in Supabase and makes no provider requests.
Replay accepts an exported collection snapshot. Synthetic snapshots retain mode "fixture".
The optional output includes private source phrases and shopper excerpts. Use a private location.`;

async function readJson(path: string): Promise<unknown> {
  const bytes = await readFile(path, "utf8");
  try { return JSON.parse(bytes); }
  catch { throw new Error("The supplied file is not valid JSON."); }
}
async function main() {
  const {values} = parseArgs({options: {
    run: {type: "string"}, replay: {type: "string"}, aliases: {type: "string"}, out: {type: "string"}, help: {type: "boolean"},
  }});
  if (values.help) { console.log(help); return; }
  if (Boolean(values.run) === Boolean(values.replay)) throw new Error(help);
  let run: AnalysisRun;
  if (values.run) run = await loadCollection(values.run);
  else {
    const input = await readJson(values.replay!);
    if (!input || typeof input !== "object" || !("posts" in input) || !Array.isArray(input.posts) ||
      !("queries" in input) || !Array.isArray(input.queries) || !("weekStart" in input) || !("runId" in input)) {
      throw new Error("Replay requires a normalized collection snapshot with observations, date slices, weekStart and runId.");
    }
    const original = input as AnalysisRun;
    run = {...original, mode: original.mode === "fixture" ? "fixture" : "replay"};
  }
  const aliases = values.aliases ? await readJson(values.aliases) : {};
  if (typeof aliases !== "object" || !aliases || Array.isArray(aliases) ||
      Object.values(aliases).some(v => v !== null && typeof v !== "string")) {
    throw new Error("Expected a JSON object mapping source terms to canonical terms or null.");
  }
  const analysis = analyzeDiscovery(run, {aliases: aliases as Record<string, string | null>});
  if (values.out) {
    await mkdir(dirname(values.out), {recursive: true, mode: 0o700});
    await writeFile(values.out, JSON.stringify(analysis, null, 2) + "\n", {flag: "wx", mode: 0o600});
  }
  console.log(JSON.stringify({mode: analysis.mode, runId: analysis.runId, weekStart: analysis.weekStart,
    coverage: analysis.coverage, observedTopics: analysis.observed.length,
    rising: analysis.ranked.map(t => ({topic: t.label, meanShareChangePp: Number((t.score! * 100).toFixed(2)),
      independentPosts: t.currentIndependentPosts, shopperQuestionCount: t.shopperQuestions.length})),
  }, null, 2));
}
main().catch((error: unknown) => {console.error(error instanceof Error ? error.message : "Analysis failed."); process.exitCode = 1;});
