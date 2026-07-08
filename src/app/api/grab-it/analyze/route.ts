import { analyzePost } from "@/lib/grab-it/analyze";
import type { ScrapedPost } from "@/lib/grab-it/types";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { post } = (await req.json()) as { post: ScrapedPost };
    if (!post || !Array.isArray(post.comments)) {
      return Response.json(
        { error: "Missing scraped post data." },
        { status: 400 },
      );
    }
    const analysis = await analyzePost(post);
    return Response.json({ analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
