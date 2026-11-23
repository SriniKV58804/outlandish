import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  accountId, addDays, isDate, isMonday, localDate, normalizedLabel, postId,
  type AccountObservation, type Batch, type CommentObservation,
  type PostObservation, type Prospect,
} from "./batch.ts";
import { parseCsv } from "./csv.ts";

const sheets = {
  accounts: [
    "category", "cohort_key", "week_start", "platform", "account_key", "profile_url",
    "sampling_rule", "coverage_status", "checked_at", "coverage_reason",
  ],
  posts: [
    "platform", "post_key", "account_key", "published_at", "observed_at", "topics", "source_url",
    "caption", "preview_url", "views", "likes", "comment_access", "repost_key",
  ],
  comments: [
    "platform", "post_key", "comment_key", "excerpt", "question_theme", "observed_at",
    "source_url", "independence_key",
  ],
  prospects: [
    "category", "topic", "brand", "brand_url", "product", "product_url", "checked_on",
    "fit_rationale", "size_basis", "format", "pitch", "pitch_rationale", "uncertainty", "editor_note",
  ],
};

type Row = Record<string, string>;
type RowWithNumber<T> = { value: T; row: number };
type Sheet = keyof typeof sheets;

export class ImportValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("\n"));
    this.errors = errors;
  }
}

async function readUtf8(path: string): Promise<string> {
  return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path));
}

function required(row: Row, field: string): string {
  const value = row[field];
  if (!value) throw new Error(`${field} is required`);
  return value;
}

function choice<T extends string>(row: Row, field: string, choices: readonly T[]): T {
  const value = required(row, field);
  const found = choices.find((allowed) => allowed === value);
  if (!found) throw new Error(`${field} must be one of ${choices.join(", ")}`);
  return found;
}

function stableKey(row: Row, field: string): string {
  const value = required(row, field);
  if (!/^[a-zA-Z0-9._@-]{1,150}$/.test(value)) {
    throw new Error(`${field} must be a stable identifier without spaces`);
  }
  return value;
}

function optionalKey(row: Row, field: string): string | null {
  return row[field] ? stableKey(row, field) : null;
}

function date(row: Row, field: string): string {
  const value = required(row, field);
  if (!isDate(value)) throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  return value;
}

function instant(row: Row, field: string): string {
  const value = required(row, field);
  if (
    !isDate(value.slice(0, 10)) ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${field} must be an ISO 8601 timestamp with a timezone offset`);
  }
  return new Date(value).toISOString();
}

function count(row: Row, field: string): number | null {
  const value = row[field];
  if (!value) return null;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${field} must be a nonnegative, safe integer or blank`);
  }
  return Number(value);
}

const platforms = ["tiktok", "instagram"] as const;
const isHost = (name: string, domain: string) => name === domain || name.endsWith(`.${domain}`);

