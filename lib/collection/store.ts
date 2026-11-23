import { rpc } from "../editorial/remote.ts";
import type { CollectionPlan, CollectionSnapshot, PlannedQuery, RunStatus } from "./types.ts";
import type { PageResult } from "./provider.ts";

export interface Claim {
  status: RunStatus | "claimed" | "waiting" | "approval_changed";
  query?: PlannedQuery;
  token?: string;
  attempt?: number;
  nextAttemptAt?: string;
}
export const openRun = (plan: CollectionPlan) => rpc<string>("open_collection_run", { p_plan: plan });
export const claimQuery = (runId: string, limit: number, pageSize: number) => rpc<Claim>("claim_collection_query", { p_run: runId, p_limit: limit, p_rows: pageSize });
export async function finishQuery(runId: string, key: string, token: string, result: PageResult | {
  error: string; retryable: boolean; retryAfter: string | null;
}) {
  const settled = await rpc<boolean>("finish_collection_query", { p_run: runId, p_key: key, p_token: token, p_result: result });
  if (!settled) throw new Error("This collection lease expired. Rerun to read the winning checkpoint.");
}
export async function loadCollection(runId: string, includePosts = true): Promise<CollectionSnapshot> {
  const snapshot = await rpc<CollectionSnapshot | null>("read_collection_run", { p_run: runId, p_include_posts: includePosts });
  if (!snapshot) throw new Error("No collection was found for that ID.");
  return snapshot;
}
