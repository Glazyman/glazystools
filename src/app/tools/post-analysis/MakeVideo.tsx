"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScrapedPost } from "@/lib/grab-it/types";
import type { RenderJob, VideoLength } from "@/lib/grab-it/video/types";

type Phase = "idle" | "building" | "rendering" | "done" | "error";

const LENGTHS: { key: VideoLength; label: string; hint: string }[] = [
  { key: "full", label: "Full length", hint: "every second of the original audio" },
  { key: "highlight", label: "Highlight ~30s", hint: "the strongest stretch only" },
];

// Renders can outlast any single request, so the server hands back a render id
// and we poll for it here.
const POLL_MS = 5000;
const MAX_POLLS = 240; // ~20 min

export function MakeVideo({
  post,
  transcript,
}: {
  post: ScrapedPost;
  transcript?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [length, setLength] = useState<VideoLength>("full");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [job, setJob] = useState<RenderJob | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const poll = useCallback(async (renderId: string) => {
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      if (cancelled.current) return;
      const res = await fetch(
        `/api/grab-it/make-video/status?id=${encodeURIComponent(renderId)}`,
      );
      const data = (await res.json()) as RenderJob & { error?: string };
      if (cancelled.current) return;
      if (!res.ok) {
        setPhase("error");
        setError(data.error ?? "Lost track of the render.");
        return;
      }
      setJob(data);
      if (data.status === "completed") {
        setPhase("done");
        return;
      }
      if (data.status === "failed") {
        setPhase("error");
        setError(data.error ?? "The render failed.");
        return;
      }
    }
    setPhase("error");
    setError("The render is taking unusually long — check HeyGen directly.");
  }, []);

  const start = useCallback(async () => {
    setPhase("building");
    setError(null);
    setNote(null);
    setJob(null);
    try {
      const res = await fetch("/api/grab-it/make-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post, length, transcript }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not make the video.");
      if (data.imagesFailed > 0) {
        setNote(
          `${data.imagesFailed} of ${data.scenes + data.imagesFailed} b-roll images failed; the rest were stretched to cover the gap.`,
        );
      }
      setPhase("rendering");
      await poll(data.renderId);
    } catch (e) {
      if (cancelled.current) return;
      setPhase("error");
      setError(e instanceof Error ? e.message : "Could not make the video.");
    }
  }, [post, length, transcript, poll]);

  if (!post.videoUrl) return null;

  const busy = phase === "building" || phase === "rendering";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-elevated p-4">
      <div>
        <h4 className="text-sm font-semibold text-fg">🎬 Make a new video</h4>
        <p className="mt-1 text-xs text-muted">
          Keeps the original audio, replaces the visuals with AI b-roll timed to
          the transcript.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {LENGTHS.map((l) => (
          <button
            key={l.key}
            onClick={() => setLength(l.key)}
            disabled={busy}
            title={l.hint}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              length === l.key
                ? "bg-accent text-bg"
                : "bg-panel text-muted hover:text-fg"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      {phase !== "done" && (
        <button
          onClick={start}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {busy && (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-bg/30 border-t-bg" />
          )}
          {phase === "building"
            ? "Writing the b-roll…"
            : phase === "rendering"
              ? "Rendering…"
              : "Make a new video"}
        </button>
      )}

      {phase === "building" && (
        <p className="text-xs text-subtle">
          Transcribing with timings, planning scenes, and generating stills. This
          takes a couple of minutes.
        </p>
      )}

      {phase === "rendering" && (
        <p className="text-xs text-subtle">
          Sent to HeyGen{job?.status ? ` · ${job.status}` : ""}. You can leave
          this open.
        </p>
      )}

      {note && <p className="text-xs text-subtle">⚠ {note}</p>}

      {phase === "error" && error && (
        <div className="space-y-2">
          <p className="text-xs text-red-400">{error}</p>
          <button
            onClick={start}
            className="rounded-md bg-panel px-2.5 py-1 text-xs text-muted transition-colors hover:text-fg"
          >
            Try again
          </button>
        </div>
      )}

      {phase === "done" && job?.videoUrl && (
        <div className="space-y-2">
          <video
            src={job.videoUrl}
            controls
            playsInline
            className="max-h-[420px] w-full rounded-lg bg-black"
          />
          <div className="flex gap-3">
            <a
              href={job.videoUrl}
              download
              className="text-xs text-accent hover:underline"
            >
              ⬇ download
            </a>
            <button
              onClick={() => {
                setPhase("idle");
                setJob(null);
              }}
              className="text-xs text-muted hover:text-fg"
            >
              make another
            </button>
          </div>
          <p className="text-[11px] text-subtle">
            This link expires — download it if you want to keep it.
          </p>
        </div>
      )}
    </div>
  );
}
