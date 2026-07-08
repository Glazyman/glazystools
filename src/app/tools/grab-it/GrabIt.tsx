"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Analysis,
  CombinedAnalysis,
  ScrapedComment,
  ScrapedPost,
} from "@/lib/grab-it/types";
import {
  deleteRun,
  getRun,
  listRuns,
  saveRun,
  type RunMeta,
} from "@/lib/grab-it/runs";

type Stage = "idle" | "scraping" | "analyzing" | "done" | "error";

const stageSteps = [
  { key: "scraping", label: "Grab it", detail: "Scraping video, caption & comments" },
  { key: "analyzing", label: "Understand & read the room", detail: "Transcribing + scoring every comment" },
  { key: "done", label: "Ideas & comments", detail: "Ready to explore" },
] as const;

const PAGE = 5;

type View = "run" | "saved";
type SaveState = "idle" | "saving" | "saved" | "error";
type RunMode = "full" | "transcript" | "download";

// Turn raw API errors into something actionable — especially the AI Gateway
// free-tier rate limit, which is the most common failure.
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rate.?limit|rate-limited|too many requests|\b429\b/i.test(msg)) {
    return "The AI is rate-limited on the Vercel Gateway free tier right now. Your comments are shown below — wait ~30s and hit Retry, or add Gateway credits for unlimited runs.";
  }
  if (/free tier|do not have access|no_providers_available|upgrade/i.test(msg)) {
    return "This needs paid Vercel AI Gateway credits (the free tier blocks/limits it). Your comments are shown below regardless.";
  }
  return msg;
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <span className="min-w-0 flex-1">{message}</span>
      <button
        onClick={onRetry}
        className="shrink-0 rounded-md border border-amber-500/40 px-3 py-1 text-xs font-medium hover:bg-amber-500/10"
      >
        Retry
      </button>
    </div>
  );
}

const MODES: { id: RunMode; label: string; hint: string }[] = [
  { id: "full", label: "Full analysis", hint: "Comments scored + ideas + chat" },
  { id: "transcript", label: "Transcript only", hint: "Just what the video says" },
  { id: "download", label: "Download video", hint: "Grab the video file" },
];

type TranscriptResult = {
  transcript: string;
  transcriptSource: Analysis["transcriptSource"];
};

