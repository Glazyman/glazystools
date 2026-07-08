import type { ScrapedComment, ScrapedPost } from "./types";

// Apify client for Instagram. Uses the "run-sync-get-dataset-items" endpoint,
// which runs an actor and returns its dataset items in a single request.
//
// Two actors are used:
//   - instagram-scraper        → post details (caption, video URL, author, counts)
//   - instagram-comment-scraper → every comment on the post
// Both actor IDs are overridable via env in case you prefer different ones.

const API = "https://api.apify.com/v2/acts";

const POST_ACTOR =
  process.env.APIFY_INSTAGRAM_POST_ACTOR ?? "apify~instagram-scraper";
const COMMENT_ACTOR =
  process.env.APIFY_INSTAGRAM_COMMENT_ACTOR ??
  "apify~instagram-comment-scraper";
// Authenticated deep-comment actor: with the user's Instagram cookies it pulls
// ALL comments (the logged-out scraper only sees a small batch). Cheap per
// comment (~$0.0002). Used only when APIFY_INSTAGRAM_COOKIES is set.
const DEEP_COMMENT_ACTOR =
  process.env.APIFY_INSTAGRAM_DEEP_ACTOR ??
  "louisdeconinck~instagram-comments-scraper";

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set.");
  return t;
}

// Instagram auth cookies for deep scraping, provided via env (JSON array from a
// "cookie export" extension, or a raw cookie string). Null when not configured.
function instagramCookies(): unknown | null {
  const raw = process.env.APIFY_INSTAGRAM_COOKIES?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // fall back to raw string form
  }
}

export async function runActor<T = Record<string, unknown>>(
  actor: string,
  input: Record<string, unknown>,
): Promise<T[]> {
  const res = await fetch(
    `${API}/${actor}/run-sync-get-dataset-items?token=${token()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Apify actor "${actor}" failed (${res.status}): ${body.slice(0, 300)}`,
    );
  }
  return (await res.json()) as T[];
}

// Normalize whatever shape a comment actor returns into ScrapedComment.
// Handles the many field-name variants across platforms defensively.
export function normalizeComment(
  raw: Record<string, unknown>,
  i: number,
): ScrapedComment | null {
  const text = String(
    raw.text ?? raw.comment ?? raw.body ?? raw.commentText ?? raw.content ?? "",
  ).trim();
  if (!text) return null;
  return {
    id: String(raw.id ?? raw.commentId ?? raw.cid ?? `c${i}`),
    text,
    author: String(
      raw.ownerUsername ??
        raw.owner_username ??
        raw.username ??
        raw.author ??
        raw.uniqueId ??
        raw.name ??
        "unknown",
    ),
    likes:
      Number(
        raw.likesCount ??
          raw.likes_count ??
          raw.likes ??
          raw.diggCount ??
          raw.upVotes ??
          raw.upvotes ??
          raw.voteCount ??
          0,
      ) || 0,
    timestamp: raw.timestamp
      ? String(raw.timestamp)
      : raw.createdAt
        ? String(raw.createdAt)
        : undefined,
    replyCount:
      Number(raw.repliesCount ?? raw.replies_count ?? raw.replyCount ?? 0) ||
      undefined,
  };
}

// Decide whether a scraped item is a video, image, or text post — so the UI and
// analysis adapt (a Reddit self-post has no video to transcribe or download).
export function classifyKind(o: {
  videoUrl?: string;
  displayUrl?: string;
  type?: string;
  caption?: string;
}): "video" | "image" | "text" {
  const t = (o.type ?? "").toLowerCase();
  if (o.videoUrl || /video|reel|clip|short/.test(t)) return "video";
  if (/image|photo|sidecar|carousel|gif/.test(t)) return "image";
  if (/text|self|link|article/.test(t)) return "text";
  return o.displayUrl && !o.caption ? "image" : "text";
}

export async function scrapeInstagram(
  url: string,
  commentLimit = 200,
): Promise<ScrapedPost> {
  // 1) Post details.
  const details = await runActor<Record<string, unknown>>(POST_ACTOR, {
    directUrls: [url],
    resultsType: "details",
    resultsLimit: 1,
    addParentData: false,
  });
  const post = details[0];
  if (!post) {
    throw new Error(
      "Apify returned no data for that URL. Check the link is a public reel/post.",
    );
  }

  // Comments sometimes ride along on the details result.
  const inlineComments = Array.isArray(post.latestComments)
    ? (post.latestComments as Record<string, unknown>[])
    : [];

  // 2) Comment sweep. With auth cookies, use the deep actor (ALL comments);
  //    otherwise the logged-out actor (small batch).
  let commentItems: Record<string, unknown>[] = [];
  const cookies = instagramCookies();
  if (cookies) {
    try {
      const deep = await runActor<Record<string, unknown>>(DEEP_COMMENT_ACTOR, {
        urls: [url],
        maxComments: commentLimit,
        cookies,
      });
      // The actor emits a {message:"…provide cookies…"} row when auth is
      // missing/expired — keep only rows that actually carry comment text.
      commentItems = deep.filter(
        (c) => c && (c.text ?? c.comment ?? c.body ?? c.commentText),
      );
    } catch {
      commentItems = [];
    }
  }
  if (commentItems.length === 0) {
    try {
      commentItems = await runActor<Record<string, unknown>>(COMMENT_ACTOR, {
        directUrls: [url],
        resultsLimit: commentLimit,
      });
    } catch {
      // Fall back to whatever came inline if the comment actor is unavailable.
      commentItems = inlineComments;
    }
  }

  // Merge + dedupe (prefer the fuller sweep, top up with inline).
  const merged = [...commentItems, ...inlineComments];
  const seen = new Set<string>();
  const comments: ScrapedComment[] = [];
  merged.forEach((raw, i) => {
    const c = normalizeComment(raw, i);
    if (!c) return;
    const key = `${c.author}:${c.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    comments.push(c);
  });

  const type = post.type ? String(post.type) : undefined;
  const videoUrl = post.videoUrl ? String(post.videoUrl) : undefined;
  const displayUrl = post.displayUrl ? String(post.displayUrl) : undefined;
  const caption = String(post.caption ?? "");
  return {
    url,
    shortcode: post.shortCode ? String(post.shortCode) : undefined,
    type,
    kind: classifyKind({ videoUrl, displayUrl, type, caption }),
    caption,
    author: String(post.ownerUsername ?? post.ownerFullName ?? "unknown"),
    videoUrl,
    displayUrl,
    likes: Number(post.likesCount ?? 0) || undefined,
    commentsCount: Number(post.commentsCount ?? comments.length) || undefined,
    comments,
  };
}
