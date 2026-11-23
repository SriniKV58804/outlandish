import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildDraft, latestCompleteWeek } from "../lib/editorial/analysis.ts";
import type { Batch, PostObservation } from "../lib/editorial/batch.ts";
import { parseCsv } from "../lib/editorial/csv.ts";
import { fingerprint, loadBatch } from "../lib/editorial/import.ts";

const category = "Beauty tools";
const cohortKey = "qa-cohort";
const weekStart = "2026-06-08";
const priorWeekStart = "2026-06-01";
const checkedAt = "2026-06-15T17:00:00Z";
const options = { category, cohortKey, weekStart, now: new Date(checkedAt) };
const topic = "Short curling rods";

function sampleBatch(): Batch {
  const observedAt = checkedAt;
  const post = (
    platform: PostObservation["platform"], key: string, account: string, publishedAt: string,
  ): PostObservation => ({
    platform,
    post_key: key,
    account_key: account,
    published_at: publishedAt,
    observed_at: observedAt,
    topics: [topic],
    source_url: platform === "tiktok"
      ? `https://tiktok.com/@${account}/video/${key}`
      : `https://instagram.com/reel/${key}`,
    caption: null,
    preview_url: null,
    views: null,
    likes: null,
    comment_access: "available",
    repost_key: null,
  });
  return {
    fixture: true,
    accounts: [priorWeekStart, weekStart].flatMap((week) =>
      [["tiktok", "one"], ["tiktok", "two"], ["tiktok", "silent"], ["instagram", "one"]].map(
        ([platform, account]) => ({
          category,
          cohort_key: cohortKey,
          platform: platform as PostObservation["platform"],
          account_key: account,
          profile_url: `https://${platform}.com/${account}`,
          week_start: week,
          sampling_rule: "all-posts",
          coverage_status: "complete",
          checked_at: observedAt,
          coverage_reason: null,
        }),
      ),
    ),
    posts: [
      post("tiktok", "11", "one", "2026-06-08T06:59:59.999Z"),
      post("tiktok", "12", "one", "2026-06-08T07:00:00Z"),
      post("tiktok", "13", "one", "2026-06-11T17:00:00Z"),
      post("tiktok", "14", "two", "2026-06-15T06:59:59.999Z"),
      post("tiktok", "15", "silent", "2026-06-15T07:00:00Z"),
      post("instagram", "16", "one", "2026-06-11T17:00:00Z"),
    ],
    comments: [
      {
        platform: "tiktok", post_key: "12", comment_key: "first",
        excerpt: "Would this rod fit a bob?", question_theme: "Fit on short hair",
        observed_at: observedAt, source_url: null, independence_key: null,
      },
      {
        platform: "tiktok", post_key: "14", comment_key: "second",
        excerpt: "How would you wrap chin-length hair?", question_theme: "Fit on short hair",
        observed_at: observedAt, source_url: null, independence_key: null,
      },
    ],
    prospects: [{
      category,
      topic,
      brand: "QA brand",
      brand_url: "https://shop.example.com/",
      product: "Demo short rod",
      product_url: "https://shop.example.com/short",
      checked_on: "2026-06-15",
      fit_rationale: "A short rod can be wrapped around a bob.",
      size_basis: "Example brand used only to exercise validation.",
      format: "creator-video",
      pitch: "Film the wrap and reveal the result the following morning.",
      pitch_rationale: "The format can show the overnight result.",
      uncertainty: null,
      editor_note: null,
    }],
  };
}

test("CSV parsing preserves quoted excerpts, line breaks, and blank metrics", () => {
  const csv = '\uFEFFpost,excerpt,views,likes\r\nx,"She said ""yes, thanks"".\r\nA second line.",0,\r\n';
  assert.deepEqual(parseCsv(csv), [
    ["post", "excerpt", "views", "likes"],
    ["x", 'She said "yes, thanks".\r\nA second line.', "0", ""],
  ]);
  assert.throws(() => parseCsv('post,excerpt\n1,"unclosed'), /Unclosed CSV quote on line 2/);
});

