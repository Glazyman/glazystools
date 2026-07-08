export const maxDuration = 120;

// Proxies a scraped video URL and forces a file download. Needed because the
// browser ignores the `download` attribute on cross-origin links, and video CDN
// URLs are cross-origin.
//
// Basic SSRF guard: only http(s), and block localhost / private IP ranges.
const BLOCKED_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?)/i;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get("url");
  const rawName = searchParams.get("name") || "video";
  const name = rawName.replace(/[^\w.-]/g, "_").slice(0, 80) || "video";

  if (!target) return new Response("Missing url", { status: 400 });

  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return new Response("Bad url", { status: 400 });
  }
  if (!/^https?:$/.test(u.protocol) || BLOCKED_HOST.test(u.hostname)) {
    return new Response("Blocked url", { status: 400 });
  }

  const upstream = await fetch(target).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response("Could not fetch the video.", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "video/mp4";
  const ext = contentType.includes("mp4")
    ? "mp4"
    : contentType.includes("webm")
      ? "webm"
      : "mp4";
  const filename = /\.\w{2,4}$/.test(name) ? name : `${name}.${ext}`;

  // ?inline=1 streams for in-page playback (same-origin, so it sidesteps the
  // CDN hotlink protection that blocks direct <video src> playback).
  const inline = searchParams.get("inline") === "1";
  const headers: Record<string, string> = {
    "content-type": contentType,
    "content-disposition": inline
      ? "inline"
      : `attachment; filename="${filename}"`,
  };
  const len = upstream.headers.get("content-length");
  if (len) headers["content-length"] = len;

  return new Response(upstream.body, { headers });
}
