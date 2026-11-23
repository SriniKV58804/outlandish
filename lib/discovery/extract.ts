// Product names come from captured text. These patterns describe the surrounding
// shopping language so a product can be found on its first appearance.
const lead = /\b(?:unbox(?:ing|ed)?|review(?:ing|ed)|test(?:ing|ed)|compar(?:ing|ed)|purchas(?:ing|ed)|ordered|bought|picked up|trying(?: out)?|tried(?: out)?|setting up|set up|install(?:ing|ed)|replaced|upgraded to|switched to|shopping for|shop(?:ping)? (?:for|my)|where (?:can|did) (?:i|you) (?:buy|get)|how (?:i|to) (?:use|clean)|first impressions of|review of)(?:\s*[:–—]\s*|\s+)/gi;
const commerce = /\b(?:unbox(?:ing|ed)?|review(?:s|ed|ing)?|bought|purchase[ds]?|ordered|shop(?:ping)?|storefront|restock(?:ed)?|on sale|sold out|add to cart|in stock|link in (?:my )?bio|product demo|price|worth (?:it|the money))\b/i;
const suffix = /\b(?:review|unboxing|demo|restock|price check|setup guide)\b/gi;
const demonstrative = /\b(?:this|these|our|my new|meet the|introducing (?:the|our)?)\s+/gi;
const separators = /[.,:;!?#@\n\r(){}\[\]“”"…/]|\s[–—|+&]\s|\b(?:and|or|but|because|with|for|from|on|off|in|at|by|to|as|after|before|when|while|that|which|who|than|versus|vs|again|finally|every|everywhere|literally|really|online|yesterday|today|tomorrow|last|y'all|i|you|we|me|is|are|was|were|has|have|had|works?|worked|working|fits?|folds?|keeps?|makes?|lets?|starts?|seems?|feels?|looks?|saved|changed|helped|can|can't|could|will|would|should|won't|isn't|aren't)\b/i;
const determiners = /^(?:(?:the|a|an|this|that|these|those|our|my|your|their|some|another|new|favorite|favourite|amazing|best|latest|little|first|own|brand[- ]new|viral|affordable|budget[- ]friendly|must[- ]have|trending)\s+)+/i;
const ignoredWords = new Set(("thing things stuff one ones item items product products order haul finds find brand brands review unboxing video videos guide guides set up setup " +
  "everything anything something nothing someone anyone everyone day week month year time times money deal deals price prices picks pick replacement replacements " +
  "amazon tiktok instagram reels reel store shop cart link bio storefront hashtag sponsored gift gifted collection release " +
  "dance dances dancing challenge challenges song songs music concert album movie film series episode episodes prank jokes joke gameplan workout workouts recipe recipes trick hacks hack routine routines " +
  "story stories opinion experience vlog vacation patience luck life lives choices thoughts mood daydream dream dreams relationships feeling feelings friendship friendships mindset self confidence design designs restaurant restaurants lunch dinner date look trend trends aesthetic trendiness " +
  "idk how why what where when again here there it them they her him us not never nothing no else did doing being whether if day test testing reviewed " +
  "obsessed happy literally love loved isn aren't didn't don't buy get watch follow share omg fyp viral ad collab").split(/\s+/));

function cleanStart(raw: string): string {
  return raw.trim().replace(/^[“"'‘’]+/, "").replace(determiners, "").trim();
}

function plausible(phrase: string): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  if (words.length > 5 || phrase.length < 3 || phrase.length > 65) return false;
  if (words.some((w) => !/^[\p{L}\p{N}][\p{L}\p{N}'’‐-]*$/u.test(w))) return false;
  return !ignoredWords.has(words[words.length - 1]) && !words.some((w) =>
    /^(?:i|we|you|this|that|the|a|an|like|not|never|if|whether|being|doing|how|how-to|out|just|outta|more|too|so|super|really|how|what|why|tried|trying|honest|quick|full|watch|watching|best|better|newest|fake|vs)$/.test(w));
}

function firstPhrase(raw: string): string | null {
  const phrase = cleanStart(raw.split(separators, 1)[0]).replace(/[’']s$/u, "").trim();
  return plausible(phrase) ? phrase : null;
}

export type SourceField = "caption" | "title" | "transcript" | "onScreenText" | "frameText";
export interface ProductMention {
  key: string;
  phrase: string;
  field: SourceField;
  frameId?: string;
}

const irregular: Record<string, string> = {knives: "knife", scarves: "scarf", shelves: "shelf", leaves: "leaf", lenses: "lens"};
function singular(noun: string): string {
  if (noun.length < 4 || /(?:ss|us|is|ics|series|species|news|canvas|atlas|glass|lens|jeans|shorts|pants|trousers|glasses|scissors|headphones|earbuds|tweezers)$/i.test(noun)) return noun;
  if (Object.hasOwn(irregular, noun)) return irregular[noun];
  if (/ies$/.test(noun)) return noun.slice(0, -3) + "y";
  if (/(?:ches|shes|xes|sses|zzes)$/.test(noun)) return noun.slice(0, -2);
  return noun.endsWith("s") ? noun.slice(0, -1) : noun;
}

export function topicKey(phrase: string): string {
  const words = phrase.normalize("NFKC").toLowerCase().replace(/[’']/g, "").replace(/[-‐]/g, " ").trim().split(/\s+/);
  words[words.length - 1] = singular(words[words.length - 1]);
  return words.join(" ");
}

interface CapturedText {
  caption: string | null;
  title: string | null;
  transcript: string | null;
  onScreenText: string | null;
  frames: { id: string; text: string | null }[];
}

function capturedFields(post: CapturedText) {
  const fields: {field: SourceField; text: string; frameId?: string}[] = [];
  for (const field of ["caption", "title", "transcript", "onScreenText"] as const) {
    if (post[field]) fields.push({field, text: post[field]});
  }
  for (const frame of post.frames) {
    if (frame.text) fields.push({field: "frameText", text: frame.text, frameId: frame.id});
  }
  return fields;
}

export function extractMentions(post: CapturedText): ProductMention[] {
  const fields = capturedFields(post);
  const hasCommerce = fields.some(({text}) => commerce.test(text));
  const mentions = new Map<string, ProductMention>();
  for (const {field, text, frameId} of fields) {
    function add(phrase: string | null) {
      if (!phrase) return;
      const key = topicKey(phrase);
      const occurrence = [field, frameId ?? "", key].join("\t");
      if (!mentions.has(occurrence)) mentions.set(occurrence, {key, phrase, field, ...(frameId && {frameId})});
    }
    for (const match of text.matchAll(lead)) add(firstPhrase(text.slice(match.index + match[0].length)));
    for (const match of text.matchAll(suffix)) {
      const prefix = text.slice(0, match.index).split(/[.!?,;:#@\n“”"|]/).at(-1) ?? "";
      const trimmed = cleanStart(prefix.replace(/^\s*(?:here(?:'s| is)\s+)?(?:my|an?)?\s*(?:honest|quick|full)\s+/i, ""));
      if (plausible(trimmed)) add(trimmed);
    }
    if (hasCommerce) {
      for (const match of text.matchAll(demonstrative)) {
        const tail = text.slice(match.index + match[0].length);
        if (/\b(?:is|are|has|fits?|works?|lets?|keeps?|folds?|feels?|looks?)\b/i.test(tail.split(/[.!?\n]/)[0])) {
          add(firstPhrase(tail));
        }
      }
      // A short product title or on-screen label alongside an actual shopping
      // signal is common even when no surrounding sentence names the object.
      if (field !== "caption" && field !== "transcript" && !commerce.test(text)) {
        const line = cleanStart(text.trim().replace(/[.!:]$/, ""));
        if (plausible(line) && !separators.test(line)) add(line);
      }
    }
  }
  return [...mentions.values()];
}

// Once a shopping-context occurrence has named an unfamiliar item, look for
// that same product elsewhere in these two samples. No persistent product
// dictionary is required. Retain the exact source spelling, including hashtags.
interface TermNode {
  children: Map<string, TermNode>;
  key?: string;
}
export function indexObservedTerms(phrases: Iterable<ProductMention>) {
  const root: TermNode = {children: new Map()};
  const tags = new Map<string, string | null>();
  for (const {phrase, key} of phrases) {
    const forms = new Set([key, phrase.toLowerCase().replace(/[’']/g, "").replace(/[-‐]/g, " ")]);
    for (const form of forms) {
      const parts = form.split(/\s+/);
      let node = root;
      for (const word of parts) {
        const child: TermNode = node.children.get(word) ?? {children: new Map()};
        node.children.set(word, child);
        node = child;
      }
      node.key = key;
      const tag = parts.join("");
      if (!tags.has(tag) || tags.get(tag) === key) tags.set(tag, key);
      else tags.set(tag, null);
    }
  }
  return (post: CapturedText): ProductMention[] => {
    const mentions = new Map<string, ProductMention>();
    for (const {field,text,frameId} of capturedFields(post)) {
      const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)];
      for (let start = 0; start < words.length; start++) {
        const begin = words[start].index;
        let node = root;
        let match: {key: string; end: number} | undefined;
        const hashtag = text[begin-1] === "#" ? tags.get(words[start][0].toLowerCase()) : null;
        if (hashtag) match = {key: hashtag, end: start};
        for (let i = start; i < words.length; i++) {
          if (i > start && !/^[ \t‐-]+$/.test(text.slice(words[i-1].index + words[i-1][0].length, words[i].index))) break;
          const word = words[i][0].toLowerCase().replace(/[’']/g, "");
          const child = node.children.get(word);
          if (!child) break;
          node = child;
          if (node.key) match = {key: node.key, end: i};
        }
        if (!match) continue;
        const end = words[match.end];
        const phrase = text.slice(hashtag ? begin-1 : begin, end.index + end[0].length);
        const occurrence = [field, frameId ?? "", match.key].join("\t");
        if (!mentions.has(occurrence)) mentions.set(occurrence, {field, key: match.key, phrase, ...(frameId && {frameId})});
        start = match.end;
      }
    }
    return [...mentions.values()];
  };
}
