import "server-only";
import { requireMembership } from "../server/briefs";
import { briefSchema, opportunitySchema, type PublishedOpportunity } from "./schema";
import type { SceneBrief, SceneOpportunity } from "../../components/scene/types";

type ReadResult<T> = { status: 200; data: T } | { status: 401 | 403 | 404 | 500 | 503; error: string };

function currentPreviews(opportunity: PublishedOpportunity): PublishedOpportunity {
  const now = Date.now();
  return { ...opportunity, clips: opportunity.clips.map(clip =>
    clip.thumbnailExpiresAt && Date.parse(clip.thumbnailExpiresAt) <= now ? { ...clip, thumbnail: null } : clip) };
}

async function readBrief(id?:string): Promise<ReadResult<SceneBrief>> {
  const access = await requireMembership();
  if (!("supabase" in access)) return access;
  if (id !== undefined && !/^rev_[0-9a-f]{32}_[0-9a-f]{16}$/.test(id)) return {status:404,error:"This opportunity is unavailable."};
  const { data, error } = id === undefined ? await access.supabase.rpc("read_latest_discovery")
    : await access.supabase.rpc("read_discovery_for_opportunity", {p_id:id});
  if (!error && data == null && id !== undefined) return {status:404,error:"This opportunity is unavailable."};
  if (error) return { status: 503, error: "The weekly brief could not be loaded." };
  if (data == null) return { status: 200, data: {
    mode: "live", weekStart: null, weekEnd: null, collectedAt: null, publishedAt: null,
    coverage: "A reviewed collection has yet to be published.", opportunities: [],
  } };
  const parsed = briefSchema.safeParse(data);
  if (!parsed.success) return { status: 500, error: "The published revision could not be read." };
  const opportunities = parsed.data.opportunities.map(currentPreviews)
    .map(topic => topic.id === id ? topic : ({ ...topic, clips: topic.clips.filter(clip => clip.thumbnail) }))
    .filter(topic => topic.clips.length > 0);
  return { status: 200, data: { ...parsed.data, opportunities } };
}

export const readLatestSceneBrief = () => readBrief();
export const readBriefForOpportunity = (id:string) => readBrief(id);

export async function readSceneOpportunity(id: string): Promise<ReadResult<SceneOpportunity>> {
  const access = await requireMembership();
  if (!("supabase" in access)) return access;
  const absent = { status: 404, error: "This opportunity is unavailable." } as const;
  if (!/^rev_[0-9a-f]{32}_[0-9a-f]{16}$/.test(id)) return absent;
  const { data, error } = await access.supabase.rpc("read_discovery_opportunity", { p_id: id });
  if (error) return { status: 503, error: "The opportunity could not be loaded." };
  if (data == null) return absent;
  const parsed = opportunitySchema.safeParse(data);
  return parsed.success ? { status: 200, data: currentPreviews(parsed.data) }
    : { status: 500, error: "The published opportunity could not be read." };
}
