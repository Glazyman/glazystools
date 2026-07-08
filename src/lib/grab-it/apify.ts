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

  // 2) Full comment sweep via the dedicated comment actor.
  let commentItems: Record<string, unknown>[] = [];
  try {
    commentItems = await runActor<Record<string, unknown>>(COMMENT_ACTOR, {
      directUrls: [url],
      resultsLimit: commentLimit,
    });
  } catch {
    // Fall back to whatever came inline if the comment actor is unavailable.
    commentItems = inlineComments;
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

  return {
    url,
    shortcode: post.shortCode ? String(post.shortCode) : undefined,
    type: post.type ? String(post.type) : undefined,
    caption: String(post.caption ?? ""),
    author: String(post.ownerUsername ?? post.ownerFullName ?? "unknown"),
    videoUrl: post.videoUrl ? String(post.videoUrl) : undefined,
    displayUrl: post.displayUrl ? String(post.displayUrl) : undefined,
    likes: Number(post.likesCount ?? 0) || undefined,
    commentsCount: Number(post.commentsCount ?? comments.length) || undefined,
    comments,
  };
}
