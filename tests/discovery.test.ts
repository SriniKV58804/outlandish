import assert from "node:assert/strict";
import test from "node:test";
import { analyzeDiscovery, type AnalysisRun } from "../lib/discovery/analyze.ts";
import { extractMentions } from "../lib/discovery/extract.ts";
import { makePlan } from "../lib/collection/plan.ts";
import type { CollectedPost, CollectionQuery, Platform } from "../lib/collection/types.ts";

const now = new Date("2026-11-09T18:00:00Z");
const plan = makePlan("discovery", 29, 100, now);
const currentMonday = plan.weekStart;
const priorMonday = "2026-10-26";

function observation(id: string, platform: Platform, day: string, caption: string, changes: Partial<CollectedPost> = {}): CollectedPost {
  const query = plan.queries.find(q => q.platform === platform && q.day === day)!;
  return {
    id, platform, platformId: id, profileId: id, profileHandle: null, profilePlatformId: null,
    publishedAt: new Date(Date.parse(query.start!) + 1000).toISOString(), observedAt: now.toISOString(),
    caption, title: null, transcript: null, onScreenText: null, profileBio: null, thumbnailUrl: null, sourceUrl: null,
    sourceStatus: "unavailable", viewsCount: null, commentsCount: null, commentCoverage: "unavailable", comments: [], frames: [], ...changes,
  };
}
function fixture(posts: CollectedPost[]): AnalysisRun {
  const queries: CollectionQuery[] = plan.queries.map(q => {
    const returned = posts.filter(p => q.platform === p.platform && p.publishedAt >= q.start! && p.publishedAt < q.end!).length;
    return {...q, status: "done", attempts: 1, returned, accepted: returned, reason: null, nextAttemptAt: null, coverage: null};
  });
  return {mode: "fixture", runId: "test-captured-observations", status: "complete", purpose: "discovery",
    strategy: plan.strategy, weekStart: currentMonday, budget: 29, requests: 29, startedAt: now.toISOString(), completedAt: now.toISOString(), queries, posts};
}

const post = (id: string, day: string, caption: string, changes: Partial<CollectedPost> = {}) =>
  observation(id, "tiktok", day, caption, changes);
const review = (name: string) => "Reviewing the " + name + " after two weeks.";
const analyze = (run: AnalysisRun) => analyzeDiscovery(run, {now});

test("new text alone introduces an unfamiliar product and reverses winners without changing search or taxonomy", () => {
  const current = (name: string, prefix: string, n: number) =>
    Array.from({length: n}, (_, index) => post(prefix + index, currentMonday, review(name)));
  const baseline = [
    post("bg-1", priorMonday, "Dance challenge with my family."), post("bg-2", priorMonday, "An evening walk."),
    post("bg-3", priorMonday, "Skating clips."), post("bg-4", priorMonday, "Saturday."),
    ...current("felt desk mat", "desk", 3), ...current("glass teapot", "pot", 2), ...current("bicycle bell", "bell", 2),
  ];
  const base = analyze(fixture(baseline));
  assert.equal(base.ranked[0].key, "felt desk mat");
  const novel = current("spindle whorl", "pottery", 5);
  const changed = analyze(fixture([...baseline, ...novel]));
  assert.equal(changed.ranked[0].key, "spindle whorl");
  assert.equal(changed.ranked.length, 4, "qualification must precede the overall publication limit");
  assert.deepEqual(changed.ranked[0].evidence.map(e => e.phrase), Array(5).fill("spindle whorl"));
  const reverse = analyze(fixture([...baseline, ...novel, ...current("felt desk mat", "new-desk", 5)]));
  assert.equal(reverse.ranked[0].key, "felt desk mat");
  assert.equal(reverse.ranked[1].key, "spindle whorl");
  assert.equal(changed.mode, "fixture");
  assert.match(changed.coverageNote, /synthetic test/);
  assert.equal(changed.ranked[0].shopperQuestions.length, 0);
});

test("uses distinct accounts and platform shares, including non-shopping accounts in denominators", () => {
  const prior = Array.from({length: 10}, (_, i) => post("old" + i, priorMonday, i === 0 ? review("ash tray") : "A sunset."));
  const current = Array.from({length: 40}, (_, i) => post("new" + i, currentMonday, i < 2 ? review("ash tray") : "A sunset."));
  const duplicate = {...current[0], id: "renamed-oriane-id", observedAt: "2026-11-09T19:00:00Z"};
  const sameCreator = post("same-creator", currentMonday, review("ash tray"), {profileId: "new0"});
  const instagram = [observation("insta-old", "instagram", priorMonday, "An evening."),
    observation("insta-new", "instagram", currentMonday, review("wooden spoon"))];
  const draft = analyze(fixture([...prior, ...current, duplicate, sameCreator, ...instagram]));
  const tray = draft.observed.find(t => t.key === "ash tray")!;
  assert.deepEqual(tray.comparisons.map(c => [c.priorAccounts, c.currentAccounts, c.priorTrackedAccounts, c.currentTrackedAccounts]), [[1, 2, 10, 40], [0, 0, 1, 1]]);
  assert.equal(tray.comparisons[0].accountDelta, 1);
  assert.equal(tray.comparisons[0].shareDelta, -.05);
  assert.equal(draft.ranked.length, 0);
  assert.equal(tray.evidence.filter(e => e.week === "current").length, 3);
});

