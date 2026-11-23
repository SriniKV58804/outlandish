export type Platform = "tiktok" | "instagram";
export type Purpose = "probe" | "discovery";
export type RunStatus = "open" | "complete" | "partial" | "budget_exhausted";

export interface CollectedComment {
  id: string;
  text: string;
  publishedAt: string | null;
  profileId: string | null;
  likesCount: number | null;
  repliesCount: number | null;
}
export interface CollectedFrame {
  id: string;
  url: string | null;
  at: number | null;
  text: string | null;
}
export interface CollectedPost {
  id: string;
  platform: Platform;
  platformId: string;
  profileId: string | null;
  profileHandle: string | null;
  profilePlatformId: string | null;
  publishedAt: string;
  observedAt: string;
  caption: string | null;
  title: string | null;
  transcript: string | null;
  onScreenText: string | null;
  profileBio: string | null;
  thumbnailUrl: string | null;
  sourceUrl: string | null;
  sourceStatus: "unverified" | "unavailable";
  viewsCount: number | null;
  commentsCount: number | null;
  commentCoverage: "unavailable" | "empty_subset" | "available";
  comments: CollectedComment[];
  frames: CollectedFrame[];
}
export interface PlannedQuery {
  key: string;
  kind: "workspace" | "search";
  platform: Platform | null;
  method: "GET" | "POST";
  day: string | null;
  start: string | null;
  end: string | null;
  limit: number;
  offset: number;
  sort: "publishedAt:desc" | null;
}
export interface CollectionQuery extends PlannedQuery {
  status: "queued" | "running" | "done" | "retry" | "failed";
  attempts: number;
  returned: number | null;
  accepted: number | null;
  reason: string | null;
  nextAttemptAt: string | null;
  coverage: Record<string, number | null> | null;
}
export interface CollectionSnapshot {
  runId: string;
  weekStart: string;
  mode: "live";
  purpose: Purpose;
  status: RunStatus;
  strategy: string;
  budget: number;
  requests: number;
  startedAt: string;
  completedAt: string | null;
  queries: CollectionQuery[];
  posts: CollectedPost[];
}
export interface CollectionPlan {
  weekStart: string;
  purpose: Purpose;
  strategy: string;
  budget: number;
  queries: PlannedQuery[];
}
