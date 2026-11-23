export type ScenePlatform = "tiktok" | "instagram" | "sample";

export interface SceneClip {
  id: string;
  platform: ScenePlatform;
  thumbnail: string | null;
  title: string;
  handle?: string;
  sourceUrl?: string | null;
  playbackUrl?: string | null;
  embedUrl?: string | null;
  comments?: { id: string; text: string; sourceUrl?: string | null }[];
  commentCoverage?: string;
}

export interface SceneOpportunity {
  id: string;
  topic: string;
  finding: string;
  category?: string;
  clips: SceneClip[];
  prospect?: { brand: string; name: string; url: string; fit: string; sizeBasis?: string };
  pitch?: { format: string; idea: string; rationale?: string };
  statistics?: string[];
  uncertainties?: string[];
}

export interface SceneBrief {
  mode: "live" | "preview";
  weekStart: string | null;
  weekEnd: string | null;
  collectedAt?: string | null;
  publishedAt?: string | null;
  coverage: string;
  opportunities: SceneOpportunity[];
}
