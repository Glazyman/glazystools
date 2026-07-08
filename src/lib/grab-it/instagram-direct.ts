import type { ScrapedComment } from "./types";

// Fetch Instagram comments straight from Instagram's own web API using a
// logged-in cookie — the same thing paid scrapers do internally, but free.
// Pages through comments with the `min_id` cursor. No Apify involved.

const B64 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Instagram shortcodes are the media id base64-encoded (custom alphabet).
export function shortcodeToMediaId(shortcode: string): string | null {
  try {
    let id = BigInt(0);
    const base = BigInt(64);
    for (const ch of shortcode) {
      const idx = B64.indexOf(ch);
      if (idx < 0) return null;
      id = id * base + BigInt(idx);
    }
    return id.toString();
  } catch {
    return null;
  }
}

function csrfFrom(cookie: string): string {
  return /csrftoken=([^;]+)/.exec(cookie)?.[1] ?? "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawComment = {
  pk?: string | number;
  text?: string;
  comment_like_count?: number;
  child_comment_count?: number;
  created_at?: number;
  user?: { username?: string };
};

export async function fetchInstagramCommentsDirect(
  shortcode: string,
  cookie: string,
  opts: { maxComments?: number; shortcodeUrl?: string } = {},
): Promise<ScrapedComment[]> {
  const mediaId = shortcodeToMediaId(shortcode);
  if (!mediaId) return [];

  const maxComments = opts.maxComments ?? 2000;
  const maxPages = Math.ceil(maxComments / 12) + 4;
  const headers: Record<string, string> = {
    Cookie: cookie,
    "x-ig-app-id": "936619743392459",
    "x-csrftoken": csrfFrom(cookie),
    "x-requested-with": "XMLHttpRequest",
    "x-asbd-id": "129477",
    "x-ig-www-claim": "0",
    Accept: "*/*",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Referer:
      opts.shortcodeUrl ?? `https://www.instagram.com/reel/${shortcode}/`,
  };

  const out: ScrapedComment[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < maxPages && out.length < maxComments; page++) {
    const url =
      `https://www.instagram.com/api/v1/media/${mediaId}/comments/` +
      `?can_support_threading=true&permalink_enabled=false` +
      (cursor ? `&min_id=${encodeURIComponent(cursor)}` : "");
    let data: { comments?: RawComment[]; next_min_id?: string };
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const ct = res.headers.get("content-type") ?? "";
      if (!ct.includes("json")) break; // IG served HTML → not authed / blocked
      data = await res.json();
    } catch {
      break;
    }
    const batch = data.comments ?? [];
    for (const c of batch) {
      const text = (c.text ?? "").trim();
      if (!text) continue;
      const id = String(c.pk ?? `${page}-${out.length}`);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        text,
        author: c.user?.username ?? "unknown",
        likes: Number(c.comment_like_count ?? 0) || 0,
        timestamp: c.created_at ? String(c.created_at) : undefined,
        replyCount: Number(c.child_comment_count ?? 0) || undefined,
      });
    }
    cursor = data.next_min_id ?? null;
    if (!cursor || batch.length === 0) break;
    await sleep(900); // be gentle to avoid rate limiting
  }

  return out;
}