function httpsUrl(row: Row, field: string): URL {
  let url: URL;
  try {
    url = new URL(required(row, field));
  } catch {
    throw new Error(`${field} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error(`${field} must be an HTTPS URL without credentials or a custom port`);
  }
  return url;
}

function socialUrl(row: Row, field: string, platform: (typeof platforms)[number]): URL {
  const url = httpsUrl(row, field);
  const supportedHosts = platform === "tiktok"
    ? ["tiktok.com", "www.tiktok.com", "vm.tiktok.com", "vt.tiktok.com", "m.tiktok.com"]
    : ["instagram.com", "www.instagram.com", "m.instagram.com"];
  if (!supportedHosts.includes(url.hostname)) {
    throw new Error(`${field} must point to the selected platform`);
  }
  return url;
}

function previewUrl(row: Row): string | null {
  if (!row.preview_url) return null;
  const url = httpsUrl(row, "preview_url");
  if (!["tiktokcdn.com", "tiktokcdn-us.com", "cdninstagram.com", "fbcdn.net"].some(
    (domain) => isHost(url.hostname, domain),
  )) {
    throw new Error("preview_url must be on a supported TikTok or Instagram media host");
  }
  return url.href;
}

function parseAccount(row: Row): AccountObservation {
  const platform = choice(row, "platform", platforms);
  const weekStart = date(row, "week_start");
  if (!isMonday(weekStart)) throw new Error("week_start must be a Monday in America/Los_Angeles");
  const checkedAt = instant(row, "checked_at");
  const coverageStatus = choice(row, "coverage_status", ["complete", "partial", "unknown"] as const);
  const coverageReason = row.coverage_reason || null;

  if (coverageStatus === "complete" && localDate(checkedAt) < addDays(weekStart, 7)) {
    throw new Error("complete coverage requires checking after the week ended in America/Los_Angeles");
  }
  if (coverageStatus !== "complete" && !coverageReason) {
    throw new Error("coverage_reason is required for partial or unknown coverage");
  }

  return {
    category: required(row, "category"),
    cohort_key: stableKey(row, "cohort_key"),
    week_start: weekStart,
    platform,
    account_key: stableKey(row, "account_key"),
    profile_url: socialUrl(row, "profile_url", platform).href,
    sampling_rule: stableKey(row, "sampling_rule"),
    coverage_status: coverageStatus,
    checked_at: checkedAt,
    coverage_reason: coverageReason,
  };
}

function parsePost(row: Row): PostObservation {
  const platform = choice(row, "platform", platforms);
  const source = socialUrl(row, "source_url", platform);
  source.hash = "";
  source.search = "";
  if ([`${platform}.com`, `m.${platform}.com`].includes(source.hostname)) {
    source.hostname = `www.${platform}.com`;
  }
  const postPath = source.pathname.replace(/\/+$/, "");
  if (
    platform === "tiktok" ? !/^\/@[^/]+\/(?:video|photo)\/\d+$/.test(postPath)
      : !/^\/(?:reel|p|tv)\/[a-zA-Z0-9_-]+$/.test(postPath)
  ) {
    throw new Error("source_url must be a full, canonical platform post URL");
  }
  source.pathname = postPath;
  const postKey = row.post_key ? stableKey(row, "post_key") : postPath.split("/").at(-1)!;
  const publishedAt = instant(row, "published_at");
  const observedAt = instant(row, "observed_at");
  if (observedAt < publishedAt) throw new Error("observed_at must be on or after published_at");
  const topics = required(row, "topics").split("|").map((topic) => topic.trim());
  if (topics.some((topic) => !topic)) throw new Error("topics must contain nonempty pipe-delimited labels");
  if (new Set(topics.map(normalizedLabel)).size !== topics.length) {
    throw new Error("topics cannot contain duplicate labels");
  }
  topics.sort((a, b) => a.localeCompare(b, "en-US"));

  return {
    platform, post_key: postKey, account_key: stableKey(row, "account_key"),
    published_at: publishedAt, observed_at: observedAt, topics, source_url: source.href,
    caption: row.caption || null, preview_url: previewUrl(row),
    views: count(row, "views"), likes: count(row, "likes"),
    comment_access: choice(row, "comment_access", ["available", "checked-empty", "partial", "unavailable"] as const),
    repost_key: optionalKey(row, "repost_key"),
  };
}

function parseComment(row: Row): CommentObservation {
  const platform = choice(row, "platform", platforms);
  return {
    platform,
    post_key: stableKey(row, "post_key"),
    comment_key: stableKey(row, "comment_key"),
    excerpt: required(row, "excerpt"),
    question_theme: required(row, "question_theme"),
    observed_at: instant(row, "observed_at"),
    source_url: row.source_url ? socialUrl(row, "source_url", platform).href : null,
    independence_key: optionalKey(row, "independence_key"),
  };
}

function commentLinksToPost(commentUrl: string, post: PostObservation): boolean {
  const postPath = new URL(post.source_url).pathname;
  const commentPath = new URL(commentUrl).pathname;
  if (post.platform === "tiktok") {
    const postNativeId = postPath.split("/").at(-1);
    const commentParentId = commentPath.match(/^\/@[^/]+\/(?:video|photo)\/(\d+)\/?$/)?.[1];
    return postNativeId === commentParentId;
  }
  const postNativeId = postPath.split("/")[2];
  const commentParentId = commentPath.match(/^\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)(?:\/|$)/)?.[1];
  return postNativeId === commentParentId;
}

function parseProspect(row: Row): Prospect {
  return {
    category: required(row, "category"),
    topic: required(row, "topic"),
    brand: required(row, "brand"),
    brand_url: httpsUrl(row, "brand_url").href,
    product: required(row, "product"),
    product_url: httpsUrl(row, "product_url").href,
    checked_on: date(row, "checked_on"),
    fit_rationale: required(row, "fit_rationale"),
    size_basis: required(row, "size_basis"),
    format: choice(row, "format", ["creator-video", "tiktok-live"] as const),
    pitch: required(row, "pitch"),
    pitch_rationale: required(row, "pitch_rationale"),
    uncertainty: row.uncertainty || null,
    editor_note: row.editor_note || null,
  };
}

async function readSheet<T>(
  directory: string, sheet: Sheet, parse: (row: Row) => T, problems: string[],
): Promise<RowWithNumber<T>[]> {
  let rows;
  try {
    rows = parseCsv(await readUtf8(join(directory, `${sheet}.csv`)));
  } catch (error) {
    problems.push(`${sheet}.csv: ${error instanceof Error ? error.message : "could not read file"}`);
    return [];
  }
  const columns = rows.shift()?.map((column) => column.trim()) ?? [];
  const missing = sheets[sheet].filter((column) => !columns.includes(column));
  if (missing.length || new Set(columns).size !== columns.length || columns.some((column) => !column)) {
    problems.push(`${sheet}.csv row 1: invalid header. Required columns are ${sheets[sheet].join(", ")}.`);
    return [];
  }

  return rows.flatMap((fields, index) => {
    const row = index + 2;
    if (fields.length === 1 && !fields[0].trim()) return [];
    if (fields.length !== columns.length) {
      problems.push(`${sheet}.csv row ${row}: expected ${columns.length} columns, got ${fields.length}.`);
      return [];
    }
    try {
      return [{ row, value: parse(Object.fromEntries(columns.map((column, index) => [column, fields[index].trim()]))) }];
    } catch (error) {
      problems.push(`${sheet}.csv row ${row}: ${error instanceof Error ? error.message : "invalid record"}.`);
      return [];
    }
  });
}

function uniqueRows<T>(
  sheet: Sheet, rows: RowWithNumber<T>[], key: (row: T) => string, problems: string[],
): RowWithNumber<T>[] {
  const known = new Map<string, RowWithNumber<T>>();
  for (const entry of rows) {
    const identity = key(entry.value);
    const existing = known.get(identity);
    if (!existing) known.set(identity, entry);
    else if (JSON.stringify(entry.value) !== JSON.stringify(existing.value)) {
      problems.push(`${sheet}.csv row ${entry.row}: conflicts with row ${existing.row}.`);
    }
  }
  return [...known.entries()].sort(([a], [b]) => a.localeCompare(b, "en-US")).map(([, entry]) => entry);
}

export const prospectKey = (row: Prospect) =>
  JSON.stringify([normalizedLabel(row.category), normalizedLabel(row.topic), row.product_url]);

export async function loadBatch(directory: string): Promise<Batch> {
  const problems: string[] = [];
  let fixture = false;
  try {
    const metadata = JSON.parse(await readUtf8(join(directory, "batch.json")));
    if (typeof metadata?.fixture !== "boolean") throw new Error("fixture must be true or false");
    fixture = metadata.fixture;
  } catch (error) {
    problems.push(`batch.json: ${error instanceof Error ? error.message : "invalid file"}.`);
  }

  const [accountRows, postRows, commentRows, prospectRows] = await Promise.all([
    readSheet(directory, "accounts", parseAccount, problems),
    readSheet(directory, "posts", parsePost, problems),
    readSheet(directory, "comments", parseComment, problems),
    readSheet(directory, "prospects", parseProspect, problems),
  ]);
  const accounts = uniqueRows("accounts", accountRows, (row) =>
    JSON.stringify([normalizedLabel(row.category), row.cohort_key, row.week_start, accountId(row)]), problems);
  const posts = uniqueRows("posts", postRows, postId, problems);
  const comments = uniqueRows("comments", commentRows, (row) =>
    JSON.stringify([postId(row), row.comment_key]), problems);
  const prospects = uniqueRows("prospects", prospectRows, prospectKey, problems);

  const tracked = new Set(accounts.map(({ value }) => accountId(value)));
  const byPost = new Map(posts.map(({ value }) => [postId(value), value]));
  const postUrls = new Set<string>();
  for (const { row, value } of posts) {
    if (!tracked.has(accountId(value))) problems.push(`posts.csv row ${row}: unknown tracked account.`);
    if (postUrls.has(value.source_url)) problems.push(`posts.csv row ${row}: post URL has multiple keys.`);
    postUrls.add(value.source_url);
  }
  for (const { row, value } of comments) {
    const parent = byPost.get(postId(value));
    if (!parent) {
      problems.push(`comments.csv row ${row}: unknown parent post.`);
    } else if (parent.comment_access === "unavailable" || parent.comment_access === "checked-empty") {
      problems.push(`comments.csv row ${row}: parent post does not have observed comments.`);
    } else if (value.observed_at < parent.published_at) {
      problems.push(`comments.csv row ${row}: observed_at is earlier than the post publication.`);
    } else if (value.source_url && !commentLinksToPost(value.source_url, parent)) {
      problems.push(`comments.csv row ${row}: source_url must link to the comment's parent post.`);
    }
  }
  const categories = new Set(accounts.map(({ value }) => normalizedLabel(value.category)));
  for (const { row, value } of prospects) {
    if (!categories.has(normalizedLabel(value.category))) {
      problems.push(`prospects.csv row ${row}: category has no coverage rows.`);
    }
  }

  if (problems.length) throw new ImportValidationError(problems.sort());
  return {
    fixture,
    accounts: accounts.map(({ value }) => value),
    posts: posts.map(({ value }) => value),
    comments: comments.map(({ value }) => value),
    prospects: prospects.map(({ value }) => value),
  };
}

export function fingerprint(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en-US")));
  });
  return createHash("sha256").update(canonical).digest("hex");
}
