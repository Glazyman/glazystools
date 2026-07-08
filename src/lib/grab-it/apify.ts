import { fetchInstagramCommentsDirect } from "./instagram-direct";
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
function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error("APIFY_TOKEN is not set.");
  return t;
}

// Instagram auth cookies for direct comment fetching, as a cookie-header STRING
// ("name=value; …"). Accepts a JSON array (from a cookie-export extension) or a
// raw string in INSTAGRAM_COOKIES.
function instagramCookies(): string | null {
  const raw = (
    process.env.INSTAGRAM_COOKIES ??
    process.env.APIFY_INSTAGRAM_COOKIES ??
    ""
  ).trim();
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as { name: string; value: string }[];
    if (Array.isArray(arr)) {
      return arr.map((c) => `${c.name}=${c.value}`).join("; ");
    }
  } catch {
    // not JSON — assume it's already a cookie string
  }
  return raw;
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
  // Some actors nest the author under a `user`/`owner` object.
  const user = (raw.user ?? raw.owner ?? {}) as Record<string, unknown>;
  return {
    id: String(raw.id ?? raw.commentId ?? raw.cid ?? raw.pk ?? `c${i}`),
    text,
    author: String(
      raw.ownerUsername ??
        raw.owner_username ??
        raw.username ??
        raw.author ??
        raw.uniqueId ??
        raw.name ??
        user.username ??
        user.full_name ??
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
          raw.comment_like_count ??
          0,
      ) || 0,
    timestamp: raw.timestamp
      ? String(raw.timestamp)
      : raw.createdAt
        ? String(raw.createdAt)
        : raw.created_at
          ? String(raw.created_at)
          : undefined,
    replyCount:
      Number(
        raw.repliesCount ??
          raw.replies_count ??
          raw.replyCount ??
          raw.child_comment_count ??
          0,
      ) || undefined,
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

  const shortcode = post.shortCode
    ? String(post.shortCode)
    : (url.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/)?.[1] ?? "");

  // 2a) BEST path: with a login cookie, page comments straight from Instagram's
  //     own web API — free, and pulls far more than the logged-out scraper.
  const cookies = instagramCookies();
  let direct: ScrapedComment[] = [];
  if (cookies && shortcode) {
    direct = await fetchInstagramCommentsDirect(shortcode, cookies, {
      maxComments: commentLimit,
      shortcodeUrl: url,
    });
  }

  // 2b) Fallback: Apify logged-out comment actor (small batch) if no cookie or
  //     the direct fetch came back empty (expired cookie / IG blocked the IP).
  let commentItems: Record<string, unknown>[] = [];
  if (direct.length === 0) {
    try {
      commentItems = await runActor<Record<string, unknown>>(COMMENT_ACTOR, {
        directUrls: [url],
        resultsLimit: commentLimit,
      });
    } catch {
      commentItems = inlineComments;
    }
  }

  // Merge + dedupe (direct comments first, then Apify/inline as backup).
  const seen = new Set<string>();
  const comments: ScrapedComment[] = [];
  for (const c of direct) {
    const key = `${c.author}:${c.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    comments.push(c);
  }
  const merged = [...commentItems, ...inlineComments];
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
    commentSource: direct.length > 0 ? "login" : "logged-out",
  };
}
