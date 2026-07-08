import {
  classifyKind,
  normalizeComment,
  runActor,
  scrapeInstagram,
} from "./apify";
import type { ScrapedComment, ScrapedPost } from "./types";

// Multi-platform scraping. Each platform maps to an Apify actor (overridable via
// env) and a normalizer into our shared ScrapedPost shape.
//
// Status: Instagram is battle-tested. The others are wired with standard actors
// + defensive parsing — they should work, but field mappings may need a tweak
// once you run each for real (and some actors require the right Apify plan).

export type Platform =
  | "instagram"
  | "tiktok"
  | "reddit"
  | "x"
  | "facebook"
  | "youtube"
  | "linkedin"
  | "nextdoor"
  | "unknown";

export const PLATFORMS: { id: Platform; label: string; test: RegExp }[] = [
  { id: "instagram", label: "Instagram", test: /instagram\.com/i },
  { id: "tiktok", label: "TikTok", test: /tiktok\.com/i },
  { id: "reddit", label: "Reddit", test: /reddit\.com/i },
  { id: "x", label: "X / Twitter", test: /(twitter\.com|x\.com)/i },
  { id: "facebook", label: "Facebook", test: /(facebook\.com|fb\.watch)/i },
  { id: "youtube", label: "YouTube", test: /(youtube\.com|youtu\.be)/i },
  { id: "linkedin", label: "LinkedIn", test: /linkedin\.com/i },
  { id: "nextdoor", label: "Nextdoor", test: /nextdoor\.com/i },
];

export function detectPlatform(url: string): Platform {
  return PLATFORMS.find((p) => p.test.test(url))?.id ?? "unknown";
}

export function platformLabel(p: Platform): string {
  return PLATFORMS.find((x) => x.id === p)?.label ?? "Unknown";
}

