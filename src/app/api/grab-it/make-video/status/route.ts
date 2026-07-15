import { getRender } from "@/lib/grab-it/video/heygen";

export const maxDuration = 30;

// Polled by the client while a render runs. The video_url it returns is a
// short-lived presigned URL, so the client should use it promptly rather than
// storing it.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return Response.json({ error: "Missing render id." }, { status: 400 });
  }
  try {
    return Response.json(await getRender(id));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not check the render.";
    return Response.json({ error: message }, { status: 500 });
  }
}
