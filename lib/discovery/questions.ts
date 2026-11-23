import type { CollectedPost } from "../collection/types.ts";

const questions = [
  ["compatibility", /\b(?:compatib\w*|work(?:s)? (?:with|on|in)|use (?:it |this |these |them )?(?:with|on|in)|safe (?:with|on|for)|connect to|support(?:s)? (?:the|my))\b/i],
  ["fit or size", /\b(?:fit|fits|sizing|size|sizes|dimension\w*|measurements?|diameter|length|width|height|too (?:small|large)|true to size)\b/i],
  ["ingredients or materials", /\b(?:ingredients?|materials?|made (?:of|from)|contain(?:s)?|allergen\w*|fragrance|dishwasher safe|food safe|vegan)\b/i],
  ["setup or care", /\b(?:set ?up|install\w*|assembl\w*|attach\w*|charg(?:e|ed|ing)|clean(?:ed|ing)?|wash(?:ed|ing)?|maintain|refill|instructions?)\b/i],
  ["availability or price", /\b(?:where (?:can|do|did|could)|(?:where|how) to (?:order|buy|get)|in stock|restock\w*|available|availability|link|price|cost|how much|ship(?:ping)?|deliver\w*)\b/i],
  ["usage", /\b(?:how (?:do|can|would|did) (?:i|you|we) (?:use|apply|open|hold)|how to (?:use|apply)|how long (?:does|can|will)|how (?:often|many)|reus(?:e|able)|battery life)\b/i],
] as const;
const generic = new Set(("does do did can could has have i you your it my me we is are was were will would this that these those the a an and or so for to on in at by with of " +
  "work works working use using get got any really what which when where how why also if anyone has know please " +
  "fit fits size one setup set up install price cost buy more about also thank thanks available availability compatible compatibility product products support supports safe would bought purchased order ordering shipped shipping ship stock restock material materials ingredient ingredients someone anyone works use using used workable").split(" "));

export interface ShopperQuestion {
  id: string;
  postId: string;
  platform: CollectedPost["platform"];
  excerpt: string;
  theme: string;
  /** A comment may be newer than its post or have no provider timestamp. */
  publishedAt: string | null;
  observedAt: string;
  recurring: boolean;
}

interface QuestionObservation {
  item: ShopperQuestion;
  author: string | null;
  sourceGroup: string;
  postingAccount: string | null;
  normalized: string;
  subject: Set<string>;
}

// A native ID, Oriane ID and handle can be present in different combinations
// for the same account. Bridge only through unambiguous identifiers observed on
// this platform; a reused handle is insufficient to merge two distinct owners.
export function resolveAccounts(posts: CollectedPost[]) {
  const nativeForProvider = new Map<string, Set<string>>();
  const nativeForHandle = new Map<string, Set<string>>();
  const providerForHandle = new Map<string, Set<string>>();
  function associate(map: Map<string, Set<string>>, from: string | null, to: string | null) {
    if (!from || !to) return;
    const matches = map.get(from) ?? new Set();
    matches.add(to);
    map.set(from, matches);
  }
  function ids(post: CollectedPost) {
    const prefix = post.platform + ":";
    return {
      native: post.profilePlatformId ? prefix + "native:" + post.profilePlatformId : null,
      provider: post.profileId ? prefix + "provider:" + post.profileId : null,
      handle: post.profileHandle ? prefix + "handle:" + post.profileHandle.toLowerCase().replace(/^@/, "") : null,
    };
  }
  for (const post of posts) {
    const {native, provider, handle} = ids(post);
    associate(nativeForProvider, provider, native);
    associate(nativeForHandle, handle, native);
    associate(providerForHandle, handle, provider);
  }
  function known(map: Map<string, Set<string>>, key: string) {
    const candidates = map.get(key);
    return candidates && candidates.size === 1 ? [...candidates][0] : null;
  }
  return (post: CollectedPost): string | null => {
    const {native, provider, handle} = ids(post);
    if (native) return native;
    if (provider) return nativeForProvider.has(provider) ? known(nativeForProvider, provider) : provider;
    if (!handle) return null;
    if ((providerForHandle.get(handle)?.size ?? 0) > 1 || (nativeForHandle.get(handle)?.size ?? 0) > 1) return null;
    const knownProvider = known(providerForHandle, handle);
    return known(nativeForHandle, handle) ?? (knownProvider ? known(nativeForProvider, knownProvider) ?? knownProvider : handle);
  };
}

