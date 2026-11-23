import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { buildDraft, type Draft } from "../lib/editorial/analysis.ts";
import type { Batch } from "../lib/editorial/batch.ts";
import { fingerprint, loadBatch } from "../lib/editorial/import.ts";
import { finalizePublication, type Review } from "../lib/editorial/publication.ts";
import { rpc } from "../lib/editorial/remote.ts";
import type { LatestBrief } from "../lib/contracts.ts";

const help = `Usage
  npm run editorial -- import --dir <csv-directory> [--apply]
  npm run editorial -- preview (--dir <csv-directory> | --remote) --category "<category>" --cohort <key> [--week <YYYY-MM-DD>] [--as-of <timestamp>] [--out <draft.json>] [--review-template <review.json>]
  npm run editorial -- publish --category "<category>" --cohort <key> --week <YYYY-MM-DD> --review <review.json> [--apply]

Import and publish run as previews unless --apply is set.
Use --as-of only when previewing the local illustrative fixture.
Use a gitignored path for drafts, private input and reviews.`;

type PublishedBrief = Extract<LatestBrief, { state: "published" }>;
type BatchCounts = Record<Exclude<keyof Batch, "fixture">, number>;
type ImportResponse = { alreadyImported: boolean; counts: BatchCounts; changed: BatchCounts };

async function writePrivateJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
}

function showDraft(draft: Draft): void {
  const { weekStart, weekEnd } = draft.period;
  const eligible = draft.candidates.filter((candidate) => candidate.eligible).length;
  console.log(JSON.stringify({
    fixture: draft.fixture,
    weekStart, weekEnd,
    draftFingerprint: draft.fingerprint,
    comparablePlatforms: draft.comparablePlatforms,
    topics: draft.topics.length,
    candidates: draft.candidates.length,
    eligible,
  }, null, 2));
}

function revisionDiff(current: PublishedBrief | null, proposed: PublishedBrief) {
  const topicSignatures = (opportunities: PublishedBrief["opportunities"]) => new Map(
    opportunities.map(({ id: _revisionId, ...data }) => [data.topic, fingerprint(data)]),
  );
  const previousTopics = topicSignatures(current?.opportunities ?? []);
  const proposedTopics = topicSignatures(proposed.opportunities);
  return {
    priorRevision: current?.revisionId ?? null,
    proposedRevision: proposed.revisionId,
    changed: (current?.revisionId ?? null) !== proposed.revisionId,
    coverageChanged: current?.coverageNote !== proposed.coverageNote,
    addedTopics: [...proposedTopics.keys()].filter((topic) => !previousTopics.has(topic)),
    removedTopics: [...previousTopics.keys()].filter((topic) => !proposedTopics.has(topic)),
    updatedTopics: [...proposedTopics.keys()].filter(
      (topic) => previousTopics.has(topic) && previousTopics.get(topic) !== proposedTopics.get(topic),
    ),
    currentOrder: current?.opportunities.map(({ topic }) => topic) ?? [],
    proposedOrder: proposed.opportunities.map(({ topic }) => topic),
  };
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" }, remote: { type: "boolean" }, apply: { type: "boolean" },
      category: { type: "string" }, cohort: { type: "string" }, week: { type: "string" },
      "as-of": { type: "string" }, out: { type: "string" },
      review: { type: "string" }, "review-template": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !positionals.length) {
    console.log(help);
    return;
  }

  const [command] = positionals;
  if (positionals.length !== 1 || !["import", "preview", "publish"].includes(command)) {
    throw new Error(help);
  }

  if (command === "import") {
    if (!values.dir) throw new Error("Import requires --dir <csv-directory>.");
    const batch = await loadBatch(values.dir);
    const hash = fingerprint(batch);
    const counts = {
      accounts: batch.accounts.length, posts: batch.posts.length,
      comments: batch.comments.length, prospects: batch.prospects.length,
    };
    if (!values.apply) {
      console.log(JSON.stringify({ mode: "validation-only", fixture: batch.fixture, fingerprint: hash, counts }, null, 2));
      return;
    }
    if (batch.fixture) throw new Error("Illustrative fixture data cannot be imported to Supabase.");
    const result = await rpc<ImportResponse>("import_observations", { p_fingerprint: hash, p_batch: batch });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (!values.category || !values.cohort) throw new Error("Supply --category and --cohort.");
  const category = values.category;
  const cohortKey = values.cohort;
  const weekStart = values.week;
  const fromSupabase = () =>
    rpc<Batch>("get_observations", { p_category: category, p_cohort_key: cohortKey });

  if (command === "preview") {
    if (Boolean(values.remote) === Boolean(values.dir)) {
      throw new Error("Specify either --remote or --dir <csv-directory>.");
    }
    const batch = values.dir ? await loadBatch(values.dir) : await fromSupabase();
    const reviewCutoff = values["as-of"];
    if (reviewCutoff && !batch.fixture) throw new Error("--as-of is only available for local illustrative fixtures.");
    const now = reviewCutoff ? new Date(reviewCutoff) : new Date();
    if (!Number.isFinite(now.valueOf())) throw new Error("--as-of needs an ISO 8601 timestamp.");
    const draft = buildDraft(batch, { category, cohortKey, weekStart, now });
    if (values.out) await writePrivateJson(values.out, draft);
    if (values["review-template"]) {
      const template: Review = {
        draftFingerprint: draft.fingerprint,
        decisions: draft.candidates.map(({ id }) => ({ candidateId: id, decision: "decline", rationale: "" })),
        emptyReason: "",
      };
      await writePrivateJson(values["review-template"], template);
    }
    showDraft(draft);
    return;
  }

  if (!values.review || !weekStart) throw new Error("Publish requires --week and --review.");
  const review: unknown = JSON.parse(await readFile(values.review, "utf8"));
  const draft = buildDraft(await fromSupabase(), { category, cohortKey, weekStart });
  const proposal = finalizePublication(draft, review);
  const current = await rpc<PublishedBrief | null>("get_active_revision", {
    p_category: draft.category, p_week_start: draft.period.weekStart,
  });
  console.log(JSON.stringify(revisionDiff(current, proposal.revision.summary), null, 2));
  if (values.apply) {
    const published = await rpc<{ revisionId: string; alreadyPublished: boolean; active: boolean }>(
      "publish_brief", { p_revision: proposal.revision, p_fingerprint: proposal.fingerprint },
    );
    console.log(JSON.stringify(published, null, 2));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof SyntaxError ? "Could not parse a JSON input." :
    error instanceof Error ? error.message : "Editorial operation failed.");
  process.exitCode = 1;
});