test("weekly count uses LA boundaries, distinct accounts, and platform-specific denominators", () => {
  const batch = sampleBatch();
  const draft = buildDraft(batch, options);
  const [result] = draft.topics;
  assert.deepEqual(draft.period, {
    weekStart, weekEnd: "2026-06-14",
    priorWeekStart, priorWeekEnd: "2026-06-07", timezone: "America/Los_Angeles",
  });
  assert.deepEqual(result.comparisons, [
    {
      platform: "tiktok", status: "rising", priorAccounts: 1, currentAccounts: 2,
      priorTrackedAccounts: 3, currentTrackedAccounts: 3,
    },
    {
      platform: "instagram", status: "comparable", priorAccounts: 0, currentAccounts: 1,
      priorTrackedAccounts: 1, currentTrackedAccounts: 1,
    },
  ]);
  assert.deepEqual(result.currentPosts.map((post) => post.post_key), ["12", "13", "14", "16"]);
  assert.equal(result.questions[0].comments.length, 2);
  assert.equal(draft.candidates[0].eligible, true);
  assert.equal(buildDraft(batch, options).fingerprint, draft.fingerprint);

  batch.posts = batch.posts.filter((post) => post.post_key !== "11");
  const [zeroPrior] = buildDraft(batch, options).topics[0].comparisons;
  assert.equal(zeroPrior.priorAccounts, 0);
  assert.equal(zeroPrior.status, "rising");
});

test("the latest complete week changes at Monday midnight in Los Angeles", () => {
  assert.equal(latestCompleteWeek(new Date("2026-06-15T06:59:59.999Z")), priorWeekStart);
  assert.equal(latestCompleteWeek(new Date("2026-06-15T07:00:00Z")), weekStart);
  assert.throws(
    () => buildDraft(sampleBatch(), { ...options, now: new Date("2026-06-15T06:59:59.999Z") }),
    /week has not ended/,
  );
});

test("changed cohort, sampling rule, and partial account coverage never qualify for growth", () => {
  const variants: Array<(batch: Batch) => void> = [
    (batch) => {
      batch.accounts = batch.accounts.filter((account) =>
        account.platform !== "tiktok" || account.week_start !== priorWeekStart || account.account_key !== "silent");
    },
    (batch) => {
      batch.accounts.find((account) => account.platform === "tiktok")!.sampling_rule = "recent-posts";
    },
    (batch) => {
      const gap = batch.accounts.find((account) => account.platform === "tiktok")!;
      gap.coverage_status = "partial";
      gap.coverage_reason = "Only some posts were visible.";
    },
  ];
  for (const change of variants) {
    const batch = sampleBatch();
    change(batch);
    const draft = buildDraft(batch, options);
    assert.equal(draft.topics[0].comparisons[0].status, "observed");
    assert.match(draft.topics[0].comparisons[0].note ?? "", /Observed this week/);
    assert.equal(draft.candidates[0].eligible, false);
  }
});

test("duplicate comments, reposts, and unavailable comments cannot establish recurrence", () => {
  const variants: Array<(batch: Batch) => void> = [
    (batch) => { batch.comments[1].excerpt = "Would  this rod fit a BOB?"; },
    (batch) => {
      for (const post of batch.posts.filter((post) => ["12", "14"].includes(post.post_key))) {
        post.repost_key = "same-video";
      }
    },
    (batch) => { batch.posts.find((post) => post.post_key === "14")!.comment_access = "unavailable"; },
    (batch) => {
      for (const comment of batch.comments) comment.independence_key = "same-observation";
    },
  ];
  for (const change of variants) {
    const batch = sampleBatch();
    change(batch);
    const draft = buildDraft(batch, options);
    assert.deepEqual(draft.topics[0].questions, []);
    assert.deepEqual(draft.topics[0].singleQuestions, ["Fit on short hair"]);
    assert.equal(draft.candidates[0].eligible, false);
  }
});

test("CSV import deduplicates exact repeats and reports malformed rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "outlandish-import-test-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await cp(new URL("../data/fixtures/illustrative/", import.meta.url), directory, { recursive: true });
  const batch = await loadBatch(directory);
  assert.equal(batch.fixture, true);
  assert.ok(batch.posts.length > 0);

  const path = join(directory, "posts.csv");
  const csv = await readFile(path, "utf8");
  const repeatable = csv.trimEnd().split(/\r?\n/)[1];
  await writeFile(path, `${csv.trimEnd()}\n${repeatable}\n`);
  assert.equal(fingerprint(await loadBatch(directory)), fingerprint(batch));

  await writeFile(path, `${csv.trimEnd()}\nwrong,shape\n`);
  await assert.rejects(() => loadBatch(directory), /posts\.csv row \d+: expected \d+ columns, got 2/);
});