test("missing slices, altered query geometry, unknown accounts, and probes cannot establish a rise", () => {
  const rows = [post("old", priorMonday, "An evening walk."), post("new1", currentMonday, review("stereo microscope")), post("new2", currentMonday, review("stereo microscope"))];
  const snapshot = fixture(rows);
  assert.equal(analyze(snapshot).ranked[0].key, "stereo microscope");
  const missing = structuredClone(snapshot);
  missing.queries.find(q => q.platform === "tiktok" && q.day === "2026-11-03")!.status = "failed";
  assert.match(analyze(missing).coverage[0].reason!, /seven days/);
  assert.equal(analyze(missing).ranked.length, 0);
  assert.equal(analyze(missing).observed[0].comparisons[0].shareDelta, null);
  const altered = structuredClone(snapshot);
  altered.queries.find(q => q.platform === "tiktok" && q.day === "2026-11-03")!.limit = 2;
  assert.equal(analyze(altered).ranked.length, 0);
  const shifted = structuredClone(snapshot);
  const slice = shifted.queries.find(q => q.platform === "tiktok" && q.day === currentMonday)!;
  slice.end = new Date(Date.parse(slice.end!) - 60_000).toISOString();
  assert.equal(analyze(shifted).ranked.length, 0);
  const unknown = fixture([...rows, post("missing-id", priorMonday, "Beach.", {profileId: null})]);
  assert.equal(analyze(unknown).ranked.length, 0);
  const probe = {...snapshot, purpose: "probe"} as const;
  assert.equal(analyze(probe).ranked.length, 0);
  assert.throws(() => analyzeDiscovery({...snapshot, weekStart: "2026-11-09"}, {now}), /completed Pacific week/);
});

test("enforces half-open time windows and a comparable seven-day strategy across the fall DST change", () => {
  const sunday = plan.queries.find(q => q.platform === "tiktok" && q.day === "2026-11-01")!;
  const outside = post("outside", priorMonday, review("fountain pen"), {publishedAt: sunday.end!});
  const inside = post("inside", priorMonday, "Walked downtown.", {publishedAt: sunday.start!});
  const snapshot = fixture([outside, inside, post("new1", currentMonday, review("fountain pen")), post("new2", currentMonday, review("fountain pen"))]);
  const topic = analyze(snapshot).ranked[0];
  assert.equal(topic.comparisons[0].priorAccounts, 0);
  assert.equal(topic.comparisons[0].priorTrackedAccounts, 1);
  assert.equal(topic.comparisons[0].shareDelta, 1);
});

test("extracts from original transcript and frame text, merges reviewed synonyms, and keeps separate product types", () => {
  const first = post("one", currentMonday, "Unboxing!", {transcript: "Testing my lap desks at home.", frames: [{id: "frame-2", text: "Canvas sleeve", url: null, at: 5}]});
  const second = post("two", currentMonday, "Lap tray review.");
  const third = post("three", currentMonday, "Unboxing my laptop stand.");
  const snapshot = fixture([first, second, third, post("bg", priorMonday, "A parade.")]);
  const result = analyzeDiscovery(snapshot, {now, aliases: {"lap tray": "lap desk"}});
  assert.equal(result.ranked[0].key, "lap desk");
  assert.deepEqual(result.ranked[0].evidence.map(e => [e.field, e.phrase]), [["transcript", "lap desks"], ["caption", "Lap tray"]]);
  const frameEvidence = result.observed.find(t => t.key === "canvas sleeve")!.evidence[0];
  assert.equal(frameEvidence.frameId, "frame-2");
  assert.equal(frameEvidence.field, "frameText");
  assert(result.observed.some(t => t.key === "laptop stand"));
  assert.throws(() => analyzeDiscovery(snapshot, {now, aliases: {"lap tray":"lap desk", "lap desk":"lap tray"}}), /cycle/);
  for (const caption of ["Trying a new dance challenge, watch our video!", "Trying not to laugh challenge", "Testing my patience today", "Reviewing my life choices"]) {
    assert.deepEqual(extractMentions(post("noise", currentMonday, caption)), []);
  }
});

