import { generateImage } from "ai";
import type { RenderedScene, VideoPlan } from "./types";

// Verified reachable on this account's AI Gateway. Imagen 4 Fast returns a 9:16
// still in ~5s. Override once you want to trade up.
const IMAGE_MODEL =
  process.env.GRAB_IT_IMAGE_MODEL ?? "google/imagen-4.0-fast-generate-001";

// Generated in parallel, but capped: a 60s video is ~15 images, and firing all
// of them at once invites gateway rate limits mid-render.
const CONCURRENCY = Number(process.env.GRAB_IT_IMAGE_CONCURRENCY ?? 4);

const NEGATIVE =
  "no text, no letters, no words, no captions, no logos, no watermarks, no signatures";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function generateOne(
  prompt: string,
  index: number,
  onError: (e: unknown) => void,
): Promise<Uint8Array | null> {
  try {
    const { image } = await generateImage({
      model: IMAGE_MODEL,
      prompt,
      aspectRatio: "9:16",
      maxRetries: 2,
      // Deterministic per slot: a retried render reuses the same seed, so the
      // same plan yields the same visuals instead of a different video.
      seed: 1000 + index,
    });
    return image.uint8Array;
  } catch (e) {
    onError(e);
    return null;
  }
}

// The gateway's free tier allows only a trickle of image requests before
// refusing the rest, which surfaces as every scene failing at once. Say so
// plainly instead of making the user guess.
function explain(lastError: unknown): string {
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  if (/rate-limit|rate limit|quota/i.test(msg)) {
    return `B-roll generation is rate-limited on the AI Gateway free tier — ${IMAGE_MODEL} needs paid credits. Add credits in the Vercel dashboard under AI Gateway.`;
  }
  return `Every b-roll image failed to generate. Last error: ${msg.slice(0, 200)}`;
}

// Generates one still per scene. A scene whose image fails is dropped rather
// than left blank, and the caller re-tiles the timeline around the survivors.
export async function generateBroll(
  plan: VideoPlan,
): Promise<{ scenes: RenderedScene[]; failed: number }> {
  const results: (RenderedScene | null)[] = new Array(plan.scenes.length).fill(
    null,
  );

  let next = 0;
  let lastError: unknown = null;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= plan.scenes.length) return;
      const scene = plan.scenes[i];
      const prompt = `${scene.imagePrompt}. ${plan.styleNote}. Vertical 9:16 composition. ${NEGATIVE}.`;
      const bytes = await generateOne(prompt, i, (e) => {
        lastError = e;
      });
      if (bytes) {
        results[i] = { ...scene, file: `assets/scene-${pad(i + 1)}.png`, bytes };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, plan.scenes.length) }, worker),
  );

  const kept = results.filter((s): s is RenderedScene => s !== null);
  const failed = plan.scenes.length - kept.length;

  if (!kept.length) throw new Error(explain(lastError));

  // Close the holes left by failures so the audio still has visuals over it:
  // each survivor absorbs the time of any dropped scene before it.
  let cursor = 0;
  for (let i = 0; i < kept.length; i++) {
    const isLast = i === kept.length - 1;
    const nextStart = isLast ? plan.duration : kept[i + 1].start;
    kept[i] = { ...kept[i], start: cursor, duration: nextStart - cursor };
    cursor = nextStart;
  }

  return { scenes: kept, failed };
}
