"use client";

import { useCallback, useEffect, useState } from "react";
import type { ScrapedPost } from "@/lib/grab-it/types";
import type { BuildResult, VideoLength } from "@/lib/grab-it/video/types";

type Phase = "idle" | "building" | "done" | "error";

const LENGTHS: { key: VideoLength; label: string; hint: string }[] = [
  { key: "full", label: "Full length", hint: "every second of the original audio" },
  { key: "highlight", label: "Highlight ~30s", hint: "the strongest stretch only" },
];

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
  const [result, setResult] = useState<BuildResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [zipUrl, setZipUrl] = useState<string | null>(null);

  // Frees the previous zip when a new one replaces it, and the last one on
  // unmount — otherwise each rebuild pins another copy in memory.
  useEffect(() => {
    if (!zipUrl) return;
    return () => URL.revokeObjectURL(zipUrl);
  }, [zipUrl]);

  const start = useCallback(async () => {
    setPhase("building");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/grab-it/make-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ post, length, transcript }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not make the video.");
      }

      const blob = await res.blob();
      setZipUrl(URL.createObjectURL(blob));

      const disp = res.headers.get("content-disposition") ?? "";
      setResult({
        duration: Number(res.headers.get("x-video-duration") ?? 0),
        scenes: Number(res.headers.get("x-video-scenes") ?? 0),
        filename: /filename="(.+?)"/.exec(disp)?.[1] ?? "broll.zip",
        bytes: blob.size,
      });
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "Could not make the video.");
    }
  }, [post, length, transcript]);

  if (!post.videoUrl) return null;

  const busy = phase === "building";
  // Two steps because the free image service serves one request at a time at
  // ~45s each — minutes of fetching that belongs on a machine with no timeout.
  const cmd = "node broll.mjs && npx hyperframes render -o out.mp4";
  const brollMins = result ? Math.max(1, Math.round((result.scenes * 45) / 60)) : 0;

  return (
    <div className="space-y-3 rounded-lg border border-border bg-elevated p-4">
      <div>
        <h4 className="text-sm font-semibold text-fg">🎬 Make a new video</h4>
        <p className="mt-1 text-xs text-muted">
          Keeps the original audio, replaces the visuals with AI b-roll timed to
          the transcript. Free — you render the last step locally.
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
          {busy ? "Building…" : "Make a new video"}
        </button>
      )}

      {busy && (
        <p className="text-xs text-subtle">
          Transcribing with timings and planning the scenes. Under a minute — the
          slow part (fetching stills) happens on your machine, where nothing
          times out.
        </p>
      )}

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

      {phase === "done" && result && zipUrl && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            ✅ {result.duration.toFixed(0)}s · {result.scenes} scenes ·{" "}
            {(result.bytes / 1024 / 1024).toFixed(1)}MB
          </p>

          <a
            href={zipUrl}
            download={result.filename}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong"
          >
            ⬇ Download project
          </a>

          <div className="space-y-1.5">
            <p className="text-xs text-muted">
              Unzip it, then in that folder run:
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(cmd);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex w-full items-center justify-between gap-2 rounded-md bg-panel px-2.5 py-2 text-left font-mono text-[11px] text-fg transition-colors hover:bg-bg"
            >
              <span>{cmd}</span>
              <span className="shrink-0 text-subtle">{copied ? "copied" : "copy"}</span>
            </button>
            <p className="text-[11px] text-subtle">
              Needs Node 22+ and FFmpeg. The stills take ~{brollMins} min (the
              free image service serves one at a time); the render itself is
              ~20s. Both free. Re-run <span className="font-mono">broll.mjs</span>{" "}
              to retry any that fail — it skips what it already has. README&apos;s
              in the zip.
            </p>
          </div>

          <button
            onClick={() => {
              setPhase("idle");
              setResult(null);
            }}
            className="text-xs text-muted hover:text-fg"
          >
            make another
          </button>
        </div>
      )}
    </div>
  );
}