test("ties shopper wording to source posts and requires independent matching questions for recurrence", () => {
  function asked(id: string, question: string, changes: Partial<CollectedPost> = {}) {
    return post(id, currentMonday, review("camp kettle"), {commentCoverage: "available",
      comments: [{id: "comment-"+id, text: question, publishedAt: now.toISOString(), profileId: id + "-shopper", likesCount: null, repliesCount: null}], ...changes});
  }
  const first = asked("a", "Does this work on induction?");
  const second = asked("b", "Can I use it with my induction burner?");
  const wrong = asked("c", "Will this work on gas?");
  const anonymous = asked("d", "Is shipping available?", {commentCoverage: "unavailable"});
  const duplicate = {...first, platformId: "a", id: "a-duplicate", observedAt: "2026-11-09T17:00:00Z"};
  const ambiguous = asked("e", "Does it work on induction?", {caption:"Unboxing my camp kettle. Reviewing a frying pan."});
  const bg = post("old", priorMonday, "Football practice.");
  const result = analyze(fixture([first, second, wrong, anonymous, duplicate, ambiguous, bg])).ranked.find(t => t.key === "camp kettle")!;
  assert.deepEqual(result.shopperQuestions.map(q=>[q.postId, q.excerpt, q.recurring]), [
    ["a","Does this work on induction?",true], ["b","Can I use it with my induction burner?",true], ["c","Will this work on gas?",false],
  ]);
  assert.equal(result.shopperQuestions[0].publishedAt, now.toISOString(), "preserve question timing even when later than its reporting week");
  assert.equal(result.shopperQuestions[0].observedAt, first.observedAt);
  const overlappingOnlyOnProduct = analyze(fixture([
    asked("first", "Does the camp kettle work on induction?"), asked("second", "Will the camp kettle work on gas?"), bg,
  ])).ranked[0];
  assert(overlappingOnlyOnProduct.shopperQuestions.every(q => !q.recurring));
  const one = analyze(fixture([first, wrong, bg])).ranked[0];
  assert(one.shopperQuestions.every(q => !q.recurring));
  const zeros = analyze(fixture([post("x", currentMonday, review("camp kettle"), {commentsCount: 300, commentCoverage:"empty_subset"}), bg]));
  assert.equal(zeros.observed[0].shopperQuestions.length, 0);
  assert.equal(zeros.observed[0].commentCoverage.emptySubsets, 1);
});

test("identifiable reuploads do not create new independent accounts for a topic", () => {
  const recorded = "Today I took this to the studio so that I could show you every single step of the process I used to make my first piece.";
  const first = post("first", priorMonday, review("banding wheel"), {transcript: recorded});
  const reupload = post("copy", currentMonday, first.caption!, {transcript: recorded});
  const other = post("other", currentMonday, "Banding wheel review.");
  const result = analyze(fixture([first, reupload, other])).observed[0];
  assert.equal(result.comparisons[0].currentAccounts, 1);
  assert.equal(result.comparisons[0].priorAccounts, 1);
  assert.equal(result.shopperQuestions.length, 0);
});

test("a newly observed shopping phrase also finds unprompted mentions and hashtags in the matched sample", () => {
  const bg = post("old", priorMonday, "A view of the coast.");
  const named = post("named", currentMonday, "Unboxing: this porcelain dip pen.");
  const neutral = post("neutral", currentMonday, "Make a drawing along with me. #PorcelainDipPen");
  const noise = post("noise", currentMonday, "The porcelain dip peninsula was beautiful.");
  const result = analyze(fixture([bg, named, neutral, noise]));
  assert.equal(result.ranked[0].key, "porcelain dip pen");
  assert.deepEqual(result.ranked[0].evidence.map(e => e.phrase), ["porcelain dip pen", "#PorcelainDipPen"]);
  assert.equal(result.ranked[0].comparisons[0].currentAccounts, 2);
});

test("does not inflate demand when account identities are partially populated across observations", () => {
  const prior = post("old", priorMonday, "Walking the dog.");
  const native = post("a", currentMonday, review("ink reservoir"), {profileId: "provider-one", profilePlatformId: "native-one", profileHandle: "InkStudio"});
  const providerOnly = post("b", currentMonday, review("ink reservoir"), {profileId: "provider-one"});
  const handleOnly = post("c", currentMonday, review("ink reservoir"), {profileId: null, profileHandle:"@INKSTUDIO"});
  const run = fixture([prior, native, providerOnly, handleOnly]);
  const result = analyze(run);
  assert.equal(result.ranked.length, 0);
  assert.equal(result.observed[0].comparisons[0].currentAccounts, 1);
  const reused = fixture([...run.posts, post("different", currentMonday, "Walked the dog.", {profileId:"other", profilePlatformId:"native-two", profileHandle:"inkstudio"})]);
  assert.match(analyze(reused).coverage[0].reason!, /lack an account identity/);
});
