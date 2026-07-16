import { generateObject } from "ai";
import { z } from "zod";
import type { ScrapedPost } from "../types";
import type { TimedTranscript, VideoLength, VideoPlan } from "./types";

const PLAN_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";

// Target length of a highlight cut. We take one CONTIGUOUS window rather than
// stitching separate moments: jump-cut audio sounds broken, and a single window
// needs just one <audio> element with a data-media-start offset.
const HIGHLIGHT_SECONDS = Number(process.env.GRAB_IT_HIGHLIGHT_SECONDS ?? 30);

// Ceiling on b-roll stills per video. At ~45s each and 4 at a time, 16 images
// is ~3 minutes — the most that fits under the route's 300s limit alongside
// transcription and planning.
const MAX_SCENES = Number(process.env.GRAB_IT_MAX_SCENES ?? 16);

const schema = z.object({
  styleNote: z
    .string()
    .describe(
      "One sentence describing a single consistent visual style for every image (medium, lighting, palette, mood). No text or words in the images.",
    ),
  highlightStart: z
    .number()
    .describe(
      "Seconds into the source where the strongest contiguous stretch begins. 0 when using the whole video.",
    ),
  scenes: z
    .array(
      z.object({
        start: z
          .number()
          .describe("Seconds from the start of the OUTPUT video."),
        duration: z.number().describe("How long this image is on screen."),
        imagePrompt: z
          .string()
          .describe(
            "A vivid, literal description of a single image illustrating what is said over this beat. Describe a scene, not a concept. No text, letters, words, logos, or watermarks.",
          ),
        caption: z
          .string()
          .describe(
            "A short on-screen caption (max ~6 words) that reads as a natural phrase a person would actually write — not clipped keywords. 'Everyone said it was a terrible idea' or 'I just answered the phone', never 'Terrible idea, retiring'. Empty string when the beat is better left uncaptioned; captioning every scene is exhausting to watch.",
          ),
        motion: z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]),
      }),
    )
    .describe("B-roll beats in order, covering the output with no gaps."),
});

export async function planVideo(
  post: ScrapedPost,
  transcript: TimedTranscript,
  length: VideoLength,
): Promise<VideoPlan> {
  const full = length === "full";
  const target = full
    ? transcript.durationSeconds
    : Math.min(HIGHLIGHT_SECONDS, transcript.durationSeconds);

  // Roughly one image every ~4s — enough to feel alive without generating one
  // per second. Hard-capped because free b-roll takes ~45s an image and the
  // whole build has to finish inside the route's 300s ceiling; past the cap,
  // scenes just get longer rather than more numerous.
  const sceneCount = Math.min(
    MAX_SCENES,
    Math.max(2, Math.round(target / 4)),
  );

  const lines = transcript.segments
    .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
    .join("\n");

  const { object } = await generateObject({
    model: PLAN_MODEL,
    schema,
    maxRetries: 3,
    messages: [
      {
        role: "user",
        content: [
          `You are a video director. The ORIGINAL AUDIO of this clip is being kept exactly as-is; you are replacing the visuals with generated b-roll stills that illustrate what is being said.`,
          ``,
          `AUTHOR: @${post.author}`,
          `CAPTION: ${post.caption || "(none)"}`,
          `SOURCE LENGTH: ${transcript.durationSeconds.toFixed(1)}s`,
          ``,
          `TIMED TRANSCRIPT:`,
          lines,
          ``,
          full
            ? `Use the WHOLE video. Set highlightStart to 0. The output is ${target.toFixed(1)}s long, and your scenes must tile it from 0 to ${target.toFixed(1)} with no gaps and no overlaps.`
            : `Pick the single strongest CONTIGUOUS ${target.toFixed(0)}s stretch — the most self-contained, punchy part that stands alone. Set highlightStart to where it begins in the source. Your scene times are relative to the OUTPUT, so the first scene starts at 0 and the last ends at ${target.toFixed(1)}.`,
          ``,
          `Produce about ${sceneCount} scenes. For each, describe an image that illustrates the words spoken over that exact moment.`,
          ``,
          `Image prompt rules:`,
          `- Describe a concrete, literal, photographable scene — not an abstraction.`,
          `- Never ask for text, letters, words, numbers, logos, or watermarks; image models render them as garbage.`,
          `- Favour places, objects, tools, and environments over people. The generator mangles faces and bodies. Where a person is unavoidable, keep them distant, turned away, or implied (a hand, a silhouette, an empty chair).`,
          `- Every prompt must fit the one styleNote so the video looks like a single piece.`,
          `- Vertical 9:16 framing.`,
        ].join("\n"),
      },
    ],
  });

  const audioStart = full
    ? 0
    : Math.max(
        0,
        Math.min(
          object.highlightStart,
          Math.max(0, transcript.durationSeconds - target),
        ),
      );

  // The model reliably drifts on tiling — gaps, overlaps, and a last scene that
  // overruns the audio. Rebuild the timeline from the durations it chose rather
  // than trusting its start times.
  const ordered = [...object.scenes].sort((a, b) => a.start - b.start);
  const scenes: VideoPlan["scenes"] = [];
  let cursor = 0;
  for (const s of ordered) {
    if (cursor >= target - 0.05) break;
    const duration = Math.min(
      Math.max(s.duration || 0, 1.2), // never flash an image
      target - cursor,
    );
    scenes.push({
      start: cursor,
      duration,
      imagePrompt: s.imagePrompt.trim(),
      caption: s.caption.trim(),
      motion: s.motion,
    });
    cursor += duration;
  }

  if (!scenes.length) {
    throw new Error("The director couldn't plan any scenes for this video.");
  }

  // Stretch the last scene to cover any shortfall, so visuals never end early
  // and leave a black frame under the remaining audio.
  const last = scenes[scenes.length - 1];
  if (cursor < target) last.duration += target - cursor;

  return {
    audioStart,
    duration: target,
    styleNote: object.styleNote.trim(),
    scenes,
  };
}
