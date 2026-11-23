import { makePlan } from "./plan.ts";
import { fetchQuery, ProviderError } from "./provider.ts";
import { claimQuery, finishQuery, loadCollection, openRun } from "./store.ts";
import type { Purpose } from "./types.ts";

export function configuredPlan(purpose: Purpose, env: Record<string, string | undefined> = process.env, now = new Date()) {
  const key = env.ORIANE_API_KEY?.trim();
  if (!key) throw new Error("Set ORIANE_API_KEY in the server environment.");
  const budgetName = purpose === "probe" ? "ORIANE_PROBE_REQUEST_LIMIT" : "ORIANE_REFRESH_REQUEST_LIMIT";
  if (!env[budgetName]) throw new Error(`Set ${budgetName} to the owner's approved request allowance before collection.`);
  if (purpose === "discovery" && !env.ORIANE_ROWS_PER_SLICE) throw new Error("Set ORIANE_ROWS_PER_SLICE to the approved per-request result limit.");
  const plan = makePlan(purpose, Number(env[budgetName]), purpose === "probe" ? 1 : Number(env.ORIANE_ROWS_PER_SLICE), now);
  return { key, plan };
}
export async function advanceDiscovery(existingId?: string) {
  const { key, plan } = configuredPlan("discovery");
  const runId = existingId ?? await openRun(plan);
  if (existingId && (await loadCollection(runId, false)).purpose !== "discovery") throw new Error("A discovery run ID is required.");
  const oneBatchDeadline = Date.now() + 33_000;
  let nextAttemptAt: string | null = null;
  for (let step = 0; step < 8 && Date.now() < oneBatchDeadline; step++) {
    const claim = await claimQuery(runId, plan.budget, plan.queries[1].limit);
    if (claim.status === "approval_changed") throw new Error("Saved results per slice exceed the current approval. Restore this run’s approved page size or wait for a new reporting week.");
    if (claim.status === "waiting") {
      const pause = Date.parse(claim.nextAttemptAt ?? "") - Date.now();
      if (pause > 0 && pause <= 350 && Date.now() + pause < oneBatchDeadline) {
        await new Promise(resolve => setTimeout(resolve, pause + 20));
        continue;
      }
      nextAttemptAt = claim.nextAttemptAt ?? null;
      break;
    }
    if (claim.status !== "claimed" || !claim.query || !claim.token) break;
    let result;
    try { result = await fetchQuery(claim.query, key); }
    catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      result = { error: error.code, retryable: error.retryable, retryAfter: error.retryAfter };
    }
    await finishQuery(runId, claim.query.key, claim.token, result);
  }
  const { posts: _, ...summary } = await loadCollection(runId, false);
  return { ...summary, nextAttemptAt };
}
