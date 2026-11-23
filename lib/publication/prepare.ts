import { createHash } from "node:crypto";
import { analyzeDiscovery, type DiscoveryTopic } from "../discovery/analyze.ts";
import { findShopperQuestions } from "../discovery/questions.ts";
import { addDays } from "../editorial/batch.ts";
import type { CollectionSnapshot, CollectedPost } from "../collection/types.ts";
import { publicWebUrl, reviewSchema, opportunitySchema, type Approval, type Review } from "./schema.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const questionCoverage = {
  available: "Oriane returned a subset of popular comments.",
  empty_subset: "The provider returned an empty popular-comment subset.",
  unavailable: "Comment text was unavailable in this sample.",
};

function requirePostLink(post: CollectedPost, destination: string) {
  const url = new URL(destination);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (post.platform === "tiktok") {
    const match = url.pathname.match(/^\/@([\w.-]+)\/video\/(\d+)\/?$/);
    if (host === "tiktok.com" && match && match[2] === post.platformId) return;
  } else if (host === "instagram.com" && /^\/(p|reels?)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) {
    // Instagram's native ID can be numeric while its browser URL uses a shortcode.
    // The paired desktop/mobile identity checks in the review supply that mapping.
    return;
  }
  throw new Error("Open the exact platform post and check its identity on desktop and mobile.");
}

function verifiedEmbed(post: CollectedPost, source: string, embed: string | undefined) {
  if (!embed) return null;
  const url = new URL(embed);
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  const sourcePath = new URL(source).pathname.replace(/\/$/, "");
  const valid = post.platform === "tiktok"
    ? host === "tiktok.com" && path === `/player/v1/${post.platformId}`
    : host === "instagram.com" && path === `${sourcePath}/embed`;
  if (!valid || url.search || url.hash) throw new Error("Playback must use the verified embed for this exact post.");
  return url.href;
}

function thumbnailExpiry(source: string, reviewerExpiry: string | null): string | null {
  const query = new URL(source).searchParams;
  const times = reviewerExpiry ? [Date.parse(reviewerExpiry)] : [];
  if (query.has("Key-Pair-Id") && query.has("Signature") && /^\d{9,11}$/.test(query.get("Expires") ?? "")) {
    times.push(Number(query.get("Expires")) * 1000);
  }
  if (query.has("sig") && query.get("se")) times.push(Date.parse(query.get("se")!));
  for (const prefix of ["X-Amz", "X-Goog"]) {
    const signatureDate = query.get(prefix + "-Date")?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    const seconds = query.get(prefix + "-Expires");
    if (signatureDate && seconds && /^\d{1,9}$/.test(seconds)) {
      const [, year, month, day, hour, minute, second] = signatureDate;
      times.push(Date.parse(year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + "Z") + Number(seconds)*1000);
    }
  }
  const valid = times.filter(Number.isFinite);
  return valid.length ? new Date(Math.min(...valid)).toISOString() : null;
}

function checkTime(value: string, now: Date, label: string) {
  if (Date.parse(value) > now.getTime()) throw new Error(`${label} has a future check date.`);
}

function comparable(run: CollectionSnapshot) {
  return (["tiktok", "instagram"] as const).some(platform => {
    const covered = new Set(run.queries.filter(q =>
      q.kind === "search" && q.platform === platform && q.status === "done").map(q => q.day));
    return Array.from({ length: 14 }, (_, day) => addDays(run.weekStart, day - 7)).every(day => covered.has(day));
  });
}

function describeStats(topic: DiscoveryTopic): string[] {
  const count = (n: number | null) => n == null ? "unknown" : n.toString();
  return topic.comparisons.map(c => {
    const platform = c.platform === "tiktok" ? "TikTok" : "Instagram";
    const difference = c.shareDelta == null ? "" : ` · ${c.shareDelta > 0 ? "+" : ""}${(100 * c.shareDelta).toFixed(1)} percentage points`;
    return `${platform} · ${count(c.currentAccounts)}/${count(c.currentTrackedAccounts)} sampled accounts this week, ${count(c.priorAccounts)}/${count(c.priorTrackedAccounts)} prior${difference}. ${c.note}`;
  });
}

