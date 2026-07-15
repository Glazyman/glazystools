import { randomUUID } from "node:crypto";
import { buildProject, submitProject } from "@/lib/grab-it/video/make";
import type { ScrapedPost } from "@/lib/grab-it/types";
import type { VideoLength } from "@/lib/grab-it/video/types";

// Transcribe + plan + ~15 image generations + upload runs ~2 min. The render
// itself is NOT awaited — it's submitted and polled via ./status.
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const { post, length, transcript } = (await req.json()) as {
      post: ScrapedPost;
      length?: VideoLength;
      transcript?: string;
    };

    if (!post) {
      return Response.json({ error: "Missing post data." }, { status: 400 });
    }

    const project = await buildProject(
      post,
      length === "highlight" ? "highlight" : "full",
      transcript,
    );

    // Scopes both the upload and the submit, so a retry can't double-bill.
    const idempotencyKey = randomUUID();
    const renderId = await submitProject(project, idempotencyKey);

    return Response.json({
      renderId,
      duration: project.plan.duration,
      scenes: project.plan.scenes.length,
      imagesFailed: project.imagesFailed,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not make the video.";
    return Response.json({ error: message }, { status: 500 });
  }
}