export function sourceGroup(post: CollectedPost): string {
  // A matching substantial transcript and caption catches identifiable reuploads.
  // A shared short caption or product name by itself cannot identify a repost.
  const normalize = (input: string | null) => (input ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const transcript = normalize(post.transcript);
  const caption = normalize(post.caption);
  if (transcript.split(" ").length >= 24 && caption.length >= 24) return "speech:" + caption + "|" + transcript;
  return post.platform + ":" + (post.platformId || post.id);
}

function specificSubjects(text: string, productWords: Set<string>): Set<string> {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter(word => !generic.has(word) && !productWords.has(word) && word.length > 2));
}

function corroborate(first: QuestionObservation, second: QuestionObservation): boolean {
  if (first.item.theme !== second.item.theme || first.item.postId === second.item.postId ||
    first.sourceGroup === second.sourceGroup || first.normalized === second.normalized) return false;
  if (first.item.platform === second.item.platform &&
    (!first.postingAccount || !second.postingAccount || first.postingAccount === second.postingAccount || (first.author && first.author === second.author))) return false;
  // A broad dimension such as fit is insufficient for claiming the same question
  // recurs when the two shoppers are asking about different applications.
  return [...first.subject].some(word => second.subject.has(word));
}

export function findShopperQuestions(posts: CollectedPost[], topicTerms: Map<string, Set<string>>, key: string, identify = resolveAccounts(posts)): ShopperQuestion[] {
  const observed: QuestionObservation[] = [];
  const productWords = new Set(key.split(" "));
  for (const post of posts) {
    if (post.commentCoverage !== "available") continue;
    const terms = topicTerms.get(post.id) ?? new Set();
    const ids = new Set<string>();
    for (const comment of post.comments) {
      if (!comment.text.trim() || ids.has(comment.id)) continue;
      ids.add(comment.id);
      const excerpt = comment.text;
      if (!/[?？]/.test(excerpt) && !/^(?:where|how|which|what|does|do |can |could |will |is |are |when|would|anyone know)\b/i.test(excerpt.trim())) continue;
      const normalized = excerpt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      // With multiple products in one post "will it fit?" is ambiguous.
      if (terms.size > 1 && ![...terms].some(term => term === key && (" " + normalized + " ").includes(" " + term + " "))) continue;
      const dimension = questions.find(([, pattern]) => pattern.test(excerpt));
      if (!dimension) continue;
      observed.push({
        item: {id: comment.id, postId: post.id, platform: post.platform, excerpt, theme: dimension[0], publishedAt: comment.publishedAt, observedAt: post.observedAt, recurring: false},
        author: comment.profileId, postingAccount: identify(post), sourceGroup: sourceGroup(post),
        normalized, subject: specificSubjects(excerpt, productWords),
      });
    }
  }
  // Questions are grouped only after distinct posts and substantively overlapping
  // wording have been verified. Never synthesize a quote or extend an excerpt.
  const bySubject = new Map<string, QuestionObservation[]>();
  for (const evidence of observed) {
    for (const word of evidence.subject) {
      const id = evidence.item.theme + ":" + word;
      const group = bySubject.get(id) ?? [];
      group.push(evidence);
      bySubject.set(id, group);
    }
  }
  for (const group of bySubject.values()) {
    if (group.length < 2 || new Set(group.map(e => e.item.postId)).size < 2 ||
        new Set(group.map(e => e.normalized)).size < 2) continue;
    for (const evidence of group) {
      if (evidence.item.recurring) continue;
      const witness = group.find(other => corroborate(evidence, other));
      if (witness) {
        evidence.item.recurring = true;
        witness.item.recurring = true;
      }
    }
  }
  return observed.map(({item}) => item);
}
