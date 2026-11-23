import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  latestBriefSchema,
  opportunityDetailSchema,
} from "../lib/contracts.ts";
import type { LatestBrief, OpportunityDetail } from "../lib/contracts.ts";
import { buildDraft } from "../lib/editorial/analysis.ts";
import type { Batch } from "../lib/editorial/batch.ts";
import { loadBatch } from "../lib/editorial/import.ts";
import { finalizePublication } from "../lib/editorial/publication.ts";

const viewer = "003b1533-0258-4a28-bff3-782a8ae9776e";
const editor = "a1abbc9c-db8d-4e14-8bfd-b8c125508c88";
const nonmember = "f1275d96-551d-445a-b8c2-5d56480494b6";
const inactive = "6df7924a-19be-4a09-a804-b4875852d2bb";
const june = {
  weekStart: "2026-06-01", weekEnd: "2026-06-07",
  priorWeekStart: "2026-05-25", priorWeekEnd: "2026-05-31",
};
const followingWeek = {
  weekStart: "2026-06-08", weekEnd: "2026-06-14",
  priorWeekStart: "2026-06-01", priorWeekEnd: "2026-06-07",
};

function revision(
  revisionId: string,
  dates = june,
  finding = "Two tracked accounts discussed fit.",
) {
  const comparison = {
    platform: "tiktok",
    status: "rising",
    priorAccounts: 0,
    currentAccounts: 2,
    priorTrackedAccounts: 3,
    currentTrackedAccounts: 3,
  } as const;
  const id = `${revisionId}-fit`;
  const topic = "Curling rod fit";
  const posts: OpportunityDetail["posts"] = ["first", "second"].map((label) => ({
    postId: label,
    platform: "tiktok",
    imageUrl: null,
    alt: `Test clip ${label}`,
    views: 0,
    sourceUrl: `https://www.tiktok.com/@test/video/${label === "first" ? "123" : "456"}`,
    publishedAt: `${dates.weekStart}T12:00:00-07:00`,
    observedAt: `${dates.weekEnd}T17:00:00-07:00`,
    commentAvailability: "available",
  }));
  const comments = posts.map((post, index) => ({
    id: `shopper-${index}`,
    postId: post.postId,
    excerpt: index === 0 ? "Would it fit a bob?" : "Does this work on chin-length hair?",
    observedAt: post.observedAt,
    sourceUrl: post.sourceUrl,
  }));
  const summary: Extract<LatestBrief, { state: "published" }> = {
    state: "published",
    id: `beauty-tools-${dates.weekStart}`,
    revisionId,
    category: "beauty-tools",
    ...dates,
    timezone: "America/Los_Angeles",
    coverageNote: "Three tracked TikTok accounts were checked both weeks.",
    opportunities: [{
      id, topic, finding, comparison,
      previews: posts.map(({ postId, platform, imageUrl, alt, views }) => ({
        postId, platform, imageUrl, alt, views,
      })),
    }],
  };
  const details: OpportunityDetail[] = [{
    id, topic, finding,
    period: { ...dates, timezone: "America/Los_Angeles" },
    comparisons: [comparison],
    shopperQuestion: "Will the rod fit chin-length hair?",
    posts, comments,
    product: {
      brand: "QA test brand",
      name: "Short rod",
      sourceUrl: "https://shop.example.com/products/short-rod",
      checkedOn: dates.weekEnd,
      fit: "The shorter length can be demonstrated on a bob.",
    },
    pitch: {
      format: "creator-video",
      test: "Show a chin-length wrap and next-day result.",
      rationale: "The viewer can see both the application and the result.",
    },
    uncertainties: ["Creator availability is unverified."],
  }];
  return { fixture: false, reviewed: true, summary, details };
}

function fingerprint(value: object) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function asRole<T>(
  database: PGlite,
  role: "anon" | "authenticated" | "service_role",
  userId: string | null,
  run: () => Promise<T>,
) {
  await database.exec(`SET ROLE ${role}`);
  try {
    await database.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
    return await run();
  } finally {
    await database.exec("RESET ROLE");
  }
}

