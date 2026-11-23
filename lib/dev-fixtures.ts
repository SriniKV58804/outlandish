import {
  latestBriefSchema,
  opportunityDetailSchema,
  type LatestBrief,
  type OpportunityDetail,
} from "./contracts.ts";

const period = {
  weekStart: "2026-11-09",
  weekEnd: "2026-11-15",
  priorWeekStart: "2026-11-02",
  priorWeekEnd: "2026-11-08",
  timezone: "America/Los_Angeles",
} as const;

function makeDetail({
  id,
  topic,
  finding,
  question,
  product,
  test,
  rationale,
  prior,
  current,
}: {
  id: string;
  topic: string;
  finding: string;
  question: string;
  product: string;
  test: string;
  rationale: string;
  prior: number;
  current: number;
}): OpportunityDetail {
  return opportunityDetailSchema.parse({
    id,
    topic,
    finding,
    period,
    comparisons: [{
      platform: "tiktok",
      status: "rising",
      priorAccounts: prior,
      currentAccounts: current,
      priorTrackedAccounts: 8,
      currentTrackedAccounts: 8,
      note: "Simulated comparison of a fixed cohort.",
    }],
    shopperQuestion: question,
    posts: [
      {
        postId: id + "-post-1",
        platform: "tiktok",
        imageUrl: null,
        alt: "Sample clip showing the setup",
        views: null,
        sourceUrl: null,
        publishedAt: "2026-11-10T12:00:00-08:00",
        observedAt: "2026-11-16T10:00:00-08:00",
        note: "Illustrative clip description used for interface testing.",
        commentAvailability: "available",
      },
      {
        postId: id + "-post-2",
        platform: "tiktok",
        imageUrl: null,
        alt: "Sample clip showing the result",
        views: null,
        sourceUrl: null,
        publishedAt: "2026-11-12T16:00:00-08:00",
        observedAt: "2026-11-16T10:10:00-08:00",
        commentAvailability: "partial",
      },
      {
        postId: id + "-post-3",
        platform: "tiktok",
        imageUrl: null,
        alt: "Sample creator demonstration",
        views: null,
        sourceUrl: null,
        publishedAt: "2026-11-14T14:00:00-08:00",
        observedAt: "2026-11-16T10:20:00-08:00",
        commentAvailability: "unavailable",
      },
    ],
    comments: [
      {
        id: id + "-comment-1",
        postId: id + "-post-1",
        excerpt: question,
        observedAt: "2026-11-16T10:00:00-08:00",
        sourceUrl: null,
      },
      {
        id: id + "-comment-2",
        postId: id + "-post-2",
        excerpt: "I had the same question before trying it.",
        observedAt: "2026-11-16T10:10:00-08:00",
        sourceUrl: null,
      },
    ],
    product: {
      brand: "Illustrative brand",
      name: product,
      sourceUrl: "https://example.com/",
      checkedOn: "2026-11-16",
      fit: "A hypothetical product for demonstrating the evidence and pitch layout.",
    },
    pitch: {
      format: id === "sample-brush" ? "tiktok-live" : "creator-video",
      test,
      rationale,
    },
    uncertainties: ["All counts, quotes and products in this local fixture are fictional."],
  });
}

export function getFixture(mode?: string | string[]): {
  brief: LatestBrief;
  fixtureDetails: Record<string, OpportunityDetail>;
} {
  if (mode === "unpublished") return { brief: { state: "unpublished" }, fixtureDetails: {} };

  const details = mode === "empty" ? [] : [
    makeDetail({
      id: "sample-curlers",
      topic: "Heatless curls for short hair",
      finding: "A short-hair demonstration could answer a recurring fit question.",
      question: "Will this stay in place on chin-length hair?",
      product: "Short heatless curling rod",
      test: "Film the wrap on a bob and show the result the next morning.",
      rationale: "A recorded sequence can show the overnight result in one clip.",
      prior: 1,
      current: 4,
    }),
    makeDetail({
      id: "sample-brush",
      topic: "Cleaning silicone brushes",
      finding: "Shoppers ask what is left behind after rinsing.",
      question: "How do you get product out from between the bristles?",
      product: "Flexible silicone brush",
      test: "Apply product, rinse the brush and show the spaces between the bristles in close-up.",
      rationale: "A host can repeat the rinse live while viewers ask about the residue.",
      prior: 1,
      current: 3,
    }),
    makeDetail({
      id: "sample-comb",
      topic: "Detangling wet curls",
      finding: "A section-by-section comparison could show how the comb moves through damp hair.",
      question: "Does it snag when your hair is wet?",
      product: "Wide-tooth detangling comb",
      test: "Record a close-up of the comb moving through three damp sections from ends to roots.",
      rationale: "A close-up lets a viewer see exactly where the teeth pause or glide.",
      prior: 0,
      current: 2,
    }),
  ];

  return {
    brief: latestBriefSchema.parse({
      state: "published",
      id: "sample-brief",
      revisionId: "sample-revision",
      category: "Beauty tools",
      ...period,
      coverageNote: "Illustrative data for testing the viewer.",
      opportunities: details.map(({ id, topic, finding, comparisons, posts }) => ({
        id,
        topic,
        finding,
        comparison: comparisons[0],
        previews: posts,
      })),
    }),
    fixtureDetails: Object.fromEntries(details.map(detail => [detail.id, detail])),
  };
}
