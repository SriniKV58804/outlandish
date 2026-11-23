import type { CollectedPost, CollectionQuery, CollectionSnapshot, Platform } from "../collection/types.ts";
import { pacificMidnight } from "../collection/plan.ts";
import { latestCompleteWeek } from "../editorial/analysis.ts";
import { addDays, isMonday, localDate } from "../editorial/batch.ts";
import { extractMentions, indexObservedTerms, topicKey, type ProductMention } from "./extract.ts";
import { resolveAccounts, findShopperQuestions, sourceGroup, type ShopperQuestion } from "./questions.ts";

export type AnalysisRun = Omit<CollectionSnapshot, "mode"> & {mode: "live" | "replay" | "fixture"};
export interface AnalysisOptions {
  now?: Date;
  /** Reviewed phrase -> canonical product name, or null to discard an erroneous extraction. */
  aliases?: Readonly<Record<string, string | null>>;
}
export interface TopicEvidence extends ProductMention {
  postId: string;
  platform: Platform;
  week: "current" | "prior";
}
export interface TopicComparison {
  platform: Platform;
  status: "rising" | "comparable" | "observed";
  priorAccounts: number | null;
  currentAccounts: number | null;
  priorTrackedAccounts: number | null;
  currentTrackedAccounts: number | null;
  accountDelta: number | null;
  /** Fraction of sampled accounts, e.g. .05 = five percentage points. */
  shareDelta: number | null;
  note: string;
}
export interface DiscoveryTopic {
  key: string;
  label: string;
  evidence: TopicEvidence[];
  comparisons: TopicComparison[];
  shopperQuestions: ShopperQuestion[];
  commentCoverage: {posts: number; withExcerpts: number; emptySubsets: number; unavailable: number};
  score: number | null;
  currentIndependentPosts: number;
  corroboratedQuestionPosts: number;
  supportingSampleAccounts: number;
}
export interface WindowCoverage {
  platform: Platform;
  weekStart: string;
  checkedDays: number;
  returnedRows: number;
  sampledAccounts: number | null;
  unidentifiedPosts: number;
  reason: string | null;
}
const platforms = ["tiktok", "instagram"] as const;

