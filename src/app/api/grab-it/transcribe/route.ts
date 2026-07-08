import { transcribePost } from "@/lib/grab-it/analyze";
import type { ScrapedPost } from "@/lib/grab-it/types";

export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { post } = (await req.json()) as { post: ScrapedPost };
    if (!post) {
      return Response.json({ error: "Missing post data." }, { status: 400 });
    }
    const result = await transcribePost(post);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
