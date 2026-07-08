import { detectPlatform, scrapePost } from "@/lib/grab-it/platforms";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/^https?:\/\//i.test(url)) {
      return Response.json(
        { error: "Please paste a valid post/video URL." },
        { status: 400 },
      );
    }
    if (detectPlatform(url) === "unknown") {
      return Response.json(
        {
          error:
            "Unrecognized link. Supported: Instagram, TikTok, Reddit, X, Facebook, YouTube.",
        },
        { status: 400 },
      );
    }
    const post = await scrapePost(url);
    return Response.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
