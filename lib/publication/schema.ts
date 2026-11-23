import { isIP } from "node:net";
import { z } from "zod";

const label = z.string().trim().min(1).max(1200);
const instant = z.iso.datetime({ offset: true });
const platform = z.enum(["tiktok", "instagram"]);
const date = z.iso.date();
const count = z.number().int().nonnegative().nullable();

export function publicWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return url.protocol === "https:" && !url.port && !url.username && !url.password && !isIP(host)
      && host.includes(".") && !/(^|\.)(localhost|local|internal|example|test|invalid)$/.test(host)
      && !/(^|\.)example\.(com|org|net)$/.test(host)
      && ![...url.searchParams.keys()].some(key => /^(authorization|api[_-]?key|access_token)$/i.test(key));
  } catch {
    return false;
  }
}

const href = z.string().max(6000).refine(publicWebUrl, "Use a public HTTPS destination.");
export const checkedPage = z.object({
  url: href,
  checkedAt: instant,
  desktop: z.literal("visible"),
  mobile: z.literal("visible"),
  evidence: label,
}).strict();

const selectedClip = z.object({
  postId: label,
  source: checkedPage,
  thumbnailCheckedAt: instant,
  thumbnailUse: z.literal("approved-for-private-display"),
  thumbnailBasis: label,
  thumbnailExpiresAt: instant.nullable().default(null),
  selectedCommentIds: z.array(label).max(15),
  embed: checkedPage.optional(),
}).strict();

const approved = z.object({
  key: label,
  decision: z.literal("approve"),
  clips: z.array(selectedClip).min(1).max(16),
  prospect: z.object({
    brand: label, name: label,
    profile: checkedPage, product: checkedPage, ownership: checkedPage,
    ownershipBasis: label, sizeBasis: label, fit: label,
    seller: z.literal("sells-product"),
  }).strict(),
  pitch: z.object({ format: z.enum(["creator-video", "tiktok-live"]), idea: label, rationale: label }).strict(),
  uncertainties: z.array(label).max(12),
}).strict();
export const reviewSchema = z.object({
  aliases: z.record(label, label.nullable()).optional(),
  decisions: z.array(z.discriminatedUnion("decision", [
    approved,
    z.object({ key: label, decision: z.enum(["hold", "skip"]), reason: label }).strict(),
  ])).max(500),
}).strict();
export type Review = z.infer<typeof reviewSchema>;
export type Approval = z.infer<typeof approved>;

const comparison = z.object({
  platform, status: label, currentAccounts: count, priorAccounts: count,
  currentTrackedAccounts: count, priorTrackedAccounts: count,
  accountDelta: z.number().int().nullable(), shareDelta: z.number().finite().nullable(), note: label,
});
const clip = z.object({
  id: label, platform, thumbnail: href.nullable(), thumbnailExpiresAt: instant.nullable(),
  publishedAt: instant, observedAt: instant, title: label, handle: label.optional(), sourceUrl: href, playbackUrl: z.null(), embedUrl: href.nullable(),
  comments: z.array(z.object({ id: label, text: z.string().refine(value => value.trim().length > 0), sourceUrl: href, publishedAt: instant.nullable(), observedAt: instant, recurring: z.boolean() })),
  commentCoverage: label,
});
export const opportunitySchema = z.object({
  id: label, topic: label, finding: label,
  clips: z.array(clip).min(1).max(16),
  prospect: z.object({
    brand: label, name: label, url: href, fit: label, sizeBasis: label,
    profileUrl: href, ownershipUrl: href, ownershipBasis: label, checkedAt: instant,
  }),
  pitch: z.object({ format: label, idea: label, rationale: label }),
  statistics: z.array(label),
  comparisons: z.array(comparison).min(1).max(2),
  uncertainties: z.array(label),
});
export const briefSchema = z.object({
  mode: z.literal("live"), revisionId: label, weekStart: date, weekEnd: date,
  collectedAt: instant, publishedAt: instant, coverage: label, opportunities: z.array(opportunitySchema).max(3),
});

export type PublishedBrief = z.infer<typeof briefSchema>;
export type PublishedOpportunity = z.infer<typeof opportunitySchema>;