function reviewedTopic(run: CollectionSnapshot, topic: DiscoveryTopic, decision: Approval, now: Date) {
  const selections = new Map(decision.clips.map(item => [item.postId, new Set(item.selectedCommentIds)]));
  const selectedPosts = run.posts.filter(post => selections.has(post.id))
    .map(post => ({...post, comments: post.comments.filter(comment => selections.get(post.id)!.has(comment.id))}));
  const selectedQuestions = findShopperQuestions(selectedPosts, new Map(), topic.key);
  const seen = new Set<string>();
  const included = new Set(topic.evidence.filter(row => row.week === "current").map(row => row.postId));
  const clips = decision.clips.map(item => {
    if (seen.has(item.postId)) throw new Error("The review contains a duplicate clip.");
    seen.add(item.postId);
    const post = run.posts.find(p => p.id === item.postId);
    if (!post || !included.has(item.postId)) throw new Error("Selected clip is outside the discovered topic.");
    if (!post.thumbnailUrl || !publicWebUrl(post.thumbnailUrl)) throw new Error("Choose a clip with a usable source thumbnail.");
    const expiresAt = thumbnailExpiry(post.thumbnailUrl, item.thumbnailExpiresAt);
    if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
      throw new Error("A selected thumbnail has expired. Refresh its source or remove this clip.");
    }
    requirePostLink(post, item.source.url);
    checkTime(item.source.checkedAt, now, "Source");
    checkTime(item.thumbnailCheckedAt, now, "Thumbnail");
    if (item.embed) checkTime(item.embed.checkedAt, now, "Embed");

    if (new Set(item.selectedCommentIds).size !== item.selectedCommentIds.length) throw new Error("Duplicate selected comment.");
    const comments = item.selectedCommentIds.map(id => {
      const observation = post.comments.find(c => c.id === id);
      const question = topic.shopperQuestions.find(q => q.id === id && q.postId === post.id && q.platform === post.platform);
      if (!observation || !question || question.excerpt !== observation.text) throw new Error("Shopper excerpt must match the selected post's observed text.");
      return { id, text: observation.text, sourceUrl: item.source.url, publishedAt: observation.publishedAt, observedAt: post.observedAt, recurring: selectedQuestions.some(q => q.id === id && q.postId === post.id && q.recurring) };
    });
    return {
      id: post.id, platform: post.platform, publishedAt: post.publishedAt, observedAt: post.observedAt, thumbnail: post.thumbnailUrl,
      thumbnailExpiresAt: expiresAt, sourceUrl: item.source.url, playbackUrl: null,
      embedUrl: verifiedEmbed(post, item.source.url, item.embed?.url),
      title: (post.title || post.caption || topic.label).slice(0, 400),
      ...(post.profileHandle ? { handle: post.profileHandle } : {}), comments,
      commentCoverage: questionCoverage[post.commentCoverage],
    };
  });
  if (!clips.some(c => c.comments.length)) throw new Error("Hold this opportunity until a sourced shopper question is available.");
  const seller = decision.prospect;
  for (const page of [seller.profile, seller.product, seller.ownership]) checkTime(page.checkedAt, now, "Seller page");
  if (new URL(seller.product.url).pathname.replace(/\//g, "") === "" || seller.product.url === seller.profile.url) {
    throw new Error("Check a specific product page and a distinct public business profile.");
  }
  const stats = describeStats(topic);
  const best = topic.comparisons.filter(c => c.status === "rising" && c.shareDelta != null)
    .sort((a, b) => (b.shareDelta ?? 0) - (a.shareDelta ?? 0))[0];
  if (!best) throw new Error("The topic has no supported rising comparison.");
  const platform = best.platform === "tiktok" ? "TikTok" : "Instagram";
  return {
    topic: topic.label,
    finding: `${best.currentAccounts} of ${best.currentTrackedAccounts} sampled ${platform} accounts featured ${topic.label}; ${best.priorAccounts} of ${best.priorTrackedAccounts} did the prior week.`,
    clips,
    prospect: { brand: seller.brand, name: seller.name, url: seller.product.url, fit: seller.fit,
      sizeBasis: seller.sizeBasis, profileUrl: seller.profile.url, ownershipUrl: seller.ownership.url,
      ownershipBasis: seller.ownershipBasis, checkedAt: seller.product.checkedAt },
    pitch: decision.pitch, uncertainties: decision.uncertainties,
    statistics: stats, comparisons: topic.comparisons,
  };
}

