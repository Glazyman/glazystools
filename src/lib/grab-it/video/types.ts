// Types for "Make a new video" — turning an analyzed post into a fresh
// HyperFrames video that keeps the original audio and replaces the visuals
// with generated b-roll.

// One spoken chunk of the source video, with timings. The analyzer's own
// transcript is an untimed string, so the video pipeline asks for these
// separately (see ./transcript.ts).
export type TranscriptSegment = {
  start: number; // seconds into the source video
  end: number;
  text: string;
};

export type TimedTranscript = {
  segments: TranscriptSegment[];
  durationSeconds: number; // full length of the source video
};

// How much of the original to keep.
export type VideoLength = "full" | "highlight";

// Ken Burns move for a scene's still image. Kept to a small set so the
// composition stays deterministic and easy to eyeball.
export type SceneMotion = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

// One b-roll beat: an image standing in for what's being said over it.
export type VideoScene = {
  start: number; // seconds on the OUTPUT timeline (not the source)
  duration: number;
  imagePrompt: string; // what to generate
  caption: string; // short on-screen text (empty = no caption)
  motion: SceneMotion;
};

export type VideoPlan = {
  // Where the kept audio starts inside the source file. 0 for "full".
  audioStart: number;
  duration: number; // output length in seconds
  styleNote: string; // the visual through-line, folded into every image prompt
  scenes: VideoScene[];
};

// A scene once its image has actually been generated.
export type RenderedScene = VideoScene & {
  file: string; // path inside the zip, e.g. "assets/scene-01.jpg"
  bytes: Uint8Array;
};

export type RenderStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type RenderJob = {
  renderId: string;
  status: RenderStatus;
  videoUrl?: string; // short-lived presigned URL — re-fetch, don't cache
  thumbnailUrl?: string;
  error?: string;
};
