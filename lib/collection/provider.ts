import type { CollectedFrame, CollectedPost, PlannedQuery } from "./types.ts";

const base = "https://connect.oriane.xyz";
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown) => typeof v === "string" && v.trim() ? v : null;
const metric = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const iso = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const joined = (v: unknown[]) => v.map(str).filter(Boolean).join("\n") || null;

function mediaUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}
export class ProviderError extends Error {
  code: string;
  retryAfter: string | null;
  retryable: boolean;
  constructor(code: string, retryable = false, retryAfter: string | null = null) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
    this.retryable = retryable;
  }
}

function normalize(value: unknown, query: PlannedQuery, observedAt: string): CollectedPost | null {
  const row = object(value);
  const id = str(row.id);
  const platformId = str(row.platformId);
  const publishedAt = iso(row.publishedAt);
  if (!id || !platformId || !publishedAt || !query.platform || row.platform !== query.platform ||
      row.format !== "video" || !query.start || !query.end || publishedAt < query.start || publishedAt >= query.end) return null;
  const media = list(row.media).map(object);
  const frames: CollectedFrame[] = [];
  for (const m of media) {
    for (const frame of list(m.frames).map(object)) {
      const frameId = str(frame.id);
      if (frameId) frames.push({ id: frameId, url: mediaUrl(frame.url), at: metric(frame.timestampSeconds),
        text: joined(list(frame.onScreenTextRegions).map(region => object(region).text)) });
    }
  }
  const comments = list(row.popularComments).slice(0, 15).flatMap(value => {
    const c = object(value);
    const id = str(c.platformId), text = str(c.content);
    return id && text ? [{ id, text, publishedAt: iso(c.publishedAt), profileId: str(c.profilePlatformId),
      likesCount: metric(c.likesCount), repliesCount: metric(c.repliesCount) }] : [];
  });
  const profileHandle = str(row.profileHandle);
  const sourceUrl = query.platform === "tiktok" && /^\d+$/.test(platformId) &&
    profileHandle && /^[\w.]+$/.test(profileHandle)
    ? `https://www.tiktok.com/@${profileHandle}/video/${platformId}` : null;
  return {
    id, platform: query.platform, platformId, profileId: str(row.profileId), profilePlatformId: str(row.profilePlatformId),
    profileHandle, publishedAt, observedAt, caption: str(row.caption), title: str(row.title),
    transcript: joined(media.map(m => str(m.transcript) ?? joined(list(m.transcriptChunks).map(c => object(c).text)))),
    onScreenText: joined([...media.flatMap(m => list(m.onScreenText)), ...frames.map(f => f.text)]),
    thumbnailUrl: mediaUrl(row.thumbnailMediaUrl), profileBio: str(row.profileBio),
    sourceUrl, sourceStatus: sourceUrl ? "unverified" : "unavailable",
    viewsCount: metric(row.viewsCount), commentsCount: metric(row.commentsCount),
    commentCoverage: comments.length ? "available" : Array.isArray(row.popularComments) && row.popularComments.length === 0 ? "empty_subset" : "unavailable",
    comments, frames,
  };
}

export interface PageResult {
  returned: number;
  accepted: number;
  coverage: Record<string, number | null>;
  posts: CollectedPost[];
}
function retryAfter(header: string | null, now: number) {
  if (!header) return null;
  const time = /^\d+$/.test(header) ? now + Number(header) * 1000 : Date.parse(header);
  return Number.isFinite(time) && time >= now && time < 8e15 ? new Date(time).toISOString() : null;
}

export async function fetchQuery(query: PlannedQuery, key: string, fetcher: typeof fetch = fetch): Promise<PageResult> {
  if (!key.trim()) throw new Error("Configure ORIANE_API_KEY in the server environment.");
  const workspace = query.kind === "workspace";
  const uri = new URL(workspace ? "/rest/workspace" : "/rest/contents/search", base);
  uri.searchParams.set("projection", workspace ? "basic" : "full");
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  let body: string | undefined;
  if (!workspace) {
    uri.searchParams.set("limit", String(query.limit));
    uri.searchParams.set("offset", String(query.offset));
    uri.searchParams.set("sort", "publishedAt:desc");
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ operator: "and", filters: { platform: { includes: [query.platform] }, format: { includes: ["video"] },
      publishedAt: { after: query.start, before: new Date(Date.parse(query.end!) - 1).toISOString() } } });
  }
  let response: Response;
  const signal = AbortSignal.timeout(12_000);
  try {
    response = await fetcher(uri, { method: query.method, headers, body, cache: "no-store", redirect: "error", signal });
  } catch {
    throw new ProviderError(signal.aborted ? "provider_timeout" : "provider_unreachable", true);
  }
  if (!response.ok) {
    const status = response.status;
    const code = status === 401 ? "invalid_key" : status === 403 ? "access_denied" : status === 402 ? "provider_quota"
      : status === 429 ? "rate_limited" : `provider_http_${status}`;
    throw new ProviderError(code, status === 429 || status === 408 || status >= 500,
      retryAfter(response.headers.get("Retry-After"), Date.now()));
  }
  let result: Record<string, unknown>;
  try { result = object(await response.json()); } catch {
    if (signal.aborted) throw new ProviderError("provider_timeout", true);
    throw new ProviderError("invalid_provider_json");
  }
  const data = object(result.data);
  if (workspace) {
    if (!str(data.id)) throw new ProviderError("missing_workspace_identity");
    return { returned: 0, accepted: 0, coverage: { authenticated: 1 }, posts: [] };
  }
  if (!Array.isArray(data.results) || data.results.length > query.limit) throw new ProviderError("unexpected_result_shape");
  const observedAt = new Date().toISOString();
  const posts = data.results.map(row => normalize(row, query, observedAt)).filter(p => p !== null);
  const native = new Map(posts.map(p => [p.platformId, p]));
  const pagination = object(object(result.metadata).pagination);
  const coverage = {
    returned: data.results.length, inWindow: posts.length, unique: native.size,
    invalidOrOutOfWindow: data.results.length - posts.length, reportedMatches: metric(pagination.totalCount),
    withCaption: posts.filter(p => p.caption).length, withTranscript: posts.filter(p => p.transcript).length,
    withThumbnail: posts.filter(p => p.thumbnailUrl).length, withFrames: posts.filter(p => p.frames.length).length,
    withCommentField: data.results.filter(p => Array.isArray(object(p).popularComments)).length,
    withCommentText: posts.filter(p => p.comments.length).length, commentExcerpts: posts.reduce((s, p) => s + p.comments.length, 0),
    sourceCandidates: posts.filter(p => p.sourceUrl).length,
  };
  return { returned: data.results.length, accepted: native.size, coverage, posts: [...native.values()] };
}