function uniquePosts(posts: CollectedPost[]): CollectedPost[] {
  const latest = new Map<string, CollectedPost>();
  for (const post of posts) {
    const id = post.platform + ":" + (post.platformId || post.id);
    const existing = latest.get(id);
    if (!existing || post.observedAt > existing.observedAt ||
      (post.observedAt === existing.observedAt && post.id < existing.id)) latest.set(id, post);
  }
  const seen = new Set<string>();
  return [...latest.values()].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id)).filter(post => {
    const signature = post.platform + ":" + sourceGroup(post);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

interface SampleWindow {
  days: CollectionQuery[];
  posts: CollectedPost[];
  coverage: WindowCoverage;
}

function usable(query: CollectionQuery): boolean {
  if (!query.day || !query.start || !query.end || query.status !== "done" || query.returned === null) return false;
  const start = Date.parse(query.start);
  const end = Date.parse(query.end);
  return Number.isFinite(start) && Number.isFinite(end) && start < end &&
    localDate(new Date(start)) === query.day && localDate(new Date(end - 1)) === query.day;
}

type IdentifyAccount = (post: CollectedPost) => string | null;
function sampleWindow(run: AnalysisRun, posts: CollectedPost[], platform: Platform, weekStart: string, identify: IdentifyAccount): SampleWindow {
  const end = addDays(weekStart, 7);
  const days = run.queries.filter(q => q.kind === "search" && q.platform === platform && q.day && q.day >= weekStart && q.day < end)
    .sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  const checked = days.filter(usable);
  const bounds = checked.map(q => [Date.parse(q.start!), Date.parse(q.end!)]);
  const sampled = posts.filter(post => {
    const when = Date.parse(post.publishedAt);
    return post.platform === platform && bounds.some(([start, stop]) => when >= start && when < stop);
  });
  const distinctDays = new Set(checked.map(q => q.day)).size;
  const unknown = sampled.filter(post => !identify(post)).length;
  let reason = null;
  if (run.purpose !== "discovery") reason = "The access probe does not cover a reporting week.";
  else if (distinctDays !== 7 || days.length !== 7) reason = "The planned sample did not complete exactly once on all seven days.";
  else if (unknown) reason = "Some sampled posts lack an account identity.";
  return {days, posts: sampled, coverage: {
    platform, weekStart, checkedDays: distinctDays, returnedRows: checked.reduce((n, q) => n + (q.returned ?? 0), 0),
    sampledAccounts: checked.length ? new Set(sampled.map(identify).filter(Boolean)).size : null,
    unidentifiedPosts: unknown, reason,
  }};
}

function sameSampling(prior: SampleWindow, current: SampleWindow): boolean {
  if (prior.days.length !== 7 || current.days.length !== 7) return false;
  return prior.days.every((a, index) => {
    const b = current.days[index];
    return a.method === b.method && a.sort === b.sort && a.offset === b.offset && a.limit === b.limit &&
      a.limit > 0 && a.day && b.day && b.day === addDays(a.day, 7) && sameSlot(a, b);
  });
}

// Express the slice as fractions of its actual Pacific day. The DST-change
// Sunday can be 23 or 25 hours while still using the same planned sampling slot.
function sameSlot(a: CollectionQuery, b: CollectionQuery): boolean {
  function slot(q: CollectionQuery) {
    if (!q.day || !q.start || !q.end) return [];
    const start = pacificMidnight(q.day);
    const length = pacificMidnight(addDays(q.day, 1)) - start;
    return [(Date.parse(q.start) - start) / length, (Date.parse(q.end) - start) / length];
  }
  const left = slot(a), right = slot(b);
  return left.length === 2 && right.length === 2 && left.every((v, i) => Math.abs(v - right[i]) < 0.0000001);
}

interface PlatformPair {
  platform: Platform;
  current: SampleWindow;
  prior: SampleWindow;
  reason: string | null;
}

function compare(pair: PlatformPair, ids: Set<string>, identify: IdentifyAccount): TopicComparison {
  function count(window: SampleWindow) {
    return window.coverage.sampledAccounts === null ? null :
      new Set(window.posts.filter(p => ids.has(p.id)).map(identify).filter(Boolean)).size;
  }
  const currentAccounts = count(pair.current), priorAccounts = count(pair.prior);
  const currentTrackedAccounts = pair.current.coverage.sampledAccounts, priorTrackedAccounts = pair.prior.coverage.sampledAccounts;
  const shareDelta = !pair.reason && currentAccounts !== null && priorAccounts !== null && currentTrackedAccounts && priorTrackedAccounts
    ? currentAccounts / currentTrackedAccounts - priorAccounts / priorTrackedAccounts : null;
  const accountDelta = shareDelta !== null && currentAccounts !== null && priorAccounts !== null ? currentAccounts - priorAccounts : null;
  const status = shareDelta === null ? "observed" : currentAccounts !== null && currentAccounts >= 2 && shareDelta > 0 ? "rising" : "comparable";
  return {
    platform: pair.platform, status, currentAccounts, priorAccounts, currentTrackedAccounts, priorTrackedAccounts, accountDelta, shareDelta,
    note: pair.reason ?? "Compared the share of distinct accounts in matched daily samples.",
  };
}

function reviewedKeys(aliases: AnalysisOptions["aliases"]) {
  const values = new Map<string, string | null>();
  for (const [phrase, target] of Object.entries(aliases ?? {})) {
    const key = topicKey(phrase);
    if (!key || (target !== null && !target.trim())) throw new Error("A reviewed topic name is empty.");
    if (target === null || key !== topicKey(target)) values.set(key, target === null ? null : topicKey(target));
  }
  function resolve(original: string): string | null {
    let key: string | null = original;
    const seen = new Set<string>();
    while (key !== null && values.has(key)) {
      if (seen.has(key)) throw new Error("Reviewed topic merges contain a cycle.");
      seen.add(key);
      key = values.get(key)!;
    }
    return key;
  }
  for (const key of values.keys()) resolve(key);
  return resolve;
}

export function analyzeDiscovery(run: AnalysisRun, options: AnalysisOptions = {}) {
  if (!isMonday(run.weekStart) || run.weekStart > latestCompleteWeek(options.now)) {
    throw new Error("The reporting week must be a completed Pacific week starting on Monday.");
  }
  const priorWeekStart = addDays(run.weekStart, -7);
  const dates = [priorWeekStart, addDays(run.weekStart, 7)];
  const posts = uniquePosts(run.posts.filter(post => {
    if (!Number.isFinite(Date.parse(post.publishedAt))) return false;
    const day = localDate(post.publishedAt);
    return day >= dates[0] && day < dates[1];
  }));
  const identify = resolveAccounts(posts);
  const pairs: PlatformPair[] = platforms.map(platform => {
    const prior = sampleWindow(run, posts, platform, priorWeekStart, identify);
    const current = sampleWindow(run, posts, platform, run.weekStart, identify);
    const reason = current.coverage.reason || prior.coverage.reason ||
      (!sameSampling(prior, current) ? "Sampling limits, dates or ordering differ between the two weeks." : null) ||
      (!current.coverage.sampledAccounts || !prior.coverage.sampledAccounts ? "At least one sampled week has no identifiable accounts." : null);
    return {platform, prior, current, reason};
  });
  const resolve = reviewedKeys(options.aliases);
  const mentions = new Map<string, TopicEvidence[]>();
  const topicTerms = new Map<string, Set<string>>();
  const currentPosts = pairs.flatMap(p => p.current.posts);
  const sampledPosts = pairs.flatMap(pair => [...pair.prior.posts, ...pair.current.posts]);
  const seeds = new Map(sampledPosts.map(post => [post.id, extractMentions(post)]));
  const findNamedProducts = indexObservedTerms([...seeds.values()].flat());
  for (const {current, prior} of pairs) {
    for (const [week, rows] of [["current", current.posts], ["prior", prior.posts]] as const) {
      for (const post of rows) {
        const terms = new Set<string>();
        topicTerms.set(post.id, terms);
        const initial = seeds.get(post.id) ?? [];
        const known = new Set(initial.map(o => [o.field, o.frameId ?? "", o.key].join("\t")));
        const additional = findNamedProducts(post).filter(o => !known.has([o.field, o.frameId ?? "", o.key].join("\t")));
        for (const occurrence of [...initial, ...additional]) {
          const key = resolve(occurrence.key);
          if (key === null) continue;
          terms.add(key);
          const existing = mentions.get(key) ?? [];
          existing.push({...occurrence, key, postId: post.id, platform: post.platform, week});
          mentions.set(key, existing);
        }
      }
    }
  }
  const ranked: DiscoveryTopic[] = [], observed: DiscoveryTopic[] = [];
  for (const [key, evidence] of mentions) {
    const ids = new Set(evidence.map(e => e.postId));
    const topical = currentPosts.filter(post => ids.has(post.id));
    if (!topical.length) continue;
    const comparisons = pairs.map(pair => compare(pair, ids, identify));
    const comparable = comparisons.filter(c => c.shareDelta !== null);
    const score = comparable.length ? comparable.reduce((total, c) => total + c.shareDelta!, 0) / comparable.length : null;
    const shopperQuestions = findShopperQuestions(topical, topicTerms, key, identify);
    const topic: DiscoveryTopic = {
      key, label: key[0].toLocaleUpperCase("en-US") + key.slice(1), evidence, comparisons, shopperQuestions, score,
      commentCoverage: {
        posts: topical.length, withExcerpts: topical.filter(p => p.commentCoverage === "available").length,
        emptySubsets: topical.filter(p => p.commentCoverage === "empty_subset").length,
        unavailable: topical.filter(p => p.commentCoverage === "unavailable").length,
      },
      currentIndependentPosts: new Set(topical.filter(p => comparable.some(c => c.platform === p.platform)).map(sourceGroup)).size,
      corroboratedQuestionPosts: new Set(shopperQuestions.filter(q => q.recurring && comparable.some(c => c.platform === q.platform)).map(q => q.postId)).size,
      supportingSampleAccounts: comparable.reduce((n, c) => c.currentAccounts ? n + c.currentTrackedAccounts! + c.priorTrackedAccounts! : n, 0),
    };
    if (score !== null && score > 0 && comparisons.some(c => c.status === "rising")) ranked.push(topic);
    else observed.push(topic);
  }
  const byEvidence = (a: DiscoveryTopic, b: DiscoveryTopic) => (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
    b.supportingSampleAccounts - a.supportingSampleAccounts || b.currentIndependentPosts - a.currentIndependentPosts ||
    b.corroboratedQuestionPosts - a.corroboratedQuestionPosts || b.shopperQuestions.length - a.shopperQuestions.length || a.key.localeCompare(b.key, "en");
  ranked.sort(byEvidence);
  observed.sort(byEvidence);
  const coverage = pairs.map(({platform, prior, current, reason}) => ({platform, prior: prior.coverage, current: current.coverage, comparable: !reason, reason}));
  const source = run.mode === "live" ? "monitored Oriane sample" : run.mode === "replay" ? "replayed observations" : "synthetic test observations";
  const coverageNote = "Coverage is limited to the " + source + ". " + coverage.map(c =>
    (c.platform === "tiktok" ? "TikTok" : "Instagram") + ": " + c.prior.checkedDays + "/7 prior days, " +
    c.current.checkedDays + "/7 current days." + (c.reason ? " " + c.reason : "")).join(" ");
  return {runId: run.runId, mode: run.mode, weekStart: run.weekStart, priorWeekStart, coverage, coverageNote, ranked, observed};
}