export function preparePublication(run: CollectionSnapshot, rawReview: unknown, now = new Date()) {
  const review = reviewSchema.parse(rawReview);
  if (run.mode !== "live" || run.purpose !== "discovery" || !run.completedAt ||
      !["complete", "partial"].includes(run.status) || !comparable(run) ||
      !run.queries.some(q => q.kind === "workspace" && q.status === "done")) {
    throw new Error("A finished live discovery run with confirmed access and one comparable platform is required.");
  }
  const analysis = analyzeDiscovery(run, {aliases: review.aliases, now});
  if (!analysis.coverage.some(platform => platform.comparable)) {
    throw new Error("No platform has comparable, identified accounts. Retain the preceding verified brief.");
  }
  const all = new Set([...analysis.ranked, ...analysis.observed].map(t => t.key));
  const decisions = new Map(review.decisions.map(d => [d.key, d]));
  if (decisions.size !== review.decisions.length || [...decisions.keys()].some(key => !all.has(key))) {
    throw new Error("Each decision must identify a distinct topic in this actual discovery run.");
  }
  const approvals = review.decisions.filter(d => d.decision === "approve");
  if (approvals.length > 3 || approvals.some(d => !analysis.ranked.some(t => t.key === d.key))) {
    throw new Error("Approve up to three rising topics across the monitored sample.");
  }
  if (!approvals.length && analysis.ranked.some(topic => !decisions.has(topic.key))) {
    throw new Error("Record why each ranked candidate was held or skipped before publishing an empty week.");
  }
  const topics = analysis.ranked.flatMap(topic => {
    const decision = decisions.get(topic.key);
    return decision?.decision === "approve" ? [{ key: topic.key, detail: reviewedTopic(run, topic, decision, now) }] : [];
  });
  const payload = {
    runId: run.runId, weekStart: run.weekStart, weekEnd: addDays(run.weekStart, 6),
    collectedAt: run.completedAt, coverage: analysis.coverageNote, topics,
  };
  const topicRecords = [...analysis.ranked.map(t => ({...t, ranked:true})), ...analysis.observed.map(t => ({...t, ranked:false}))];
  const fingerprint = digest(JSON.stringify({ payload, review, topicRecords }));
  const revisionId = `rev_${fingerprint.slice(0, 32)}`;
  return { fingerprint, review, topicRecords, scene: { mode: "live" as const, revisionId,
    weekStart: payload.weekStart, weekEnd: payload.weekEnd, collectedAt: payload.collectedAt, coverage: payload.coverage,
    opportunities: topics.map(({ key, detail }) => opportunitySchema.parse({
      id: `${revisionId}_${digest(key).slice(0, 16)}`, ...detail,
    })),
  } };
}

// These are evidence leads for an operator to inspect. A shop phrase or a link
// in a bio establishes neither ownership nor brand size.
export function sellerLeads(run: CollectionSnapshot, topic: DiscoveryTopic) {
  const evidence = new Set(topic.evidence.map(e => e.postId));
  const phrases = [...new Set(topic.evidence.map(row => row.phrase.toLowerCase()))];
  return run.posts.flatMap(post => {
    const caption = [post.title, post.caption].filter(Boolean).join("\n");
    const text = [caption, post.profileBio].filter(Boolean).join("\n");
    if (!evidence.has(post.id) && !phrases.some(term => text.toLowerCase().includes(term))) return [];
    const urls = [...new Set((text.match(/https?:\/\/[^\s<>")]+/g) ?? [])
      .map(url => url.replace(/[.,!]+$/, "")).filter(publicWebUrl))];
    const shop = text.match(/\b(shop our|we make|our (?:store|shop|collection|official)|available (?:at|on) our|made by us|shop (?:the |my )?link in (?:my |our )?bio)\b/i);
    const leads = [];
    if (shop || urls.length) {
      leads.push({postId:post.id, platform:post.platform, handle:post.profileHandle, sourceHandle:post.profileHandle,
        cue:shop?.[0] ?? null, observedUrls:urls, relationship:shop ? "self-described shop" : "linked in source",
        status:"unverified" as const});
    }
    for (const match of caption.matchAll(/\b(?:made by|sold by|designed by|ordered from|bought from|from|shop (?:at|with))\s+@([\w.]{2,40})/gi)) {
      if (!leads.some(lead => lead.handle?.replace(/^@/,"").toLowerCase() === match[1].toLowerCase())) {
        leads.push({postId:post.id, platform:post.platform, handle:match[1], sourceHandle:post.profileHandle,
          cue:match[0], observedUrls:[], relationship:"named source", status:"unverified" as const});
      }
    }
    return leads;
  });
}

export const blankReview = (keys: string[]): Review => ({
  decisions: keys.map(key => ({ key, decision: "hold", reason: "Awaiting editorial source and seller checks." })),
});
