import "server-only";
import {
  latestBriefSchema,
  opportunityDetailSchema,
  type LatestBrief,
  type OpportunityDetail,
} from "../contracts";
import { createRequestClient } from "./supabase";

type ReadError = {
  status: 401 | 403 | 404 | 500 | 503;
  error: string;
};
type ReadResult<T> = { status: 200; data: T } | ReadError;

type RequestClient = NonNullable<Awaited<ReturnType<typeof createRequestClient>>>;

async function requireMembership(): Promise<{ supabase: RequestClient } | ReadError> {
  const supabase = await createRequestClient();
  if (!supabase) {
    return { status: 503, error: "Sign-in is unavailable." } satisfies ReadError;
  }

  const { data, error } = await supabase.auth.getClaims();
  if (error?.name === "AuthRetryableFetchError" || error?.status === 429 || (error?.status ?? 0) >= 500) {
    return { status: 503, error: "Sign-in is temporarily unavailable." } satisfies ReadError;
  }
  if (!data?.claims.sub) {
    return { status: 401, error: "Sign in to read the brief." } satisfies ReadError;
  }

  const membership = await supabase.rpc("active_membership");
  if (membership.error) {
    return { status: 503, error: "Could not verify access. Try again." } satisfies ReadError;
  }
  if (membership.data !== "viewer" && membership.data !== "editor") {
    return { status: 403, error: "This account does not have access to the brief." } satisfies ReadError;
  }
  return { supabase };
}

export async function readLatestBrief(): Promise<ReadResult<LatestBrief>> {
  const access = await requireMembership();
  if (!("supabase" in access)) return access;

  const result = await access.supabase.rpc("read_latest_brief");
  if (result.error) return { status: 503, error: "Could not load the brief. Try again." };
  if (result.data === null) return { status: 200, data: { state: "unpublished" } };

  const parsed = latestBriefSchema.safeParse(result.data);
  return parsed.success
    ? { status: 200, data: parsed.data }
    : { status: 500, error: "The published brief could not be read." };
}

export async function readOpportunity(id: string): Promise<ReadResult<OpportunityDetail>> {
  const access = await requireMembership();
  if (!("supabase" in access)) return access;

  const unavailable: ReadError = { status: 404, error: "Opportunity unavailable." };
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return unavailable;
  const result = await access.supabase.rpc("read_opportunity", { p_id: id });
  if (result.error) return { status: 503, error: "Could not load this opportunity. Try again." };
  if (result.data === null) return unavailable;

  const parsed = opportunityDetailSchema.safeParse(result.data);
  return parsed.success
    ? { status: 200, data: parsed.data }
    : { status: 500, error: "The published opportunity could not be read." };
}

export function briefResponse<T>(result: ReadResult<T>) {
  const body = result.status === 200 ? result.data : { error: result.error };
  return Response.json(body, {
    status: result.status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