export function GrabIt() {
  const [view, setView] = useState<View>("run");
  const [mode, setMode] = useState<RunMode>("full");
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<ScrapedPost | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [transcriptOnly, setTranscriptOnly] = useState<TranscriptResult | null>(
    null,
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saved, setSaved] = useState<RunMeta[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);

  const refreshSaved = useCallback(async () => {
    setSavedLoading(true);
    try {
      setSaved(await listRuns());
    } catch {
      // Table may be unreachable; leave the list empty.
    } finally {
      setSavedLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSaved();
  }, [refreshSaved]);

  async function run() {
    setError(null);
    setPost(null);
    setAnalysis(null);
    setTranscriptOnly(null);
    setSaveState("idle");
    setView("run");
    setStage("scraping");
    try {
      const scrapeRes = await fetch("/api/grab-it/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const scrapeData = await scrapeRes.json();
      if (!scrapeRes.ok) throw new Error(scrapeData.error ?? "Scrape failed.");
      setPost(scrapeData.post);

      // Download mode: we already have the video URL, nothing more to do.
      if (mode === "download") {
        setStage("done");
        return;
      }

      // Transcript-only mode: just get the words.
      if (mode === "transcript") {
        setStage("analyzing");
        const res = await fetch("/api/grab-it/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post: scrapeData.post }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
        setTranscriptOnly(data);
        setStage("done");
        return;
      }

      // Full analysis — if the AI step fails (e.g. rate limit), we STILL keep
      // the scraped comments on screen so the run isn't wasted.
      setStage("analyzing");
      try {
        await analyzeAndSave(scrapeData.post);
      } catch (e) {
        setError(friendlyError(e));
      }
      setStage("done");
    } catch (err) {
      setError(friendlyError(err));
      setStage("error");
    }
  }

  // Shared analyze + auto-save, reused by run() and the Retry button.
  async function analyzeAndSave(p: ScrapedPost) {
    const res = await fetch("/api/grab-it/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ post: p }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Analysis failed.");
    setAnalysis(data.analysis);
    setSaveState("saving");
    try {
      await saveRun(p, data.analysis);
      setSaveState("saved");
      refreshSaved();
    } catch {
      setSaveState("error");
    }
  }

  // Retry just the AI step against the already-scraped post (no re-scrape).
  async function retryAnalysis() {
    if (!post) return run();
    setError(null);
    setStage("analyzing");
    try {
      await analyzeAndSave(post);
    } catch (e) {
      setError(friendlyError(e));
    }
    setStage("done");
  }

  async function openSaved(id: string) {
    const full = await getRun(id);
    setPost(full.post);
    setAnalysis(full.analysis);
    setStage("done");
    setSaveState("saved");
    setError(null);
    setView("run");
  }

  const busy = stage === "scraping" || stage === "analyzing";

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <TabButton active={view === "run"} onClick={() => setView("run")}>
          Run
        </TabButton>
        <TabButton
          active={view === "saved"}
          onClick={() => {
            setView("saved");
            refreshSaved();
          }}
        >
          Saved{saved.length > 0 ? ` (${saved.length})` : ""}
        </TabButton>
      </div>

      {view === "run" ? (
        <>
          {/* Mode selector */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                  mode === m.id
                    ? "border-accent bg-accent/10"
                    : "border-border bg-elevated hover:border-border-strong"
                }`}
              >
                <div className="text-sm font-medium text-fg">{m.label}</div>
                <div className="text-[11px] text-subtle">{m.hint}</div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url && !busy && run()}
              placeholder="Paste a link — Instagram, TikTok, Reddit, X, Facebook, YouTube…"
              className="flex-1 rounded-lg border border-border bg-elevated px-3.5 py-2.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              onClick={run}
              disabled={!url || busy}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "Working…"
                : mode === "download"
                  ? "Get video"
                  : mode === "transcript"
                    ? "Transcribe"
                    : "Grab it"}
            </button>
          </div>
          <p className="text-[11px] text-subtle">
            Works with Instagram, TikTok, Reddit, X/Twitter, Facebook &amp;
            YouTube. Instagram is fully tested; the others are newly added.
          </p>

          {mode === "full" && stage !== "idle" && <StageBar stage={stage} />}
          {mode !== "full" && busy && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-panel p-4 text-sm text-muted">
              <Spinner />
              {stage === "scraping" ? "Fetching the video…" : "Transcribing…"}
            </div>
          )}

          {stage === "done" && mode === "full" && (
            <SaveIndicator state={saveState} />
          )}

          {error && <ErrorBanner message={error} onRetry={retryAnalysis} />}

          {stage === "done" && mode === "full" && post && (
            <Results post={post} analysis={analysis} />
          )}
          {stage === "done" && mode === "transcript" && post && transcriptOnly && (
            <TranscriptView post={post} result={transcriptOnly} />
          )}
          {stage === "done" && mode === "download" && post && (
            <DownloadView post={post} />
          )}

          {stage === "idle" && <EmptyHint />}
        </>
      ) : (
        <SavedView
          items={saved}
          loading={savedLoading}
          onOpen={openSaved}
          onDeleted={refreshSaved}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-accent text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  const map = {
    saving: { text: "Saving to your library…", cls: "text-muted" },
    saved: { text: "✓ Saved — find it in the Saved tab", cls: "text-emerald-400" },
    error: {
      text: "Couldn't save this run (it's still shown here).",
      cls: "text-amber-400",
    },
  } as const;
  const s = map[state as keyof typeof map];
  if (!s) return null;
  return <p className={`text-xs ${s.cls}`}>{s.text}</p>;
}

function SavedView({
  items,
  loading,
  onOpen,
  onDeleted,
}: {
  items: RunMeta[];
  loading: boolean;
  onOpen: (id: string) => void | Promise<void>;
  onDeleted: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [combining, setCombining] = useState(false);
  const [combined, setCombined] = useState<CombinedAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function combine() {
    setCombining(true);
    setError(null);
    setCombined(null);
    try {
      const full = await Promise.all([...selected].map((id) => getRun(id)));
      const runs = full.map((r) => ({
        author: r.post.author,
        url: r.post.url,
        summary: r.analysis.videoSummary,
        transcript: r.analysis.transcript,
        comments: r.analysis.scoredComments.map((c) => ({
          author: c.author,
          text: c.text,
          likes: c.likes,
          score: c.score,
        })),
      }));
      const res = await fetch("/api/grab-it/combine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Combine failed.");
      setCombined(data.combined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Combine failed.");
    } finally {
      setCombining(false);
    }
  }

  if (loading) {
    return <p className="py-8 text-center text-sm text-subtle">Loading…</p>;
  }
  if (items.length === 0) {
    return (
      <div className="grid-bg rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
        <p className="text-sm text-muted">
          No saved runs yet. Every run you do is saved here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Tick two or more runs to cross-reference them into one combined analysis.
      </p>

      {selected.size >= 1 && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-elevated px-3 py-2 text-xs">
          <span className="text-muted">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelected(new Set())}
              className="text-subtle hover:text-fg"
            >
              Clear
            </button>
            <button
              onClick={combine}
              disabled={selected.size < 2 || combining}
              className="rounded-md bg-accent px-3 py-1.5 font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {combining
                ? "Analyzing…"
                : `Combine & analyze (${selected.size})`}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-300">{error}</p>}

      {combined && (
        <CombinedResult combined={combined} onClose={() => setCombined(null)} />
      )}

      <div className="space-y-2">
        {items.map((r) => (
          <SavedCard
            key={r.id}
            run={r}
            selected={selected.has(r.id)}
            onToggle={() => toggle(r.id)}
            onOpen={onOpen}
            onDeleted={onDeleted}
          />
        ))}
      </div>
    </div>
  );
}

function CombinedResult({
  combined,
  onClose,
}: {
  combined: CombinedAnalysis;
  onClose: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-accent/40 bg-accent/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-fg">
          🔀 Combined analysis
        </h3>
        <button
          onClick={onClose}
          className="shrink-0 text-xs text-subtle hover:text-fg"
        >
          ✕ close
        </button>
      </div>
      <p className="text-sm leading-relaxed text-fg">{combined.overview}</p>
      <Collapsible
        title="🎯 Top ideas across your videos"
        count={combined.topIdeas.length}
        defaultOpen
      >
        <BulletList items={combined.topIdeas} />
      </Collapsible>
      <Collapsible title="Next moves" count={combined.nextMoves.length}>
        <BulletList items={combined.nextMoves} />
      </Collapsible>
      <Collapsible title="Shared themes" count={combined.sharedThemes.length}>
        <BulletList items={combined.sharedThemes} />
      </Collapsible>
      <Collapsible
        title="Audience patterns"
        count={combined.audiencePatterns.length}
      >
        <BulletList items={combined.audiencePatterns} />
      </Collapsible>
      <Collapsible title="Content gaps" count={combined.contentGaps.length}>
        <BulletList items={combined.contentGaps} />
      </Collapsible>
    </div>
  );
}

function SavedCard({
  run,
  selected,
  onToggle,
  onOpen,
  onDeleted,
}: {
  run: RunMeta;
  selected: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void | Promise<void>;
  onDeleted: () => void;
}) {
  const [opening, setOpening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const date = new Date(run.created_at).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3.5 transition-colors ${
        selected
          ? "border-accent bg-accent/5"
          : "border-border bg-panel hover:border-border-strong"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        aria-label="Select run for combining"
        className="h-4 w-4 shrink-0 accent-[var(--accent)]"
      />
      <button
        onClick={async () => {
          setOpening(true);
          try {
            await onOpen(run.id);
          } finally {
            setOpening(false);
          }
        }}
        className="min-w-0 flex-1 text-left"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-fg">@{run.author ?? "unknown"}</span>
          <span className="text-subtle">·</span>
          <span className="text-muted">{run.comments_count ?? 0} comments</span>
          {opening && <Spinner />}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">
          {run.caption?.trim() || run.url}
        </p>
        <p className="mt-0.5 text-[11px] text-subtle">{date}</p>
      </button>
      <button
        onClick={async () => {
          setDeleting(true);
          try {
            await deleteRun(run.id);
            onDeleted();
          } catch {
            setDeleting(false);
          }
        }}
        disabled={deleting}
        aria-label="Delete saved run"
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-subtle hover:bg-hover hover:text-red-300 disabled:opacity-50"
      >
        {deleting ? "…" : "Delete"}
      </button>
    </div>
  );
}

function StageBar({ stage }: { stage: Stage }) {
  const activeIndex =
    stage === "scraping" ? 0 : stage === "analyzing" ? 1 : stage === "done" ? 2 : -1;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4 sm:flex-row sm:items-center sm:gap-4">
      {stageSteps.map((s, i) => {
        const done = stage === "done" || i < activeIndex;
        const active = i === activeIndex && stage !== "done";
        return (
          <div key={s.key} className="flex items-center gap-2.5">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                done
                  ? "bg-emerald-500/20 text-emerald-400"
                  : active
                    ? "bg-accent/20 text-accent"
                    : "bg-elevated text-subtle"
              }`}
            >
              {done ? "✓" : active ? <Spinner /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className={`text-sm ${active || done ? "text-fg" : "text-subtle"}`}>
                {s.label}
              </div>
              {active && <div className="text-[11px] text-muted">{s.detail}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
  );
}

function deriveShortcode(url: string): string | undefined {
  return url.match(/\/(?:reel|reels|p|tv)\/([^/?#]+)/)?.[1];
}

function VideoPlayer({ post }: { post: ScrapedPost }) {
  const [failed, setFailed] = useState(false);

  if (post.videoUrl && !failed) {
    return (
      <video
        controls
        playsInline
        poster={post.displayUrl}
        onError={() => setFailed(true)}
        src={post.videoUrl}
        className="max-h-[460px] w-full rounded-lg bg-black object-contain"
      />
    );
  }
  // Instagram-only embed fallback (other platforms don't share this embed URL).
  const isInstagram = /instagram\.com/i.test(post.url);
  const shortcode = post.shortcode ?? deriveShortcode(post.url);
  if (isInstagram && shortcode) {
    return (
      <iframe
        title="Instagram video"
        src={`https://www.instagram.com/reel/${shortcode}/embed`}
        className="h-[460px] w-full rounded-lg border border-border bg-black"
        allowFullScreen
      />
    );
  }
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border-strong text-sm text-muted"
    >
      Open original ↗
    </a>
  );
}

const KIND_BADGE: Record<ScrapedPost["kind"], string> = {
  video: "🎥 Video",
  image: "🖼 Image post",
  text: "📝 Text post",
};

// Shows the right media for the content type: a video player, an image, or the
// text of a text post.
function MediaBlock({ post }: { post: ScrapedPost }) {
  if (post.kind === "video" || post.videoUrl) return <MediaBlock post={post} />;
  if (post.kind === "image" && post.displayUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={post.displayUrl}
        alt="post"
        className="max-h-[460px] w-full rounded-lg bg-black object-contain"
      />
    );
  }
  return (
    <div className="flex max-h-[460px] flex-col overflow-y-auto rounded-lg border border-border bg-elevated p-4">
      <span className="mb-2 text-xs text-subtle">📝 Text post</span>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
        {post.caption?.trim() || "(no text)"}
      </p>
    </div>
  );
}

function DownloadButton({ post }: { post: ScrapedPost }) {
  if (!post.videoUrl) {
    return (
      <p className="text-xs text-subtle">
        No direct video file available for this link (some platforms don&apos;t
        expose one).
      </p>
    );
  }
  const href = `/api/grab-it/download?url=${encodeURIComponent(
    post.videoUrl,
  )}&name=${encodeURIComponent(`${post.author}-video`)}`;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong"
    >
      ⬇ Download video
    </a>
  );
}

function DownloadView({ post }: { post: ScrapedPost }) {
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_1fr]">
      <MediaBlock post={post} />
      <div className="space-y-3 rounded-xl border border-border bg-panel p-5">
        <div className="text-sm">
          <span className="font-medium text-fg">@{post.author}</span>
          {post.caption && (
            <p className="mt-1 line-clamp-3 text-xs text-muted">
              {post.caption}
            </p>
          )}
        </div>
        <DownloadButton post={post} />
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-accent hover:underline"
        >
          open original ↗
        </a>
      </div>
    </div>
  );
}

function TranscriptView({
  post,
  result,
}: {
  post: ScrapedPost;
  result: TranscriptResult;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_1fr]">
        <MediaBlock post={post} />
        <div className="space-y-3 rounded-xl border border-border bg-panel p-5">
          <div className="text-sm">
            <span className="font-medium text-fg">@{post.author}</span>
          </div>
          <span className="inline-block rounded bg-elevated px-1.5 py-0.5 text-[11px] text-subtle">
            source: {result.transcriptSource}
          </span>
          <div>
            <DownloadButton post={post} />
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-panel p-5">
        <h3 className="mb-2 text-sm font-semibold text-fg">
          {post.kind === "video" ? "📄 Transcript" : "📄 Post text"}
        </h3>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
          {result.transcript?.trim() ||
            (post.kind === "video"
              ? "No transcript could be produced for this video."
              : "This post has no text.")}
        </p>
      </div>
    </div>
  );
}

type SortKey = "score" | "likes" | "replies";
const sortOptions: { key: SortKey; label: string }[] = [
  { key: "score", label: "Top scored" },
  { key: "likes", label: "Most likes" },
  { key: "replies", label: "Most replies" },
];

type DisplayComment = ScrapedComment & {
  score?: number;
  category?: string;
  reason?: string;
  replyIdea?: string;
};

function Results({
  post,
  analysis,
}: {
  post: ScrapedPost;
  analysis: Analysis | null;
}) {
  const hasAI = !!analysis;
  const [sortBy, setSortBy] = useState<SortKey>(hasAI ? "score" : "likes");
  const [minScore, setMinScore] = useState(0);
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(PAGE);
  const [focused, setFocused] = useState<DisplayComment | null>(null);

  function askAbout(c: DisplayComment) {
    setFocused(c);
    document
      .getElementById("grab-chat")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Merge AI scores onto EVERY scraped comment (thousands stay visible; only
  // the top slice gets scored, the rest show unscored and sort by likes).
  const allComments: DisplayComment[] = useMemo(() => {
    const byId = new Map(
      (analysis?.scoredComments ?? []).map((c) => [c.id, c]),
    );
    return post.comments.map((c) => {
      const s = byId.get(c.id);
      return s
        ? {
            ...c,
            score: s.score,
            category: s.category,
            reason: s.reason,
            replyIdea: s.replyIdea,
          }
        : { ...c };
    });
  }, [post.comments, analysis]);

  const categories = useMemo(
    () => [
      "all",
      ...Array.from(
        new Set(
          allComments
            .map((c) => c.category)
            .filter((x): x is string => Boolean(x)),
        ),
      ),
    ],
    [allComments],
  );

  const sorted = useMemo(() => {
    const filtered = allComments.filter(
      (c) =>
        (!hasAI || (c.score ?? 0) >= minScore) &&
        (category === "all" || c.category === category),
    );
    const key = (c: DisplayComment) =>
      sortBy === "likes"
        ? c.likes
        : sortBy === "replies"
          ? c.replyCount ?? 0
          : c.score ?? -1; // unscored sink to the bottom when sorting by score
    return [...filtered].sort((a, b) => key(b) - key(a));
  }, [allComments, sortBy, minScore, category, hasAI]);

  useEffect(() => setVisible(PAGE), [sortBy, minScore, category]);
  const shown = sorted.slice(0, visible);
  const noun = post.kind === "video" ? "video" : "post";
  const totalComments = post.commentsCount ?? post.comments.length;

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-medium text-fg">@{post.author}</span>
        <span className="rounded bg-elevated px-1.5 py-0.5">
          {KIND_BADGE[post.kind] ?? (post.videoUrl ? "🎥 Video" : "📝 Post")}
        </span>
        <span>{totalComments.toLocaleString()} comments</span>
        {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
        <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          view original ↗
        </a>
      </div>

      {/* Media + what it's about */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_1fr]">
        <MediaBlock post={post} />
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">
            What this {noun} is about
          </h3>
          <p className="text-sm leading-relaxed text-fg">
            {analysis?.videoSummary ?? post.caption ?? "No caption."}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {hasAI && (
              <span className="inline-block rounded bg-elevated px-1.5 py-0.5 text-[11px] text-subtle">
                transcript: {analysis!.transcriptSource}
              </span>
            )}
            {post.videoUrl && (
              <a
                href={`/api/grab-it/download?url=${encodeURIComponent(
                  post.videoUrl,
                )}&name=${encodeURIComponent(`${post.author}-video`)}`}
                className="text-xs text-accent hover:underline"
              >
                ⬇ download video
              </a>
            )}
          </div>
        </div>
      </div>

      {/* AI-only sections */}
      {hasAI && (
        <>
          <Collapsible title="📄 Full transcript">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
              {analysis!.transcript?.trim() ||
                "No transcript available for this video."}
            </p>
          </Collapsible>

          <Collapsible
            title="💡 Ideas & follow-ups worth making"
            count={analysis!.followUpIdeas.length}
            accent
            defaultOpen
          >
            <BulletList items={analysis!.followUpIdeas} />
          </Collapsible>
          <div className="grid gap-4 md:grid-cols-2">
            <Collapsible
              title="What people are asking"
              count={analysis!.audienceQuestions.length}
            >
              <BulletList items={analysis!.audienceQuestions} />
            </Collapsible>
            <Collapsible
              title="What's missing / wanted more"
              count={analysis!.gaps.length}
            >
              <BulletList items={analysis!.gaps} />
            </Collapsible>
          </div>
        </>
      )}

      {/* Comments explorer — ALWAYS shown, scored or not */}
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg">
            Comments <span className="text-subtle">({sorted.length})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <div className="flex overflow-hidden rounded-md border border-border">
              {sortOptions
                .filter((o) => o.key !== "score" || hasAI)
                .map((o) => (
                  <button
                    key={o.key}
                    onClick={() => setSortBy(o.key)}
                    className={`px-2.5 py-1 transition-colors ${
                      sortBy === o.key
                        ? "bg-accent text-bg"
                        : "bg-elevated text-muted hover:text-fg"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
            </div>
            {hasAI && (
              <>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded border border-border bg-elevated px-2 py-1 text-xs text-fg focus:outline-none"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "all categories" : c}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5">
                  min
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={minScore}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    className="w-20 accent-[var(--accent)]"
                  />
                  <span className="w-6 tabular-nums text-fg">{minScore}</span>
                </label>
              </>
            )}
          </div>
        </div>

        {hasAI &&
          allComments.some((c) => c.score == null) &&
          sortBy === "score" && (
            <p className="mb-3 text-[11px] text-subtle">
              Top {analysis!.scoredComments.length} most-liked comments are AI-scored;
              the rest are shown below, sorted by likes.
            </p>
          )}

        <div className="space-y-2">
          {shown.map((c) => (
            <CommentCard key={c.id} c={c} onAsk={askAbout} />
          ))}
          {sorted.length === 0 && (
            <p className="text-sm text-subtle">No comments match this filter.</p>
          )}
        </div>

        {visible < sorted.length && (
          <button
            onClick={() => setVisible((v) => v + PAGE)}
            className="mt-4 w-full rounded-lg border border-border bg-elevated py-2.5 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            Load {Math.min(PAGE, sorted.length - visible)} more
            <span className="text-subtle"> ({sorted.length - visible} left)</span>
          </button>
        )}
      </div>

      {hasAI && (
        <ChatPanel
          post={post}
          analysis={analysis!}
          focused={focused}
          onClearFocus={() => setFocused(null)}
        />
      )}

      {hasAI && analysis!.draftComments.length > 0 && (
        <details className="rounded-xl border border-border bg-panel p-5">
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            ✍️ Draft replies you could post{" "}
            <span className="font-normal text-subtle">(optional)</span>
          </summary>
          <div className="mt-3 space-y-2">
            {analysis!.draftComments.map((c, i) => (
              <CopyRow key={i} text={c} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function CommentCard({
  c,
  onAsk,
}: {
  c: DisplayComment;
  onAsk: (c: DisplayComment) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-elevated p-3.5">
      <div className="flex items-start gap-3">
        {c.score != null ? (
          <ScoreBadge score={c.score} />
        ) : (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-elevated text-xs text-subtle"
            title="not scored"
          >
            –
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="font-medium text-fg">@{c.author}</span>
            <span>· {c.likes} likes</span>
            {c.replyCount != null && c.replyCount > 0 && (
              <span>· {c.replyCount} replies</span>
            )}
            {c.category && (
              <span className="rounded bg-panel px-1.5 py-0.5">{c.category}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-fg">{c.text}</p>
          {c.reason && (
            <p className="mt-1 text-xs italic text-subtle">{c.reason}</p>
          )}
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => onAsk(c)}
              className="text-xs text-muted hover:text-accent hover:underline"
            >
              💬 ask about this
            </button>
            {c.replyIdea && (
              <button
                onClick={() => setShowReply((s) => !s)}
                className="text-xs text-muted hover:text-accent hover:underline"
              >
                {showReply ? "hide reply idea" : "✍️ reply idea"}
              </button>
            )}
          </div>
          {showReply && c.replyIdea && (
            <div className="mt-1.5 rounded-md border border-accent/20 bg-accent/5 p-2 text-xs text-fg">
              {c.replyIdea}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type ChatMsg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What are the best ideas in these comments?",
  "What are people confused about or asking for?",
  "Summarize the criticism.",
  "What should my next video be?",
];

function ChatPanel({
  post,
  analysis,
  focused,
  onClearFocus,
}: {
  post: ScrapedPost;
  analysis: Analysis;
  focused: DisplayComment | null;
  onClearFocus: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh conversation whenever a different run is loaded.
  useEffect(() => {
    setMessages([]);
    setError(null);
  }, [post.url]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function buildContext() {
    return {
      author: post.author,
      summary: analysis.videoSummary,
      transcript: analysis.transcript,
      transcriptSource: analysis.transcriptSource,
      comments: analysis.scoredComments.slice(0, 150).map((c) => ({
        author: c.author,
        text: c.text,
        likes: c.likes,
        score: c.score,
      })),
      focused: focused ? { author: focused.author, text: focused.text } : null,
    };
  }

  async function send(text?: string) {
    const q = (text ?? input).trim();
    if (!q || streaming) return;
    const next: ChatMsg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setStreaming(true);
    setError(null);
    const wasFocused = !!focused;
    try {
      const res = await fetch("/api/grab-it/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context: buildContext() }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Chat failed.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      setMessages((m) => [...m, { role: "assistant", content: "" }]);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages((m) => {
          const cp = [...m];
          cp[cp.length - 1] = { role: "assistant", content: acc };
          return cp;
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally {
      setStreaming(false);
      if (wasFocused) onClearFocus(); // the comment applied to that question
    }
  }

  return (
    <div id="grab-chat" className="rounded-xl border border-border bg-panel p-5">
      <h3 className="mb-1 text-sm font-semibold text-fg">💬 Ask Claude</h3>
      <p className="mb-3 text-xs text-muted">
        Ask anything about the video or the comments.
      </p>

      {messages.length > 0 && (
        <div
          ref={listRef}
          className="mb-3 max-h-[420px] space-y-3 overflow-y-auto pr-1"
        >
          {messages.map((m, i) => (
            <div
              key={i}
              className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-accent/15 text-fg"
                    : "border border-border bg-elevated text-fg"
                }`}
              >
                {m.content || (streaming && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions on an empty conversation */}
      {messages.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="rounded-full border border-border bg-elevated px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Focused-comment chip */}
      {focused && (
        <div className="mb-2 flex items-center gap-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-xs">
          <span className="min-w-0 flex-1 truncate text-muted">
            Asking about <span className="text-fg">@{focused.author}</span>: “
            {focused.text}”
          </span>
          <button
            onClick={onClearFocus}
            aria-label="Clear focused comment"
            className="shrink-0 text-subtle hover:text-fg"
          >
            ✕
          </button>
        </div>
      )}

      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={
            focused ? `Ask about @${focused.author}'s comment…` : "Ask a question…"
          }
          disabled={streaming}
          className="flex-1 rounded-lg border border-border bg-elevated px-3 py-2 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none disabled:opacity-60"
        />
        <button
          onClick={() => send()}
          disabled={streaming || !input.trim()}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {streaming ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-emerald-500/20 text-emerald-400"
      : score >= 40
        ? "bg-amber-500/20 text-amber-400"
        : "bg-elevated text-subtle";
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold tabular-nums ${color}`}
      title="value score"
    >
      {score}
    </span>
  );
}

function Collapsible({
  title,
  count,
  accent,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  accent?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={`group rounded-xl border p-5 ${
        accent ? "border-accent/30 bg-accent/5" : "border-border bg-panel"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-fg">
        <span>
          {title}
          {count != null && (
            <span className="ml-1.5 font-normal text-subtle">({count})</span>
          )}
        </span>
        <span className="text-subtle transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0)
    return <p className="text-sm text-subtle">Nothing surfaced here.</p>;
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm text-fg">
          <span className="text-subtle">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function CopyRow({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-elevated p-3">
      <p className="flex-1 text-sm text-fg">{text}</p>
      <button
        onClick={() => {
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="grid-bg rounded-xl border border-dashed border-border-strong px-6 py-14 text-center">
      <p className="text-sm text-muted">
        Paste an Instagram reel or post URL above and hit{" "}
        <span className="text-fg">Grab it</span>. You&apos;ll get the video, the
        best ideas from the comments, and every comment scored — top ones first.
      </p>
    </div>
  );
}
