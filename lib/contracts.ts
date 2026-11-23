import { z } from "zod";

const text = z.string().trim().min(1);
const httpsUrl = z.url({ protocol: /^https$/ });
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const count = z.number().int().nonnegative();

export const platformSchema = z.enum(["tiktok", "instagram"]);
export type Platform = z.infer<typeof platformSchema>;

export const comparisonSchema = z.object({
  platform: platformSchema,
  status: z.enum(["rising", "comparable", "observed"]),
  priorAccounts: count.nullable(),
  currentAccounts: count,
  priorTrackedAccounts: count.nullable(),
  currentTrackedAccounts: count,
  note: text.optional(),
});
export type Comparison = z.infer<typeof comparisonSchema>;

export const previewSchema = z.object({
  postId: text,
  platform: platformSchema,
  imageUrl: httpsUrl.nullable(),
  alt: text,
  views: count.nullable(),
});
export type Preview = z.infer<typeof previewSchema>;

export const opportunitySummarySchema = z.object({
  id: text,
  topic: text,
  finding: text,
  comparison: comparisonSchema,
  previews: z.array(previewSchema).max(3),
});
export type OpportunitySummary = z.infer<typeof opportunitySummarySchema>;

export const periodSchema = z.object({
  weekStart: date,
  weekEnd: date,
  priorWeekStart: date,
  priorWeekEnd: date,
  timezone: z.literal("America/Los_Angeles"),
});

export const latestBriefSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unpublished") }),
  periodSchema.extend({
    state: z.literal("published"),
    id: text,
    revisionId: text,
    category: text,
    coverageNote: text,
    opportunities: z.array(opportunitySummarySchema).max(3),
  }),
]);
export type LatestBrief = z.infer<typeof latestBriefSchema>;

export const evidencePostSchema = previewSchema.extend({
  sourceUrl: httpsUrl.nullable(),
  publishedAt: instant,
  observedAt: instant,
  note: text.optional(),
  commentAvailability: z.enum(["available", "checked-empty", "partial", "unavailable"]),
});

export const opportunityDetailSchema = z.object({
  id: text,
  topic: text,
  finding: text,
  period: periodSchema,
  comparisons: z.array(comparisonSchema).min(1).max(2),
  shopperQuestion: text,
  posts: z.array(evidencePostSchema).min(1),
  comments: z.array(z.object({
    id: text,
    postId: text,
    excerpt: text,
    observedAt: instant,
    sourceUrl: httpsUrl.nullable(),
  })),
  product: z.object({
    brand: text,
    name: text,
    sourceUrl: httpsUrl,
    brandSourceUrl: httpsUrl.optional(),
    checkedOn: date,
    fit: text,
    sizeBasis: text.optional(),
  }),
  pitch: z.object({
    format: z.enum(["creator-video", "tiktok-live"]),
    test: text,
    rationale: text,
  }),
  uncertainties: z.array(text),
});
export type OpportunityDetail = z.infer<typeof opportunityDetailSchema>;
