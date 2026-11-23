import type { Comparison, Platform } from "../contracts.ts";
import {
  accountId, addDays, isMonday, localDate, normalizedLabel, postId,
  type AccountObservation, type Batch, type CommentObservation, type PostObservation, type Prospect,
} from "./batch.ts";
import { fingerprint, prospectKey } from "./import.ts";

const platforms: Platform[] = ["tiktok", "instagram"];

export interface Period {
  weekStart: string;
  weekEnd: string;
  priorWeekStart: string;
  priorWeekEnd: string;
  timezone: "America/Los_Angeles";
}

export interface RecurringQuestion {
  theme: string;
  key: string;
  comments: CommentObservation[];
}

export interface DraftTopic {
  key: string;
  label: string;
  comparisons: Comparison[];
  currentPosts: PostObservation[];
  questions: RecurringQuestion[];
  singleQuestions: string[];
}

export interface DraftCandidate {
  id: string;
  prospect: Prospect;
  topic: DraftTopic | null;
  eligible: boolean;
  gaps: string[];
}

export interface Draft {
  fixture: boolean;
  category: string;
  cohortKey: string;
  period: Period;
  coverageNote: string;
  coverage: AccountObservation[];
  comparablePlatforms: Platform[];
  topics: DraftTopic[];
  candidates: DraftCandidate[];
  fingerprint: string;
}

interface PlatformWindow {
  platform: Platform;
  current: AccountObservation[];
  prior: AccountObservation[];
  currentPosts: PostObservation[];
  priorPosts: PostObservation[];
  comparable: boolean;
  reason: string;
}

export function latestCompleteWeek(now = new Date()): string {
  const today = localDate(now);
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(today, -daysSinceMonday - 7);
}

function sameAccounts(current: AccountObservation[], prior: AccountObservation[]): boolean {
  const priorIds = new Set(prior.map(accountId));
  return current.length === prior.length && current.every((account) => priorIds.has(accountId(account)));
}

function postsInWindow(
  posts: PostObservation[], accounts: AccountObservation[], start: string, end: string,
): PostObservation[] {
  const tracked = new Set(accounts.map(accountId));
  return posts.filter((post) => {
    const date = localDate(post.published_at);
    return tracked.has(accountId(post)) && date >= start && date < end;
  });
}

function inspectWindow(
  platform: Platform, rows: AccountObservation[], posts: PostObservation[], period: Period,
): PlatformWindow {
  const current = rows.filter((row) => row.platform === platform && row.week_start === period.weekStart);
  const prior = rows.filter((row) => row.platform === platform && row.week_start === period.priorWeekStart);
  const rules = new Set([...current, ...prior].map((row) => row.sampling_rule));
  let reason = "";
  if (!current.length || !prior.length) {
    reason = "coverage was missing for one or both weeks";
  } else if (!sameAccounts(current, prior)) {
    reason = "the tracked account set changed";
  } else if (rules.size !== 1) {
    reason = "the sampling rule varied";
  } else if ([...current, ...prior].some((row) => row.coverage_status !== "complete")) {
    reason = "one or both weeks had incomplete account coverage";
  }

  return {
    platform, current, prior, comparable: !reason, reason,
    currentPosts: postsInWindow(posts, current, period.weekStart, addDays(period.weekEnd, 1)),
    priorPosts: postsInWindow(posts, prior, period.priorWeekStart, period.weekStart),
  };
}

const aboutTopic = (post: PostObservation, key: string) =>
  post.topics.some((topic) => normalizedLabel(topic) === key);

function topicComparison(window: PlatformWindow, key: string): Comparison {
  const activeAccounts = (posts: PostObservation[]) =>
    new Set(posts.filter((post) => aboutTopic(post, key)).map(accountId)).size;
  const current = activeAccounts(window.currentPosts);
  const prior = activeAccounts(window.priorPosts);

  return {
    platform: window.platform,
    status: window.comparable ? (current >= 2 && current > prior ? "rising" : "comparable") : "observed",
    currentAccounts: current,
    priorAccounts: window.prior.length ? prior : null,
    currentTrackedAccounts: window.current.length,
    priorTrackedAccounts: window.prior.length || null,
    ...(!window.comparable && { note: `Observed this week. ${window.reason[0].toUpperCase()}${window.reason.slice(1)}.` }),
  };
}

type AnalyzedComment = {
  original: CommentObservation;
  postGroup: string;
  excerpt: string;
  source: string | null;
};

function independent(left: AnalyzedComment, right: AnalyzedComment): boolean {
  return left.postGroup !== right.postGroup &&
    left.excerpt !== right.excerpt &&
    (!left.source || !right.source || left.source !== right.source) &&
    (!left.original.independence_key || !right.original.independence_key ||
      left.original.independence_key !== right.original.independence_key);
}

