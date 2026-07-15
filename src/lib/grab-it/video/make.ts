import type { ScrapedPost } from "../types";
import { buildComposition } from "./composition";
import { submitRender, uploadProject, zipProject } from "./heygen";
import { generateBroll } from "./images";
import { planVideo } from "./plan";
import { fetchSourceVideo, getTimedTranscript, SourceVideoError } from "./transcript";
import type { VideoLength, VideoPlan } from "./types";

export type BuiltProject = {
  files: Record<string, Uint8Array>; // paths → bytes, ready to zip or write to disk
  plan: VideoPlan;
  imagesFailed: number;
};

// Everything up to (but not including) the render: transcribe → plan → generate
// b-roll → assemble the HyperFrames project. Deliberately split from the
// HeyGen submit so it can be exercised locally with `npx hyperframes render`
// without spending cloud credits.
export async function buildProject(
  post: ScrapedPost,
  length: VideoLength,
  knownTranscript?: string,
): Promise<BuiltProject> {
  if (!post.videoUrl) {
    throw new SourceVideoError(
      "This post has no video file, so there's no audio to build a new video from.",
    );
  }

  // One download, two uses: Gemini reads it, and it ships as the audio track.
  const source = await fetchSourceVideo(post.videoUrl);
  const transcript = await getTimedTranscript(source, knownTranscript);
  const plan = await planVideo(post, transcript, length);
  const { scenes, failed } = await generateBroll(plan);
  const html = buildComposition(plan, scenes, { author: post.author });

  const files: Record<string, Uint8Array> = {
    "index.html": new TextEncoder().encode(html),
    "assets/source.mp4": new Uint8Array(source),
  };
  for (const s of scenes) files[s.file] = s.bytes;

  return { files, plan, imagesFailed: failed };
}

// Uploads the built project and submits the render, returning as soon as
// HeyGen hands back an id. Never waits for the render to finish.
export async function submitProject(
  project: BuiltProject,
  idempotencyKey: string,
  callbackUrl?: string,
): Promise<string> {
  const zip = zipProject(project.files);
  const assetId = await uploadProject(zip, idempotencyKey);
  return submitRender(assetId, { idempotencyKey, callbackUrl });
}
