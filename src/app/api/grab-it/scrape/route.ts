import { scrapeInstagram } from "@/lib/grab-it/apify";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string" || !/instagram\.com/i.test(url)) {
      return Response.json(
        { error: "Please provide a valid Instagram post or reel URL." },
        { status: 400 },
      );
    }
    const post = await scrapeInstagram(url);
    return Response.json({ post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Scrape failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
