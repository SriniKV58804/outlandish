import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadCollection } from "../lib/collection/store.ts";
import { analyzeDiscovery } from "../lib/discovery/analyze.ts";
import { rpc } from "../lib/editorial/remote.ts";
import { blankReview, preparePublication, sellerLeads } from "../lib/publication/prepare.ts";
import { reviewSchema } from "../lib/publication/schema.ts";

const usage = `Use npm run review -- <command> <collection-uuid> [private-review.json] [expected-revision-id]
  candidates      Show ranked/observed topics, available buyer questions and seller leads.
  template        Print a review file with every ranked candidate on hold.
  checklist       Print an unfilled approval for one ranked key (third argument).
  preview         Validate the review and print the frozen viewer data. No writes.
  save            Save private analysis and review without publishing.
  publish         Save the review and atomically publish. To replace an active week,
                  pass its expected revision ID as the fourth argument.
Collection and review stay separate. These commands make no Oriane requests.`;

function approvalChecklist(key: string, postId: string) {
  const page = {url:"", checkedAt:"", desktop:"", mobile:"", evidence:""};
  return { key, decision:"approve", clips:[{postId,source:page,thumbnailCheckedAt:"",thumbnailUse:"",thumbnailBasis:"",thumbnailExpiresAt:null,selectedCommentIds:[]}],
    prospect:{brand:"",name:"",profile:page,product:page,ownership:page,ownershipBasis:"",sizeBasis:"",fit:"",seller:"sells-product"},
    pitch:{format:"creator-video",idea:"",rationale:""},uncertainties:[] };
}
async function main() {
  const [command, runId, input, expectedRevision] = process.argv.slice(2);
  if (command === "--help" || !command) { console.log(usage); return; }
  if (!["candidates","template","checklist","preview","save","publish"].includes(command) || !z.uuid().safeParse(runId).success) {
    throw new Error(usage);
  }
  const run = await loadCollection(runId);
  if (["candidates", "template", "checklist"].includes(command)) {
    const analysis = analyzeDiscovery(run);
    if (command === "template") return blankReview(analysis.ranked.map(t => t.key));
    if (command === "checklist") {
      const topic = analysis.ranked.find(t => t.key === input);
      if (!topic) throw new Error("Choose a ranked candidate's exact key.");
      return approvalChecklist(topic.key, topic.evidence.find(row => row.week === "current")!.postId);
    }
    const activeRevision = await rpc<string | null>("discovery_week_revision", {p_run:runId});
    return {runId, mode:run.mode, weekStart:run.weekStart, activeRevision, coverage:analysis.coverage,
      ranked:analysis.ranked.map(t => ({...t, sellerLeads:sellerLeads(run,t),
        sourceCandidates:run.posts.filter(p => t.evidence.some(e => e.week === "current" && e.postId === p.id))
          .map(p => ({id:p.id,platform:p.platform, handle:p.profileHandle, nativeId:p.platformId, candidate:p.sourceUrl,
            caption:p.caption, publishedAt:p.publishedAt, thumbnail:p.thumbnailUrl, coverage:p.commentCoverage}))})),
      observed:analysis.observed.map(t => ({key:t.key, comparisons:t.comparisons})),
    };
  }
  if (!input) throw new Error(usage);
  if (expectedRevision && !/^rev_[0-9a-f]{32}$/.test(expectedRevision)) throw new Error("Invalid expected revision.");
  const review = reviewSchema.parse(JSON.parse(await readFile(input,"utf8")));
  const plan = preparePublication(run, review);
  if (command === "preview") return {status:"private-draft",scene:plan.scene};
  await rpc("save_discovery_analysis",{p_run:runId,p_version:plan.fingerprint,p_topics:plan.topicRecords});
  const reviewId = await rpc<string>("save_discovery_review",{p_run:runId,p_document:plan.review});
  if (command === "save") return {status:"private-draft",reviewId};
  return await rpc("publish_discovery_revision",{p_run:runId,p_review_id:reviewId,p_expected_revision:expectedRevision??null,
    p_fingerprint:plan.fingerprint,p_scene:plan.scene});
}

try {
  const result = await main();
  if (result !== undefined) console.log(JSON.stringify(result,null,2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to complete review.");
  process.exitCode=1;
}