test("Postgres grants and publication keep weekly evidence private and immutable", async (t) => {
  const database = new PGlite();
  t.after(() => database.close());
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      'SELECT NULLIF(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  `);
  const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql")).sort();
  assert.ok(migrations.length, "expected at least one database migration");
  for (const migration of migrations) {
    await database.exec(await readFile(new URL(migration, migrationDirectory), "utf8"));
  }
  for (const userId of [viewer, editor, nonmember, inactive]) {
    await database.query("INSERT INTO auth.users(id) VALUES ($1)", [userId]);
  }
  await database.query(
    `INSERT INTO outlandish_private.memberships(user_id, role, active)
     VALUES ($1, 'viewer', true), ($2, 'editor', true), ($3, 'viewer', false)`,
    [viewer, editor, inactive],
  );
  const first = revision("june-first");
  const readLatest = async () =>
    (await database.query<{ result: unknown }>("SELECT public.read_latest_brief() AS result")).rows[0].result;
  const readDetail = async (id: string) =>
    (await database.query<{ result: unknown }>("SELECT public.read_opportunity($1) AS result", [id])).rows[0].result;
  const roleName = async () =>
    (await database.query<{ result: string | null }>("SELECT public.active_membership() AS result")).rows[0].result;
  const publish = (payload: ReturnType<typeof revision>) =>
    database.query("SELECT public.publish_brief($1::jsonb, $2)", [payload, fingerprint(payload)]);
  const latestForViewer = () => asRole(database, "authenticated", viewer, readLatest);
  const publishAsOperator = (payload: ReturnType<typeof revision>) =>
    asRole(database, "service_role", null, () => publish(payload));
  const permissionDenied = /permission denied|insufficient privilege/i;

  await t.test("no previous publication returns no database result", async () => {
    assert.equal(await latestForViewer(), null);
  });

  await t.test("only the operator can publish", async () => {
    for (const userId of [viewer, editor, nonmember, inactive]) {
      await asRole(database, "authenticated", userId, async () => {
        await assert.rejects(() => publish(first), permissionDenied);
      });
    }
    await asRole(database, "anon", null, async () => {
      await assert.rejects(() => publish(first), permissionDenied);
    });
    const saved = await publishAsOperator(first);
    assert.deepEqual(saved.rows[0], {
      publish_brief: { revisionId: "june-first", alreadyPublished: false, active: true },
    });
  });

  await t.test("anonymous requests and direct access cannot read evidence", async () => {
    await asRole(database, "anon", null, async () => {
      await assert.rejects(readLatest, permissionDenied);
      await assert.rejects(() => readDetail(first.details[0].id), permissionDenied);
    });
    await asRole(database, "authenticated", viewer, async () => {
      await assert.rejects(
        () => database.query("SELECT * FROM outlandish_private.memberships"),
        permissionDenied,
      );
      await assert.rejects(
        () => database.query("UPDATE outlandish_private.memberships SET role = 'editor'"),
        permissionDenied,
      );
    });
  });

  await t.test("active membership gates reads and unpublished identifiers have the same result as unknown ones", async () => {
    assert.deepEqual(latestBriefSchema.parse(await latestForViewer()), first.summary);
    await asRole(database, "authenticated", viewer, async () => {
      assert.equal(await roleName(), "viewer");
      assert.deepEqual(opportunityDetailSchema.parse(await readDetail(first.details[0].id)), first.details[0]);
      assert.equal(await readDetail("unpublished-id"), null);
      assert.equal(await readDetail("unknown-id"), null);
    });
    await asRole(database, "authenticated", editor, async () => {
      assert.equal(await roleName(), "editor");
      assert.deepEqual(latestBriefSchema.parse(await readLatest()), first.summary);
    });
    for (const userId of [nonmember, inactive]) {
      await asRole(database, "authenticated", userId, async () => {
        assert.equal(await roleName(), null);
        assert.equal(await readLatest(), null);
        assert.equal(await readDetail(first.details[0].id), null);
      });
    }
  });

  await t.test("replaying and rejecting publication preserve the existing revision", async () => {
    const replay = await publishAsOperator(first);
    assert.deepEqual(replay.rows[0], {
      publish_brief: { revisionId: "june-first", alreadyPublished: true, active: true },
    });
    await assert.rejects(
      () => publishAsOperator({ ...revision("fixture-draft"), fixture: true }),
      /non-fixture publication/,
    );
    const incomplete = revision("missing-evidence");
    incomplete.details[0].comments.pop();
    await assert.rejects(() => publishAsOperator(incomplete), /two linked source posts and comments/);
    const withPrivateField = revision("private-notes");
    Object.assign(withPrivateField.details[0], { rawEditorNotes: "Never disclose this field" });
    await assert.rejects(() => publishAsOperator(withPrivateField), /unsupported fields/);
    const reusedRevisionId = revision("june-first", june, "This ID is already published.");
    await assert.rejects(() => publishAsOperator(reusedRevisionId), /duplicate key/);
    assert.deepEqual(latestBriefSchema.parse(await latestForViewer()), first.summary);
  });

  await t.test("older corrections preserve the newest week and older detail links", async () => {
    const empty = revision("empty-week", followingWeek);
    empty.summary.opportunities = [];
    empty.details = [];
    await publishAsOperator(empty);
    const correction = revision("corrected-june", june, "A reviewed correction for the first week.");
    await publishAsOperator(correction);
    assert.deepEqual(latestBriefSchema.parse(await latestForViewer()), empty.summary);
    await asRole(database, "authenticated", viewer, async () => {
      assert.deepEqual(opportunityDetailSchema.parse(await readDetail(first.details[0].id)), first.details[0]);
      assert.deepEqual(opportunityDetailSchema.parse(await readDetail(correction.details[0].id)), correction.details[0]);
    });
  });

  await t.test("observation imports deduplicate, roll back invalid writes, and keep raw source text private", async (importTest) => {
    const fixtureDirectory = fileURLToPath(new URL("../data/fixtures/illustrative/", import.meta.url));
    const fixture = await loadBatch(fixtureDirectory);
    const batch = { ...fixture, fixture: false };
    const { category, cohort_key } = batch.accounts[0];
    const importBatch = async (candidate: Batch) =>
      (await database.query<{ result: { alreadyImported: boolean } }>(
        "SELECT public.import_observations($1, $2::jsonb) AS result",
        [fingerprint(candidate), candidate],
      )).rows[0].result;
    const observations = async () =>
      (await database.query<{ result: Batch }>(
        "SELECT public.get_observations($1, $2) AS result",
        [category, cohort_key],
      )).rows[0].result;

    await asRole(database, "authenticated", viewer, async () => {
      await assert.rejects(observations, permissionDenied);
      await assert.rejects(() => importBatch(batch), permissionDenied);
      await assert.rejects(
        () => database.query("SELECT observation FROM outlandish_private.observed_comments"),
        permissionDenied,
      );
    });
    await asRole(database, "service_role", null, async () => {
      await assert.rejects(() => importBatch(fixture), /non-fixture observation batch/);
      assert.equal((await importBatch(batch)).alreadyImported, false);
      const saved = await observations();
      assert.equal(saved.accounts.length, batch.accounts.length);
      assert.equal(saved.posts.length, batch.posts.length);
      assert.equal(saved.comments.length, batch.comments.length);
      assert.equal((await importBatch(batch)).alreadyImported, true);

      const invalid = structuredClone(batch);
      invalid.posts[0].caption = "A mutation before the failed comment insert.";
      invalid.comments[0].post_key = "missing-post";
      await assert.rejects(() => importBatch(invalid), /foreign key/);
      assert.deepEqual(await observations(), saved);
    });

    await importTest.test("an imported cohort feeds a reviewed revision and its viewer evidence", async () => {
      const persisted = await asRole(database, "service_role", null, observations);
      const options = { category, cohortKey: cohort_key, weekStart: "2026-11-16", now: new Date("2026-11-24T00:00:00Z") };
      const draft = buildDraft(persisted, options);
      const candidate = draft.candidates[0];
      assert.ok(candidate?.eligible);
      assert.ok(candidate.topic);
      const review = {
        draftFingerprint: draft.fingerprint,
        decisions: [{
          candidateId: candidate.id,
          decision: "accept",
          rationale: "Exercise approval in the isolated QA database.",
          rank: 1,
          platform: "tiktok",
          questionKey: candidate.topic.questions[0].key,
          finding: "Two tracked accounts demonstrated compact heatless curlers.",
        }],
      };
      assert.throws(() => finalizePublication(buildDraft(fixture, options), review), /fixture data cannot be published/);
      assert.throws(
        () => finalizePublication(draft, { ...review, draftFingerprint: "0".repeat(64) }),
        /review does not match/,
      );
      const proposal = finalizePublication(draft, review);
      await asRole(database, "service_role", null, () =>
        database.query("SELECT public.publish_brief($1::jsonb, $2)", [proposal.revision, proposal.fingerprint]));
      assert.deepEqual(await latestForViewer(), proposal.revision.summary);
      await asRole(database, "authenticated", viewer, async () => {
        const opportunity = proposal.revision.summary.opportunities[0];
        const detail = opportunityDetailSchema.parse(await readDetail(opportunity.id));
        assert.equal(opportunity.comparison.currentAccounts, 2);
        assert.equal(opportunity.comparison.priorAccounts, 1);
        assert.equal(detail.comments.length, 2);
        for (const comment of detail.comments) {
          assert.equal(comment.sourceUrl, detail.posts.find((post) => post.postId === comment.postId)?.sourceUrl);
        }
        assert.equal(detail.product.name, "Short Wrap Rod");
      });
    });
  });
});