function questionEvidence(
  comments: CommentObservation[], posts: PostObservation[],
): { questions: RecurringQuestion[]; singleQuestions: string[] } {
  const parents = new Map(posts.map((post) => [postId(post), post]));
  const themes = new Map<string, AnalyzedComment[]>();
  for (const comment of comments) {
    const parent = parents.get(postId(comment));
    if (!parent || (parent.comment_access !== "available" && parent.comment_access !== "partial")) continue;
    if (new Date(comment.observed_at) < new Date(parent.published_at)) continue;
    const theme = normalizedLabel(comment.question_theme);
    const matching = themes.get(theme) ?? [];
    matching.push({
      original: comment,
      postGroup: parent.repost_key ? `repost:${parent.repost_key}` : postId(parent),
      excerpt: normalizedLabel(comment.excerpt),
      source: comment.source_url,
    });
    themes.set(theme, matching);
  }

  const questions: RecurringQuestion[] = [];
  const singleQuestions: string[] = [];
  for (const [key, evidence] of [...themes.entries()].sort(([a], [b]) => a.localeCompare(b, "en-US"))) {
    let pair: AnalyzedComment[] | undefined;
    for (const [index, first] of evidence.entries()) {
      for (let next = index + 1; next < evidence.length; next++) {
        if (independent(first, evidence[next])) {
          pair = [first, evidence[next]];
          break;
        }
      }
      if (pair) break;
    }

    if (!pair) {
      singleQuestions.push(evidence[0].original.question_theme);
      continue;
    }
    for (const candidate of evidence) {
      if (pair.length === 6) break;
      if (pair.every((selected) => independent(selected, candidate))) pair.push(candidate);
    }
    questions.push({ key, theme: pair[0].original.question_theme, comments: pair.map((item) => item.original) });
  }
  return { questions, singleQuestions };
}

function summarizeCoverage(windows: PlatformWindow[]): string {
  return windows.map((window) => {
    const title = window.platform === "tiktok" ? "TikTok" : "Instagram";
    return window.comparable
      ? `${title}: all ${window.current.length} tracked accounts were checked in both weeks.`
      : `${title}: ${window.reason} (${window.prior.length} tracked last week, ${window.current.length} this week).`;
  }).join(" ");
}

function candidateFor(prospect: Prospect, topic: DraftTopic | null): DraftCandidate {
  const gaps: string[] = [];
  if (!topic?.comparisons.some((comparison) => comparison.status === "rising")) {
    gaps.push("No comparable rising signal.");
  }
  if (!topic?.questions.length) gaps.push("No shopper question with independent evidence on two posts.");
  return {
    id: `candidate-${fingerprint(prospectKey(prospect)).slice(0, 24)}`,
    prospect, topic, eligible: gaps.length === 0, gaps,
  };
}

export function buildDraft(
  batch: Batch, { category, cohortKey, now = new Date(), weekStart = latestCompleteWeek(now) }:
  { category: string; cohortKey: string; weekStart?: string; now?: Date },
): Draft {
  if (!isMonday(weekStart)) throw new Error("The requested week must start on a Monday (YYYY-MM-DD).");
  if (weekStart > latestCompleteWeek(now)) throw new Error("The requested week has not ended in America/Los_Angeles.");

  const categoryKey = normalizedLabel(category);
  const accounts = batch.accounts.filter((row) =>
    normalizedLabel(row.category) === categoryKey && row.cohort_key === cohortKey);
  if (!accounts.length) throw new Error("No coverage rows match the requested category and cohort.");
  const categoryLabel = accounts[0].category;
  const period: Period = {
    weekStart, weekEnd: addDays(weekStart, 6),
    priorWeekStart: addDays(weekStart, -7), priorWeekEnd: addDays(weekStart, -1),
    timezone: "America/Los_Angeles",
  };
  const observedAccounts: AccountObservation[] = accounts.map((account) =>
    new Date(account.checked_at) <= now ? account : {
      ...account, coverage_status: "unknown", coverage_reason: "The check is after the review cutoff.",
    });
  const posts = batch.posts.filter((post) => new Date(post.observed_at) <= now);
  const comments = batch.comments.filter((comment) => new Date(comment.observed_at) <= now);
  const windows = platforms.map((platform) => inspectWindow(platform, observedAccounts, posts, period));
  const watched = windows.filter((window) => window.prior.length || window.current.length);
  const currentPosts = watched.flatMap((window) => window.currentPosts);
  const labels = new Map<string, string>();
  for (const post of currentPosts) {
    for (const label of post.topics) labels.set(normalizedLabel(label), label);
  }

  const topics = [...labels.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en-US"))
    .map(([key, label]) => {
      const topicalPosts = currentPosts.filter((post) => aboutTopic(post, key));
      return {
        key, label,
        comparisons: watched.map((window) => topicComparison(window, key)),
        currentPosts: topicalPosts,
        ...questionEvidence(comments, topicalPosts),
      };
    });
  const candidates = batch.prospects
    .filter((prospect) => normalizedLabel(prospect.category) === categoryKey && prospect.checked_on <= localDate(now))
    .map((prospect) => candidateFor(
      prospect, topics.find((topic) => topic.key === normalizedLabel(prospect.topic)) ?? null,
    ));
  const draft = {
    fixture: batch.fixture,
    category: categoryLabel,
    cohortKey,
    period,
    coverageNote: summarizeCoverage(windows),
    coverage: windows.flatMap((window) => [...window.prior, ...window.current])
      .sort((a, b) => a.week_start.localeCompare(b.week_start, "en-US") || accountId(a).localeCompare(accountId(b), "en-US")),
    comparablePlatforms: windows.filter((window) => window.comparable).map((window) => window.platform),
    topics,
    candidates,
  };
  return { ...draft, fingerprint: fingerprint(draft) };
}
