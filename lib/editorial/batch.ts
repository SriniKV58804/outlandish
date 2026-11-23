import type { Platform } from "../contracts.ts";

export type CoverageStatus = "complete" | "partial" | "unknown";
export type CommentAccess = "available" | "checked-empty" | "partial" | "unavailable";
export type PitchFormat = "creator-video" | "tiktok-live";

export interface AccountObservation {
  category: string;
  cohort_key: string;
  week_start: string;
  platform: Platform;
  account_key: string;
  profile_url: string;
  sampling_rule: string;
  coverage_status: CoverageStatus;
  checked_at: string;
  coverage_reason: string | null;
}

export interface PostObservation {
  platform: Platform;
  post_key: string;
  account_key: string;
  published_at: string;
  observed_at: string;
  topics: string[];
  source_url: string;
  caption: string | null;
  preview_url: string | null;
  views: number | null;
  likes: number | null;
  comment_access: CommentAccess;
  repost_key: string | null;
}

export interface CommentObservation {
  platform: Platform;
  post_key: string;
  comment_key: string;
  excerpt: string;
  question_theme: string;
  observed_at: string;
  source_url: string | null;
  independence_key: string | null;
}

export interface Prospect {
  category: string;
  topic: string;
  brand: string;
  brand_url: string;
  product: string;
  product_url: string;
  checked_on: string;
  fit_rationale: string;
  size_basis: string;
  format: PitchFormat;
  pitch: string;
  pitch_rationale: string;
  uncertainty: string | null;
  editor_note: string | null;
}

export interface Batch {
  fixture: boolean;
  accounts: AccountObservation[];
  posts: PostObservation[];
  comments: CommentObservation[];
  prospects: Prospect[];
}

export const normalizedLabel = (label: string) =>
  label.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

export const accountId = (row: Pick<AccountObservation, "platform" | "account_key">) =>
  `${row.platform}:${row.account_key}`;

export const postId = (row: Pick<PostObservation, "platform" | "post_key">) =>
  `${row.platform}:${row.post_key}`;

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function isMonday(date: string): boolean {
  return isDate(date) && new Date(`${date}T00:00:00Z`).getUTCDay() === 1;
}

const pacificDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function localDate(instant: string | Date): string {
  const fields = Object.fromEntries(
    pacificDate.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]),
  );
  return `${fields.year}-${fields.month}-${fields.day}`;
}
