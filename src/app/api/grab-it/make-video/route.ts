import { buildProject } from "@/lib/grab-it/video/make";
import { zipProject } from "@/lib/grab-it/video/zip";
import type { ScrapedPost } from "@/lib/grab-it/types";
import type { VideoLength } from "@/lib/grab-it/video/types";

// Only transcribe + plan + zip — well under the limit. The b-roll fetch and the
// render are deliberately deferred to the project's own scripts: the free image
// service serves one request at a time at ~45s each, which no function can wait
// out, and rendering needs Chromium + FFmpeg that this runtime doesn't have.
export const maxDuration = 300;

function slug(s: string): string {
  return s.replace(/[^\w-]/g, "_").slice(0, 40) || "video";
}

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
    const zip = zipProject(project.files);

    // Returns the project rather than a video. Stats ride along in headers so
    // the UI can report them beside the download.
    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${slug(post.author)}-broll.zip"`,
        "content-length": String(zip.byteLength),
        "x-video-duration": project.plan.duration.toFixed(1),
        "x-video-scenes": String(project.plan.scenes.length),
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not make the video.";
    return Response.json({ error: message }, { status: 500 });
  }
}
