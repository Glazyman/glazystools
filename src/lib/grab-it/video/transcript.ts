import { generateObject } from "ai";
import { z } from "zod";
import type { TimedTranscript } from "./types";

// Same multimodal model the analyzer uses to read videos.
const TIMING_MODEL =
  process.env.GRAB_IT_VIDEO_MODEL ?? "google/gemini-2.5-flash";

// Gemini's inline-file ceiling, matching analyze.ts.
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;

export class SourceVideoError extends Error {}

// The source MP4 serves double duty: Gemini transcribes it, and it ships in the
// render zip as the audio track. Fetch it once and pass the bytes around.
export async function fetchSourceVideo(videoUrl: string): Promise<Buffer> {
  const res = await fetch(videoUrl).catch(() => null);
  if (!res?.ok) {
    throw new SourceVideoError(
      "Couldn't download the source video from the platform CDN.",
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_VIDEO_BYTES) {
    throw new SourceVideoError(
      `Video is ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB — over the ${
        MAX_VIDEO_BYTES / 1024 / 1024
      }MB limit for transcription.`,
    );
  }
  return buf;
}

const schema = z.object({
  durationSeconds: z
    .number()
    .describe("Total length of the video in seconds, as precisely as you can."),
  segments: z
    .array(
      z.object({
        start: z.number().describe("Seconds from the start of the video."),
        end: z.number().describe("Seconds from the start of the video."),
        text: z.string().describe("Exactly what is said in this window."),
      }),
    )
    .describe(
      "The spoken audio split into consecutive timed chunks, in order, covering the whole video.",
    ),
});

// The analyzer already produces a transcript, but as one untimed string — no use
// for syncing b-roll. This asks the same model for the same words WITH timings.
// Kept separate from analyzePost on purpose: that call is already doing
// transcription + comment scoring + build ideas, and adding timing extraction to
// it risks degrading all three. This one only runs when the user asks for a video.
export async function getTimedTranscript(
  video: Buffer,
  knownTranscript?: string,
): Promise<TimedTranscript> {
  const hint = knownTranscript?.trim()
    ? [
        ``,
        `For reference, here is the transcript already produced for this video.`,
        `Use it to keep the wording consistent — your job is to supply the TIMINGS:`,
        knownTranscript.trim().slice(0, 4000),
      ].join("\n")
    : "";

  const { object } = await generateObject({
    model: TIMING_MODEL,
    schema,
    maxRetries: 3,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `Transcribe this video into consecutive timed segments.`,
              ``,
              `Rules:`,
              `- Break at natural sentence or clause boundaries, roughly 2-5 seconds each.`,
              `- Segments must be in order and must not overlap.`,
              `- Cover the whole video; don't skip speech.`,
              `- Transcribe speech only. Do not include on-screen text.`,
              `- Also report the video's total duration in seconds.`,
              hint,
            ].join("\n"),
          },
          { type: "file", mediaType: "video/mp4", data: video },
        ],
      },
    ],
  });

  // The model can drift: out-of-order, overlapping, or zero-length segments all
  // break the b-roll timeline downstream. Normalize rather than trust it.
  const segments = object.segments
    .map((s) => ({
      start: Math.max(0, s.start),
      end: Math.max(0, s.end),
      text: s.text.trim(),
    }))
    .filter((s) => s.text && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  // Clamp each segment to start no earlier than the previous one ended.
  const clean: TimedTranscript["segments"] = [];
  for (const s of segments) {
    const prev = clean[clean.length - 1];
    const start = prev ? Math.max(s.start, prev.end) : s.start;
    if (s.end > start) clean.push({ ...s, start });
  }

  if (!clean.length) {
    throw new SourceVideoError(
      "No speech could be transcribed from this video, so there's nothing to build b-roll against.",
    );
  }

  // Trust the segments over the model's duration guess if they run longer.
  const lastEnd = clean[clean.length - 1].end;
  const durationSeconds = Math.max(object.durationSeconds || 0, lastEnd);

  return { segments: clean, durationSeconds };
}
