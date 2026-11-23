import { z } from "zod";
import {
  latestBriefSchema, opportunityDetailSchema,
  type LatestBrief, type OpportunityDetail, type OpportunitySummary, type Platform,
} from "../contracts.ts";
import type { Draft, DraftCandidate, RecurringQuestion } from "./analysis.ts";
import { normalizedLabel, postId, type PostObservation } from "./batch.ts";
import { fingerprint } from "./import.ts";

const text = z.string().trim().min(1);
const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ candidateId: text, decision: z.literal("decline"), rationale: text }),
  z.object({
    candidateId: text, decision: z.literal("accept"), rationale: text,
    rank: z.number().int().min(1).max(3),
    platform: z.enum(["tiktok", "instagram"]),
    questionKey: text,
    finding: text,
  }),
]);
const reviewSchema = z.object({
  draftFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  decisions: z.array(decisionSchema),
  emptyReason: text.optional(),
});
export type Review = z.infer<typeof reviewSchema>;
type Accepted = Extract<Review["decisions"][number], { decision: "accept" }>;
type PublishedBrief = Extract<LatestBrief, { state: "published" }>;

interface PublicationAudit {
  cohortKey: string;
  coverage: Draft["coverage"];
  decisions: Review["decisions"];
  emptyReason?: string;
}

function previewPost(post: PostObservation, topic: string) {
  const platform = post.platform === "tiktok" ? "TikTok" : "Instagram";
  return { postId: postId(post), platform: post.platform, imageUrl: post.preview_url,
    alt: `${platform} preview for ${topic}`, views: post.views };
}

function proposedOpportunity(
  candidate: DraftCandidate, decision: Accepted, question: RecurringQuestion,
  period: Draft["period"],
) {
  const topic = candidate.topic!;
  const { prospect } = candidate;
  const supportingIds = new Set(question.comments.map(postId));
  const posts = [
    ...topic.currentPosts.filter((post) => supportingIds.has(postId(post))),
    ...topic.currentPosts.filter((post) => !supportingIds.has(postId(post))),
  ];
  const sourceById = new Map(posts.map((post) => [postId(post), post.source_url]));
  const comparison = topic.comparisons.find((item) => item.platform === decision.platform)!;
  const summary: Omit<OpportunitySummary, "id"> = {
    topic: topic.label,
    finding: decision.finding,
    comparison,
    previews: posts.slice(0, 3).map((post) => previewPost(post, topic.label)),
  };
  const detail: Omit<OpportunityDetail, "id"> = {
    period,
    topic: topic.label,
    finding: decision.finding,
    comparisons: [comparison, ...topic.comparisons.filter((item) => item !== comparison)],
    shopperQuestion: question.theme,
    posts: posts.map((post) => ({
      ...previewPost(post, topic.label),
      sourceUrl: post.source_url,
      publishedAt: new Date(post.published_at).toISOString(),
      observedAt: new Date(post.observed_at).toISOString(),
      ...(post.caption && { note: post.caption }),
      commentAvailability: post.comment_access,
    })),
    comments: question.comments.map((comment) => ({
      id: `${postId(comment)}:${comment.comment_key}`,
      postId: postId(comment),
      excerpt: comment.excerpt,
      observedAt: new Date(comment.observed_at).toISOString(),
      sourceUrl: comment.source_url ?? sourceById.get(postId(comment)) ?? null,
    })),
    product: {
      brand: prospect.brand, name: prospect.product, sourceUrl: prospect.product_url,
      checkedOn: prospect.checked_on, fit: prospect.fit_rationale,
      brandSourceUrl: prospect.brand_url, sizeBasis: prospect.size_basis,
    },
    pitch: { format: prospect.format, test: prospect.pitch, rationale: prospect.pitch_rationale },
    uncertainties: prospect.uncertainty ? [prospect.uncertainty] : [],
  };
  return { key: candidate.id, summary, detail };
}