// ── helpers ──────────────────────────────────────────────────────
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) if (typeof v === "string" && v) return v;
  return undefined;
}
function num(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}
function dedupeComments(raws: Record<string, unknown>[]): ScrapedComment[] {
  const seen = new Set<string>();
  const out: ScrapedComment[] = [];
  raws.forEach((r, i) => {
    const c = normalizeComment(r, i);
    if (!c) return;
    const key = `${c.author}:${c.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  });
  return out;
}

// Build a ScrapedPost from a platform's "post/details" item, defensively.
function buildPost(
  url: string,
  item: Record<string, unknown>,
  comments: ScrapedComment[],
): ScrapedPost {
  const videoMeta = (item.videoMeta ?? {}) as Record<string, unknown>;
  const caption = String(
    item.caption ??
      item.text ??
      item.title ??
      item.description ??
      item.fullText ??
      item.full_text ??
      item.body ??
      item.selftext ??
      "",
  );
  const type = item.type ? String(item.type) : undefined;
  const videoUrl = firstString(
    item.videoUrl,
    videoMeta.downloadAddr,
    item.mediaUrl,
    (item.video as Record<string, unknown>)?.url,
    item.downloadUrl,
    Array.isArray(item.mediaUrls) ? (item.mediaUrls[0] as string) : undefined,
  );
  const displayUrl = firstString(
    item.displayUrl,
    item.thumbnailUrl,
    item.coverUrl,
    item.thumbnail,
    videoMeta.coverUrl,
  );
  return {
    url,
    caption,
    author: String(
      item.author ??
        (item.authorMeta as Record<string, unknown>)?.name ??
        item.ownerUsername ??
        item.username ??
        item.channelName ??
        item.pageName ??
        item.userName ??
        "unknown",
    ),
    type,
    kind: classifyKind({ videoUrl, displayUrl, type, caption }),
    videoUrl,
    displayUrl,
    likes: num(
      item.likesCount,
      item.diggCount,
      item.likes,
      item.upVotes,
      item.favoriteCount,
      item.likeCount,
    ),
    commentsCount:
      num(
        item.commentsCount,
        item.commentCount,
        item.numberOfComments,
        item.replyCount,
      ) ?? comments.length,
    comments,
  };
}

async function tryComments(
  actor: string,
  input: Record<string, unknown>,
): Promise<ScrapedComment[]> {
  try {
    const items = await runActor<Record<string, unknown>>(actor, input);
    return dedupeComments(items);
  } catch {
    return [];
  }
}

// ── per-platform adapters ────────────────────────────────────────
async function scrapeTikTok(url: string, limit: number): Promise<ScrapedPost> {
  const postActor =
    process.env.APIFY_TIKTOK_ACTOR ?? "clockworks~tiktok-scraper";
  const commentActor =
    process.env.APIFY_TIKTOK_COMMENT_ACTOR ??
    "clockworks~tiktok-comments-scraper";
  const details = await runActor<Record<string, unknown>>(postActor, {
    postURLs: [url],
    resultsPerPage: 1,
    shouldDownloadVideos: false,
    shouldDownloadCovers: false,
  });
  const post = details[0];
  if (!post) throw new Error("No data returned for that TikTok URL.");
  const comments = await tryComments(commentActor, {
    postURLs: [url],
    commentsPerPost: limit,
    maxItems: limit,
  });
  return buildPost(url, post, comments);
}

async function scrapeReddit(url: string, limit: number): Promise<ScrapedPost> {
  const actor = process.env.APIFY_REDDIT_ACTOR ?? "trudax~reddit-scraper-lite";
  const items = await runActor<Record<string, unknown>>(actor, {
    startUrls: [{ url }],
    maxItems: limit + 1,
    maxComments: limit,
    maxPostCount: 1,
    scrollTimeout: 40,
  });
  // The dataset mixes the post (has a title) with comment items (have a body).
  const postItem =
    items.find((i) => i.title || i.dataType === "post") ?? items[0];
  if (!postItem) throw new Error("No data returned for that Reddit URL.");
  const commentItems = items.filter(
    (i) => i !== postItem && (i.body || i.dataType === "comment"),
  );
  return buildPost(url, postItem, dedupeComments(commentItems));
}

async function scrapeX(url: string, limit: number): Promise<ScrapedPost> {
  const actor = process.env.APIFY_X_ACTOR ?? "apidojo~tweet-scraper";
  const items = await runActor<Record<string, unknown>>(actor, {
    startUrls: [url],
    maxItems: limit + 1,
    includeSearchTerms: false,
  });
  const post = items[0];
  if (!post) throw new Error("No data returned for that X/Twitter URL.");
  // Replies (if the actor returned the conversation) are the remaining items.
  const replies = items.slice(1);
  return buildPost(url, post, dedupeComments(replies));
}

async function scrapeFacebook(
  url: string,
  limit: number,
): Promise<ScrapedPost> {
  const postActor =
    process.env.APIFY_FACEBOOK_ACTOR ?? "apify~facebook-posts-scraper";
  const commentActor =
    process.env.APIFY_FACEBOOK_COMMENT_ACTOR ??
    "apify~facebook-comments-scraper";
  const details = await runActor<Record<string, unknown>>(postActor, {
    startUrls: [{ url }],
    resultsLimit: 1,
  });
  const post = details[0];
  if (!post) throw new Error("No data returned for that Facebook URL.");
  const comments = await tryComments(commentActor, {
    startUrls: [{ url }],
    resultsLimit: limit,
  });
  return buildPost(url, post, comments);
}

async function scrapeYouTube(
  url: string,
  limit: number,
): Promise<ScrapedPost> {
  const actor = process.env.APIFY_YOUTUBE_ACTOR ?? "streamers~youtube-scraper";
  const items = await runActor<Record<string, unknown>>(actor, {
    startUrls: [{ url }],
    maxResults: 1,
    maxComments: limit,
  });
  const video = items[0];
  if (!video) throw new Error("No data returned for that YouTube URL.");
  const commentItems = Array.isArray(video.comments)
    ? (video.comments as Record<string, unknown>[])
    : items.slice(1);
  return buildPost(url, video, dedupeComments(commentItems));
}

async function scrapeGeneric(
  url: string,
  envKey: string,
  label: string,
  limit: number,
): Promise<ScrapedPost> {
  const actor = process.env[envKey];
  if (!actor) {
    throw new Error(
      `${label} isn't wired up yet. Set the ${envKey} env var to an Apify actor id to enable it.`,
    );
  }
  const items = await runActor<Record<string, unknown>>(actor, {
    startUrls: [{ url }],
    maxItems: limit + 1,
  });
  const post = items[0];
  if (!post) throw new Error(`No data returned for that ${label} URL.`);
  return buildPost(url, post, dedupeComments(items.slice(1)));
}

// ── dispatcher ───────────────────────────────────────────────────
export async function scrapePost(
  url: string,
  commentLimit = 200,
): Promise<ScrapedPost> {
  switch (detectPlatform(url)) {
    case "instagram":
      return scrapeInstagram(url, commentLimit);
    case "tiktok":
      return scrapeTikTok(url, commentLimit);
    case "reddit":
      return scrapeReddit(url, commentLimit);
    case "x":
      return scrapeX(url, commentLimit);
    case "facebook":
      return scrapeFacebook(url, commentLimit);
    case "youtube":
      return scrapeYouTube(url, commentLimit);
    case "linkedin":
      return scrapeGeneric(url, "APIFY_LINKEDIN_ACTOR", "LinkedIn", commentLimit);
    case "nextdoor":
      return scrapeGeneric(url, "APIFY_NEXTDOOR_ACTOR", "Nextdoor", commentLimit);
    default:
      throw new Error(
        "Unrecognized link. Paste a URL from Instagram, TikTok, Reddit, X, Facebook, or YouTube.",
      );
  }
}