export function finalizePublication(draft: Draft, input: unknown): {
  revision: {
    fixture: false; reviewed: true; summary: PublishedBrief; details: OpportunityDetail[];
    audit: PublicationAudit;
  };
  fingerprint: string;
  decisions: Review["decisions"];
} {
  if (draft.fixture) throw new Error("Illustrative fixture data cannot be published.");
  if (!draft.comparablePlatforms.length) {
    throw new Error("Publication requires complete, comparable coverage on at least one platform.");
  }

  const result = reviewSchema.safeParse(input);
  if (!result.success) {
    const paths = result.error.issues.map((issue) => issue.path.join(".") || "review");
    throw new Error(`Invalid review fields: ${paths.join(", ")}.`);
  }
  const review = result.data;
  if (draft.fingerprint !== review.draftFingerprint) {
    throw new Error("The review does not match the current draft. Generate and review a fresh preview.");
  }
  const candidates = new Map(draft.candidates.map((candidate) => [candidate.id, candidate]));
  const decided = new Set<string>();
  for (const decision of review.decisions) {
    if (decided.has(decision.candidateId) || !candidates.has(decision.candidateId)) {
      throw new Error("Each review decision must refer once to a current candidate.");
    }
    decided.add(decision.candidateId);
  }
  if (decided.size !== candidates.size) throw new Error("Record one review decision for every candidate.");

  const accepted = review.decisions
    .filter((decision): decision is Accepted => decision.decision === "accept")
    .sort((left, right) => left.rank - right.rank);
  if (accepted.length > 3 || accepted.some((decision, index) => decision.rank !== index + 1)) {
    throw new Error("Use consecutive ranks starting at 1 for up to three accepted prospects.");
  }
  if (!accepted.length && !review.emptyReason) {
    throw new Error("A reviewed zero-opportunity brief needs an emptyReason.");
  }

  const acceptedTopics = new Set<string>();
  const previousIncrease = new Map<Platform, number>();
  const opportunities = accepted.map((decision) => {
    const candidate = candidates.get(decision.candidateId)!;
    const topic = candidate.topic;
    if (!candidate.eligible || !topic) throw new Error(`Candidate ${candidate.id} did not qualify.`);
    if (acceptedTopics.has(topic.key)) throw new Error("Choose only one primary prospect for each topic.");
    acceptedTopics.add(topic.key);

    const comparison = topic.comparisons.find((item) =>
      item.platform === decision.platform && item.status === "rising");
    const question = topic.questions.find((item) => item.key === normalizedLabel(decision.questionKey));
    if (!comparison || comparison.priorAccounts === null || !question) {
      throw new Error(`Candidate ${candidate.id} needs a rising platform and a recurring question from the draft.`);
    }
    const delta = comparison.currentAccounts - comparison.priorAccounts;
    if (delta > (previousIncrease.get(decision.platform) ?? Infinity)) {
      throw new Error("Rank accepted trends on the same platform by account increase.");
    }
    previousIncrease.set(decision.platform, delta);
    return proposedOpportunity(candidate, decision, question, draft.period);
  });

  const briefId = `brief-${fingerprint([normalizedLabel(draft.category), draft.period.weekStart]).slice(0, 24)}`;
  const coverageNote = !accepted.length ? `${draft.coverageNote} ${review.emptyReason}` : draft.coverageNote;
  const audit: PublicationAudit = {
    cohortKey: draft.cohortKey,
    coverage: draft.coverage,
    decisions: [...review.decisions].sort((a, b) => a.candidateId.localeCompare(b.candidateId, "en-US")),
    ...(!accepted.length && { emptyReason: review.emptyReason }),
  };
  const hash = fingerprint({
    briefId, period: draft.period, category: draft.category, coverageNote, opportunities, audit,
  });
  const revisionId = `rev-${hash}`;
  const opportunityId = (candidateId: string) => `${revisionId}-${candidateId.replace(/^candidate-/, "")}`;
  const summary = latestBriefSchema.parse({
    state: "published", id: briefId, revisionId, category: draft.category, ...draft.period,
    coverageNote, opportunities: opportunities.map((item) => ({ ...item.summary, id: opportunityId(item.key) })),
  }) as PublishedBrief;
  const details = opportunities.map((item) => opportunityDetailSchema.parse({
    ...item.detail, id: opportunityId(item.key),
  }));
  return { revision: { fixture: false, reviewed: true, summary, details, audit }, fingerprint: hash, decisions: review.decisions };
}
