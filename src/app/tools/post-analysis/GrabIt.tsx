"use client";

import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  Analysis,
  BuildIdea,
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
import {
  createChat,
  getChat,
  listChats,
  updateChat,
  type ChatThreadMeta,
} from "@/lib/grab-it/chats";

type Stage = "idle" | "scraping" | "analyzing" | "done" | "error";

const stageSteps = [
  { key: "scraping", label: "Grab it", detail: "Scraping video, caption & comments" },
  { key: "analyzing", label: "Understand & read the room", detail: "Transcribing + scoring every comment" },
  { key: "done", label: "Ideas & comments", detail: "Ready to explore" },
] as const;

const PAGE = 5;

type View = "new" | "current" | "saved";
type SaveState = "idle" | "saving" | "saved" | "error";
type RunMode = "full" | "transcript" | "download";

// Bumped on UI fixes; shown in the corner so stale cached JS is obvious.
const TOOL_VERSION = "v31";

// If anything inside the results throws at render time, show the error instead
// of white-screening / hanging the tab.
class ResultsBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          Display error: {this.state.error} — the run data is safe; try Saved →
          reopen, and report this message.
        </div>
      );
    }
    return this.props.children;
  }
}

// POST JSON with a hard timeout so a hung/slow API call can't freeze the UI.
async function postJson(
  url: string,
  body: unknown,
  timeoutMs = 150_000,
): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// Turn raw API errors into something actionable — especially the AI Gateway
// free-tier rate limit, which is the most common failure.
function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(msg)) {
    return "That took too long and was stopped. Any comments already fetched are shown below — hit Retry to try the analysis again.";
  }
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
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
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
  const [view, setView] = useState<View>("new");
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
    setView("new");
    setStage("scraping");
    try {
      const scrapeRes = await postJson("/api/grab-it/scrape", { url }, 240_000);
      const scrapeData = await scrapeRes.json();
      if (!scrapeRes.ok) throw new Error(scrapeData.error ?? "Scrape failed.");
      setPost(scrapeData.post);

      // Download mode: we already have the video URL, nothing more to do.
      if (mode === "download") {
        setStage("done");
        setView("current");
        return;
      }

      // Transcript-only mode: just get the words.
      if (mode === "transcript") {
        setStage("analyzing");
        const res = await postJson("/api/grab-it/transcribe", {
          post: scrapeData.post,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Transcription failed.");
        setTranscriptOnly(data);
        setStage("done");
        setView("current");
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
      setView("current");
    } catch (err) {
      setError(friendlyError(err));
      setStage("error");
    }
  }

  // Shared analyze + auto-save, reused by run() and the Retry button.
  async function analyzeAndSave(p: ScrapedPost) {
    const res = await postJson("/api/grab-it/analyze", { post: p });
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
    setMode("full");
    setPost(full.post);
    setAnalysis(full.analysis);
    setTranscriptOnly(null);
    setStage("done");
    setSaveState("saved");
    setError(null);
    setView("current");
  }

  // Switch to a fresh input to start a new search (keeps the current run
  // available under the "Current run" tab).
  function startNew() {
    setView("new");
    setUrl("");
    setError(null);
  }

  const busy = stage === "scraping" || stage === "analyzing";
  const hasCurrent = !!post; // a run has been fetched/opened

  // Restore the last run + active tab on mount so a reload keeps you in place.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem("post-analysis:last");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (s.post) {
        setMode(s.mode ?? "full");
        setPost(s.post);
        setAnalysis(s.analysis ?? null);
        setTranscriptOnly(s.transcriptOnly ?? null);
        setStage("done");
        setSaveState("saved");
      }
      if (s.view === "saved") setView("saved");
      else if (s.view === "current" && s.post) setView("current");
      else setView("new");
    } catch {
      /* ignore corrupt/oversized snapshot */
    }
  }, []);

  // Persist the current run + active tab whenever they change.
  useEffect(() => {
    if (!restored.current) return;
    try {
      const done = stage === "done";
      localStorage.setItem(
        "post-analysis:last",
        JSON.stringify({
          view,
          mode,
          post: done ? post : null,
          analysis: done ? analysis : null,
          transcriptOnly: done ? transcriptOnly : null,
        }),
      );
    } catch {
      /* snapshot too big for localStorage — skip */
    }
  }, [view, mode, stage, post, analysis, transcriptOnly]);

  return (
    <div className="space-y-6">
      {/* Tabs: New · Current run (name) · Saved */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        <TabButton active={view === "new"} onClick={startNew}>
          New
        </TabButton>
        {hasCurrent && (
          <TabButton
            active={view === "current"}
            onClick={() => setView("current")}
          >
            Current run
            {post?.author ? ` · @${post.author}` : ""}
          </TabButton>
        )}
        <TabButton
          active={view === "saved"}
          onClick={() => {
            setView("saved");
            refreshSaved();
          }}
        >
          Saved{saved.length > 0 ? ` (${saved.length})` : ""}
        </TabButton>
        <span className="ml-auto pb-1 text-[10px] text-subtle" title="tool version">
          {TOOL_VERSION}
        </span>
      </div>

      {view === "saved" ? (
        <SavedView
          items={saved}
          loading={savedLoading}
          onOpen={openSaved}
          onDeleted={refreshSaved}
        />
      ) : view === "current" && post ? (
        /* ── Current run output — no input, just the analysis ── */
        <>
          {error && <ErrorBanner message={error} onRetry={retryAnalysis} />}

          {mode === "full" && (
            <ResultsBoundary>
              <Results post={post} analysis={analysis} saveState={saveState} />
            </ResultsBoundary>
          )}
          {mode === "transcript" && transcriptOnly && (
            <ResultsBoundary>
              <TranscriptView post={post} result={transcriptOnly} />
            </ResultsBoundary>
          )}
          {mode === "download" && (
            <ResultsBoundary>
              <DownloadView post={post} />
            </ResultsBoundary>
          )}
        </>
      ) : (
        /* ── New: the input to start a search ── */
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

          {mode === "full" && busy && <StageBar stage={stage} />}
          {mode !== "full" && busy && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-panel p-4 text-sm text-muted">
              <Spinner />
              {stage === "scraping" ? "Fetching the video…" : "Transcribing…"}
            </div>
          )}

          {error && !busy && (
            <ErrorBanner message={error} onRetry={retryAnalysis} />
          )}

          {stage === "idle" && <EmptyHint />}
        </>
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
      className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
        active
          ? "border-accent text-fg"
          : "border-transparent text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
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
      const runs = full.map((r) => {
        // Scored runs carry scores; relevance-mode runs don't — fall back to the
        // most-liked scraped comments so combine still has material to work with.
        const relevant = new Set(r.analysis.relevantCommentIds ?? []);
        const comments = r.analysis.scoredComments.length
          ? r.analysis.scoredComments.map((c) => ({
              author: c.author,
              text: c.text,
              likes: c.likes,
              score: c.score,
            }))
          : [...r.post.comments]
              .sort(
                (a, b) =>
                  (relevant.has(b.id) ? 1 : 0) - (relevant.has(a.id) ? 1 : 0) ||
                  b.likes - a.likes,
              )
              .slice(0, 80)
              .map((c) => ({
                author: c.author,
                text: c.text,
                likes: c.likes,
                score: relevant.has(c.id) ? 80 : 0,
              }));
        return {
          author: r.post.author,
          url: r.post.url,
          summary: r.analysis.videoSummary,
          transcript: r.analysis.transcript,
          comments,
        };
      });
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

      {error && <p className="text-xs text-red-600">{error}</p>}

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
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-subtle hover:bg-hover hover:text-red-600 disabled:opacity-50"
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
                  ? "bg-emerald-500/20 text-emerald-700"
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

// Click-to-play, and playback streams through OUR server proxy (same-origin),
// because Instagram's CDN blocks direct hotlinked <video src> playback and its
// embed iframe can hang the whole tab (Chrome RESULT_CODE_HUNG). No iframe,
// nothing heavy mounts until the user clicks Play.
function VideoPlayer({ post }: { post: ScrapedPost }) {
  const [playing, setPlaying] = useState(false);
  const [playError, setPlayError] = useState(false);

  const proxied = post.videoUrl
    ? `/api/grab-it/download?url=${encodeURIComponent(post.videoUrl)}&inline=1`
    : null;

  if (playing && proxied && !playError) {
    return (
      // No forced aspect: width-driven with auto height renders the video at
      // its native format (a 9:16 reel stays 9:16).
      <video
        controls
        autoPlay
        playsInline
        src={proxied}
        onError={() => setPlayError(true)}
        className="block max-h-[80vh] w-full rounded-lg bg-black"
      />
    );
  }

  return (
    <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 rounded-lg border border-border bg-black/40 p-6 text-center">
      {proxied && !playError && (
        <button
          onClick={() => setPlaying(true)}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-xl text-bg transition-colors hover:bg-accent-strong"
          aria-label="Play video"
        >
          ▶
        </button>
      )}
      {playError && (
        <p className="text-xs text-wip">
          Playback failed — the source may have expired. Try the original link
          below.
        </p>
      )}
    </div>
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
  if (post.kind === "video" || post.videoUrl) return <VideoPlayer post={post} />;
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
      <div className="space-y-3 rounded-2xl border border-border bg-panel p-5 shadow-card">
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
        <div className="space-y-3 rounded-2xl border border-border bg-panel p-5 shadow-card">
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
      <div className="rounded-2xl border border-border bg-panel p-5 shadow-card">
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

type SortKey = "relevant" | "score" | "likes" | "replies";
const sortOptions: { key: SortKey; label: string }[] = [
  { key: "relevant", label: "Most relevant" },
  { key: "score", label: "Top scored" },
  { key: "likes", label: "Most likes" },
  { key: "replies", label: "Most replies" },
];

type DisplayComment = ScrapedComment & {
  score?: number;
  category?: string;
  reason?: string;
  replyIdea?: string;
  relevant?: boolean; // AI flagged it as relevant to the video
  relevanceRank?: number; // order in the relevance shortlist (lower = better)
};

function Results({
  post,
  analysis,
  saveState,
}: {
  post: ScrapedPost;
  analysis: Analysis | null;
  saveState?: SaveState;
}) {
  const hasAI = !!analysis;
  const mode = analysis?.scoringMode; // "scored" | "relevant" | undefined
  const [sortBy, setSortBy] = useState<SortKey>(
    mode === "relevant" ? "relevant" : hasAI ? "score" : "likes",
  );
  const [minScore, setMinScore] = useState(0);
  const [category, setCategory] = useState("all");
  const [relevantOnly, setRelevantOnly] = useState(mode === "relevant");
  const [visible, setVisible] = useState(PAGE);
  const [focused, setFocused] = useState<DisplayComment | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatUseClaude, setChatUseClaude] = useState(false);

  // Remember whether Ask Chat was left open across reloads.
  useEffect(() => {
    try {
      if (localStorage.getItem("pa:card:ask-chat") === "1") setChatOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  function askAbout(c: DisplayComment, opts?: { claude?: boolean }) {
    setFocused(c);
    setChatOpen(true); // make sure the (collapsed) chat opens
    if (opts?.claude) setChatUseClaude(true); // brainstorm a Claude idea in Claude
    setTimeout(
      () =>
        document
          .getElementById("grab-chat")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      50,
    );
  }

  // Merge AI output onto EVERY scraped comment: scores (scored mode) or the
  // relevance shortlist (relevant mode). All comments stay visible.
  const allComments: DisplayComment[] = useMemo(() => {
    const byId = new Map(
      (analysis?.scoredComments ?? []).map((c) => [c.id, c]),
    );
    const relRank = new Map(
      (analysis?.relevantCommentIds ?? []).map((id, i) => [id, i]),
    );
    return post.comments.map((c) => {
      const s = byId.get(c.id);
      const rank = relRank.get(c.id);
      return {
        ...c,
        ...(s
          ? {
              score: s.score,
              category: s.category,
              reason: s.reason,
              replyIdea: s.replyIdea,
            }
          : {}),
        relevant: rank !== undefined || (s ? s.score >= 60 : false),
        relevanceRank: rank,
      };
    });
  }, [post.comments, analysis]);

  const hasRelevant = allComments.some((c) => c.relevant);

  // Fast id → raw comment lookup, for build-idea sources & the playbook list.
  const commentById = useMemo(
    () => new Map(post.comments.map((c) => [c.id, c] as const)),
    [post.comments],
  );
  const buildIdeas = analysis?.buildIdeas ?? [];
  const playbookComments = (analysis?.playbookCommentIds ?? [])
    .map((id) => commentById.get(id))
    .filter((c): c is ScrapedComment => !!c);

  // "Generate more ideas" — research-backed, going broader each round.
  const [extraIdeas, setExtraIdeas] = useState<BuildIdea[]>([]);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [moreNote, setMoreNote] = useState<string | null>(null);
  const [useClaude, setUseClaude] = useState(false);
  const moreRound = useRef(0);
  const allBuildIdeas = [...buildIdeas, ...extraIdeas];
  const ideasKey = `pa:extra-ideas:${post.url}`;

  // Restore any previously-generated extra ideas for this post on reload.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ideasKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.ideas) && s.ideas.length) {
          setExtraIdeas(s.ideas);
          moreRound.current = s.round ?? s.ideas.length;
        }
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.url]);

  async function generateMore() {
    if (moreLoading) return;
    setMoreLoading(true);
    setMoreError(null);
    setMoreNote(null);
    try {
      const res = await fetch("/api/grab-it/more-ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            author: post.author,
            summary: analysis?.videoSummary,
            transcript: analysis?.transcript,
            comments: (analysis?.scoredComments ?? [])
              .slice(0, 40)
              .map((c) => `@${c.author}: ${c.text}`),
          },
          existing: allBuildIdeas.map((b) => b.title),
          round: moreRound.current,
          useClaude,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate.");
      if (data.fellBack) {
        setMoreNote(
          "Claude isn't active yet — add AI Gateway credits to use it. Generated with the free model instead.",
        );
      }
      const label = data.usedClaude ? "Claude" : "Gemini Flash";
      const mapped: BuildIdea[] = (data.ideas ?? []).map(
        (b: Omit<BuildIdea, "sourceCommentIds">) => ({
          title: b.title,
          whatItIs: b.whatItIs,
          howToBuild: b.howToBuild ?? [],
          insight: b.insight,
          sourceCommentIds: [],
          model: label,
        }),
      );
      moreRound.current += 1;
      setExtraIdeas((prev) => {
        const next = [...prev, ...mapped];
        try {
          localStorage.setItem(
            ideasKey,
            JSON.stringify({ ideas: next, round: moreRound.current }),
          );
        } catch {
          /* snapshot too big — skip */
        }
        return next;
      });
    } catch (e) {
      setMoreError(e instanceof Error ? e.message : "Failed to generate.");
    } finally {
      setMoreLoading(false);
    }
  }

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
        (category === "all" || c.category === category) &&
        (!relevantOnly || c.relevant),
    );
    const key = (c: DisplayComment) =>
      sortBy === "likes"
        ? c.likes
        : sortBy === "replies"
          ? c.replyCount ?? 0
          : sortBy === "relevant"
            ? c.relevanceRank !== undefined
              ? 1_000_000 - c.relevanceRank // shortlist first, in order
              : c.relevant
                ? 500_000 + (c.score ?? 0)
                : c.score ?? c.likes ?? 0
            : c.score ?? -1; // "score": unscored sink to the bottom
    return [...filtered].sort((a, b) => key(b) - key(a));
  }, [allComments, sortBy, minScore, category, relevantOnly, hasAI]);

  useEffect(
    () => setVisible(PAGE),
    [sortBy, minScore, category, relevantOnly],
  );
  const shown = sorted.slice(0, visible);
  const noun = post.kind === "video" ? "video" : "post";
  const totalComments = post.commentsCount ?? post.comments.length;

  return (
    <div className="space-y-6">
      {/* Centered post header — video, with meta beneath it */}
      <div className="flex flex-col items-center text-center">
        {saveState === "saved" && (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-live/30 bg-live/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-live">
            ✓ Saved
          </div>
        )}

        <div className="w-full max-w-[300px]">
          <MediaBlock post={post} />
        </div>

        <h2 className="mt-5 font-display text-2xl tracking-tight text-fg">
          @{post.author}
        </h2>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs">
          <span className="rounded-full border border-border bg-elevated px-3 py-1 text-muted">
            {KIND_BADGE[post.kind] ?? (post.videoUrl ? "🎥 Video" : "📝 Post")}
          </span>
          <span className="rounded-full border border-border bg-elevated px-3 py-1 text-muted">
            {totalComments.toLocaleString()} comments
          </span>
          {post.likes != null && (
            <span className="rounded-full border border-border bg-elevated px-3 py-1 text-muted">
              {post.likes.toLocaleString()} likes
            </span>
          )}
          {post.commentSource === "login" && (
            <span className="rounded-full border border-live/30 bg-live/10 px-3 py-1 text-live">
              ✓ Comments via login
            </span>
          )}
          {post.commentSource === "logged-out" && (
            <span className="rounded-full border border-wip/30 bg-wip/10 px-3 py-1 text-wip">
              ⚠ Logged-out (limited)
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 font-mono text-[11px] uppercase tracking-wider text-subtle">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-accent"
          >
            view original ↗
          </a>
          {post.videoUrl && (
            <a
              href={`/api/grab-it/download?url=${encodeURIComponent(
                post.videoUrl,
              )}&name=${encodeURIComponent(`${post.author}-video`)}`}
              className="transition-colors hover:text-accent"
            >
              ⬇ download video
            </a>
          )}
        </div>
      </div>

      {/* 1) Full transcript */}
      {hasAI && (
        <Collapsible title="📄 Full transcript" storageId="transcript">
          <div className="mb-3 flex justify-end">
            <CopyButton text={analysis!.transcript?.trim() || ""} />
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
            {analysis!.transcript?.trim() ||
              "No transcript available for this video."}
          </p>
        </Collapsible>
      )}

      {/* Comments explorer — collapsed dropdown */}
      <Collapsible
        storageId="comments"
        title={`💬 Comments (${post.comments.length.toLocaleString()}${
          totalComments > post.comments.length
            ? ` of ${totalComments.toLocaleString()}`
            : ""
        })`}
      >
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
            {hasRelevant && (
              <button
                onClick={() => setRelevantOnly((v) => !v)}
                className={`rounded-md border px-2.5 py-1 transition-colors ${
                  relevantOnly
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-border bg-elevated text-muted hover:text-fg"
                }`}
              >
                ⭐ Relevant only
              </button>
            )}
            <div className="flex overflow-hidden rounded-md border border-border">
              {sortOptions
                .filter(
                  (o) =>
                    (o.key !== "score" || mode === "scored") &&
                    (o.key !== "relevant" || hasRelevant),
                )
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
            {mode === "scored" && (
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

        {totalComments > post.comments.length + 5 && (
          <p className="mb-3 text-[11px] text-amber-700/80">
            Instagram only exposed {post.comments.length.toLocaleString()} of ~
            {totalComments.toLocaleString()} comments to the scraper for this post
            (it varies per post — some allow thousands, some only a handful). All
            scraped comments are shown here.
          </p>
        )}

        {mode === "relevant" && (
          <p className="mb-3 text-[11px] text-subtle">
            Too many comments to score each one, so the AI flagged the{" "}
            {analysis!.relevantCommentIds.length} most relevant to the {noun}{" "}
            (⭐). Toggle “Relevant only” to focus on those; all comments remain
            below.
          </p>
        )}

        {mode === "scored" &&
          allComments.some((c) => c.score == null) &&
          sortBy === "score" && (
            <p className="mb-3 text-[11px] text-subtle">
              The {analysis!.scoredComments.length} most-liked comments are
              AI-scored; the rest are shown below (sorted by likes).
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
      </Collapsible>

      {/* 3) Build ideas — the hero: what to create from this + its comments */}
      {hasAI && allBuildIdeas.length > 0 && (
        <Collapsible
          title="🚀 Build ideas — what to create & how"
          count={allBuildIdeas.length}
          accent
          storageId="build-ideas"
        >
          <div className="space-y-3">
            {allBuildIdeas.map((idea, i) => (
              <BuildIdeaCard
                key={i}
                idea={idea}
                commentById={commentById}
                onAsk={askAbout}
              />
            ))}
          </div>

          {moreError && <p className="mt-3 text-xs text-wip">{moreError}</p>}
          {moreNote && <p className="mt-3 text-xs text-wip">{moreNote}</p>}

          <div className="mt-4 flex flex-col items-center gap-2.5">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={generateMore}
                disabled={moreLoading}
                className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {moreLoading ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                    Researching more ideas…
                  </>
                ) : (
                  <>↻ Generate more ideas</>
                )}
              </button>
              <button
                onClick={() => setUseClaude((v) => !v)}
                disabled={moreLoading}
                title="Use Claude (best quality) for this run — needs AI Gateway credits"
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                  useClaude
                    ? "border-accent bg-accent text-bg"
                    : "border-border bg-elevated text-muted hover:border-accent hover:text-fg"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${useClaude ? "bg-bg" : "bg-subtle"}`}
                />
                Use Claude
              </button>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-subtle">
              Web-researched · goes broader each time
              {useClaude ? " · Claude (paid)" : " · free model"}
            </span>
          </div>
        </Collapsible>
      )}

      {/* 4) Gold nuggets: commenters sharing how they actually did it */}
      {hasAI && playbookComments.length > 0 && (
        <Collapsible
          title="🛠 How they did it — playbooks from the comments"
          count={playbookComments.length}
          accent
          storageId="playbook"
        >
          <p className="mb-3 text-xs text-muted">
            Comments where someone shared first-hand experience, tactics, or
            exactly how they pulled it off — the real gold to learn from.
          </p>
          <div className="space-y-2">
            {playbookComments.map((c) => (
              <button
                key={c.id}
                onClick={() => askAbout(c)}
                className="block w-full rounded-xl border border-border bg-elevated px-3.5 py-2.5 text-left transition-colors hover:border-accent"
              >
                <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-fg">@{c.author}</span>
                  <span>{c.likes.toLocaleString()} likes</span>
                  <span className="ml-auto text-accent">ask about this →</span>
                </div>
                <p className="whitespace-pre-wrap text-sm text-fg">{c.text}</p>
              </button>
            ))}
          </div>
        </Collapsible>
      )}

      {hasAI && (
        <details
          id="grab-chat"
          open={chatOpen}
          onToggle={(e) => {
            const o = e.currentTarget.open;
            setChatOpen(o);
            try {
              localStorage.setItem("pa:card:ask-chat", o ? "1" : "0");
            } catch {
              /* ignore */
            }
          }}
          className="group overflow-hidden rounded-xl border border-border bg-panel transition-colors open:border-border-strong"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-sm font-semibold tracking-tight text-fg">
            <span>Ask Chat</span>
            <span className="text-subtle transition-transform group-open:rotate-180">
              ⌄
            </span>
          </summary>
          <div className="border-t border-border px-5 pb-5 pt-4">
            <ChatPanel
              post={post}
              analysis={analysis!}
              focused={focused}
              onClearFocus={() => setFocused(null)}
              quickQuestions={analysis!.audienceQuestions}
              useClaude={chatUseClaude}
              onUseClaudeChange={setChatUseClaude}
            />
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
        ) : c.relevant ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-sm text-accent"
            title="relevant to the video"
          >
            ⭐
          </span>
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
  "What business could I build from this?",
  "Turn the best comment insight into a plan",
  "How did the top commenters actually do it?",
  "Give me a step-by-step to start one idea",
  "What's the fastest way to test this?",
];

function ChatPanel({
  post,
  analysis,
  focused,
  onClearFocus,
  quickQuestions,
  useClaude,
  onUseClaudeChange,
}: {
  post: ScrapedPost;
  analysis: Analysis;
  focused: DisplayComment | null;
  onClearFocus: () => void;
  quickQuestions?: string[];
  useClaude?: boolean;
  onUseClaudeChange?: (v: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThreadMeta[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const refreshThreads = useCallback(async () => {
    try {
      setThreads(await listChats(post.url));
    } catch {
      /* table unreachable — ignore */
    }
  }, [post.url]);

  // On opening a run, load its most recent chat thread (continue where you left
  // off). Start a fresh one with "New chat".
  useEffect(() => {
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const t = await listChats(post.url);
        if (cancelled) return;
        setThreads(t);
        if (t.length) {
          const full = await getChat(t[0].id);
          if (cancelled) return;
          setMessages(full.messages ?? []);
          threadIdRef.current = t[0].id;
          setThreadId(t[0].id);
        } else {
          setMessages([]);
          threadIdRef.current = null;
          setThreadId(null);
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [post.url]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Stop the reveal loop on unmount.
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  // Persist the thread after each completed exchange.
  async function persist(msgs: ChatMsg[]) {
    try {
      if (threadIdRef.current) {
        await updateChat(threadIdRef.current, msgs);
        refreshThreads();
      } else {
        const id = await createChat(post.url, msgs);
        threadIdRef.current = id;
        setThreadId(id);
        refreshThreads();
      }
    } catch {
      /* save failed — chat still works in-session */
    }
  }

  function stopReveal() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function newChat() {
    stopReveal();
    setMessages([]);
    setInput("");
    setError(null);
    threadIdRef.current = null;
    setThreadId(null);
  }

  async function openThread(id: string) {
    if (id === threadIdRef.current) return;
    stopReveal();
    try {
      const full = await getChat(id);
      setMessages(full.messages ?? []);
      threadIdRef.current = id;
      setThreadId(id);
    } catch {
      setError("Couldn't load that chat.");
    }
  }

  function buildContext() {
    return {
      author: post.author,
      summary: analysis.videoSummary,
      transcript: analysis.transcript,
      transcriptSource: analysis.transcriptSource,
      ideas: (analysis.buildIdeas ?? []).map(
        (b) => `${b.title} — ${b.whatItIs}`,
      ),
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
    stopReveal();
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
        body: JSON.stringify({
          messages: next,
          context: buildContext(),
          useClaude: !!useClaude,
        }),
      });
      if (!res.ok || !res.body) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Chat failed.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      setMessages((m) => [...m, { role: "assistant", content: "" }]);

      // Reveal the answer word-by-word. The network delivers bursty chunks; we
      // buffer them into `full` and paint one word at a time on a steady tick
      // (catching up when a big backlog builds) so it reads like ChatGPT.
      let full = ""; // text received from the network so far
      let shown = 0; // chars painted on screen
      let streamDone = false;
      let last = 0; // timestamp of the last word revealed
      const setLast = (content: string) =>
        setMessages((m) => {
          const cp = [...m];
          cp[cp.length - 1] = { role: "assistant", content };
          return cp;
        });
      // While still streaming, hold back the trailing (possibly incomplete)
      // word until whitespace confirms it's done — avoids half-words flashing.
      const safeEnd = () => {
        if (streamDone) return full.length;
        let i = full.length;
        while (i > 0 && !/\s/.test(full[i - 1])) i--;
        return i;
      };
      const reveal = (ts: number) => {
        const end = safeEnd();
        if (shown < end && ts - last >= 55) {
          last = ts;
          const words = full.slice(shown, end).trim().split(/\s+/).length;
          let step = Math.max(1, Math.ceil(words / 8)); // catch up on backlog
          let idx = shown;
          while (step > 0 && idx < end) {
            while (idx < end && /\s/.test(full[idx])) idx++; // skip spaces
            while (idx < end && !/\s/.test(full[idx])) idx++; // consume a word
            step--;
          }
          shown = idx;
          setLast(full.slice(0, shown));
        }
        // Run only while there's a completed word waiting; otherwise pause and
        // let the next chunk (or stream end) restart us — no idle CPU spin.
        rafRef.current =
          shown < safeEnd() ? requestAnimationFrame(reveal) : null;
      };
      const ensureReveal = () => {
        if (rafRef.current == null) rafRef.current = requestAnimationFrame(reveal);
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        full += dec.decode(value, { stream: true });
        ensureReveal();
      }
      full += dec.decode();
      streamDone = true;
      ensureReveal(); // flush the final word(s)
      // Auto-save the thread once the answer is complete.
      await persist([...next, { role: "assistant", content: full }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chat failed.");
    } finally {
      setStreaming(false);
      if (wasFocused) onClearFocus(); // the comment applied to that question
    }
  }

  return (
    <div className="flex flex-col">
      {/* Compact toolbar: new chat + thread switcher */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={newChat}
            className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-panel px-3 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-fg"
          >
            <span className="text-sm leading-none">＋</span> New chat
          </button>
          {threads.length > 0 && (
            <div className="relative min-w-0">
              <select
                value={threadId ?? ""}
                onChange={(e) => {
                  if (e.target.value) openThread(e.target.value);
                  else newChat();
                }}
                className="max-w-[220px] cursor-pointer appearance-none truncate rounded-full border border-border bg-panel py-1 pl-3 pr-7 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-fg focus:border-accent focus:text-fg focus:outline-none"
              >
                <option value="">Current chat</option>
                {threads.map((t) => {
                  const label = t.title?.trim() || "Untitled chat";
                  const short =
                    label.length > 30
                      ? `${label.slice(0, 29).trimEnd()}…`
                      : label;
                  return (
                    <option key={t.id} value={t.id} title={label}>
                      {short}
                    </option>
                  );
                })}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-subtle">
                ⌄
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onUseClaudeChange && (
            <button
              onClick={() => onUseClaudeChange(!useClaude)}
              title="Chat with Claude Sonnet 5 (best quality) — needs AI Gateway credits; loses web search"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                useClaude
                  ? "border-accent bg-accent text-bg"
                  : "border-border bg-panel text-muted hover:border-accent hover:text-fg"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${useClaude ? "bg-bg" : "bg-subtle"}`}
              />
              Claude
            </button>
          )}
          {threads.length > 0 && (
            <span className="text-[11px] text-subtle">
              {threads.length} saved
            </span>
          )}
        </div>
      </div>

      {/* Conversation card — clean, ChatGPT-style */}
      <div
        ref={listRef}
        className="min-h-[240px] max-h-[52vh] space-y-6 overflow-y-auto rounded-2xl border border-border bg-bg p-4"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/12 text-lg text-accent">
              ✦
            </span>
            <p className="max-w-xs text-sm text-muted">
              Ask anything about this post — the video, a comment, or how to
              build on an idea. It can search the web too.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {/* Audience questions ("what people are asking") surface here as
                  quick questions, ahead of the generic suggestions. */}
              {[
                ...new Set([...(quickQuestions ?? []), ...SUGGESTIONS]),
              ]
                .slice(0, 6)
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-border bg-panel px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/12 px-4 py-2.5 text-sm leading-relaxed text-fg">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-xs text-accent">
                  ✦
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  {m.content ? (
                    <>
                      <div className="chat-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {m.content}
                        </ReactMarkdown>
                      </div>
                      {/* Keeps a live "still generating" cue under the text for
                          the whole response, not just before the first word. */}
                      {streaming && i === messages.length - 1 && (
                        <span className="mt-2 inline-flex gap-1 align-middle">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-accent" />
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-2.5 text-sm font-semibold text-accent">
                      <span className="inline-flex gap-1.5">
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                        <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-accent" />
                      </span>
                      <span className="animate-pulse">Thinking…</span>
                    </span>
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>

      {/* Focused-comment chip */}
      {focused && (
        <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-3 py-1.5 text-xs">
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

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {/* Input pill */}
      <div className="mt-2.5 flex items-center gap-2 rounded-2xl border border-border bg-panel px-2.5 py-1.5 shadow-sm focus-within:border-accent">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={
            focused ? `Ask about @${focused.author}'s comment…` : "Ask anything…"
          }
          disabled={streaming}
          className="flex-1 bg-transparent px-2 py-1.5 text-sm text-fg placeholder:text-subtle focus:outline-none disabled:opacity-60"
        />
        <button
          onClick={() => send()}
          disabled={streaming || !input.trim()}
          aria-label="Send"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {streaming ? (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-bg border-t-transparent" />
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-emerald-500/20 text-emerald-700"
      : score >= 40
        ? "bg-amber-500/20 text-amber-700"
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
  storageId,
  children,
}: {
  title: string;
  count?: number;
  accent?: boolean;
  defaultOpen?: boolean;
  storageId?: string; // when set, remembers open/closed across reloads
  children: React.ReactNode;
}) {
  // Drop a leading emoji so section titles read clean and editorial.
  const clean = title.replace(
    /^\s*\p{Extended_Pictographic}(?:‍\p{Extended_Pictographic})*️?\s*/u,
    "",
  );
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => {
    if (!storageId) return;
    try {
      const v = localStorage.getItem(`pa:card:${storageId}`);
      if (v !== null) setOpen(v === "1");
    } catch {
      /* ignore */
    }
  }, [storageId]);
  return (
    <details
      open={open}
      onToggle={(e) => {
        const o = e.currentTarget.open;
        setOpen(o);
        if (storageId) {
          try {
            localStorage.setItem(`pa:card:${storageId}`, o ? "1" : "0");
          } catch {
            /* ignore */
          }
        }
      }}
      className="group overflow-hidden rounded-xl border border-border bg-panel transition-colors open:border-border-strong"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
        <span className="flex items-center gap-2.5 text-sm font-semibold tracking-tight text-fg">
          {accent && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          )}
          {clean}
          {count != null && (
            <span className="font-mono text-xs font-normal text-subtle">
              {count}
            </span>
          )}
        </span>
        <span className="text-subtle transition-transform group-open:rotate-180">
          ⌄
        </span>
      </summary>
      <div className="border-t border-border px-5 pb-5 pt-4">{children}</div>
    </details>
  );
}

function BuildIdeaCard({
  idea,
  commentById,
  onAsk,
}: {
  idea: BuildIdea;
  commentById: Map<string, ScrapedComment>;
  onAsk: (c: DisplayComment) => void;
}) {
  const sources = idea.sourceCommentIds
    .map((id) => commentById.get(id))
    .filter((c): c is ScrapedComment => !!c);
  const modelLabel = idea.model ?? "Gemini Flash";
  const isClaude = /claude/i.test(modelLabel);
  return (
    <div className="rounded-xl border border-border bg-elevated p-4">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold text-fg">{idea.title}</h4>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            isClaude
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border bg-panel text-subtle"
          }`}
          title={`Generated by ${modelLabel}`}
        >
          {modelLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{idea.whatItIs}</p>

      {idea.howToBuild.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
            How to start
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-fg">
            {idea.howToBuild.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      {idea.insight && (
        <p className="mt-3 rounded-lg bg-elevated px-3 py-2 text-xs text-muted">
          <span className="font-medium text-fg">Why: </span>
          {idea.insight}
        </p>
      )}

      {sources.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">
            Sparked by
          </p>
          {sources.map((c) => (
            <button
              key={c.id}
              onClick={() => onAsk(c)}
              className="block w-full rounded-lg border border-border bg-bg px-3 py-1.5 text-left text-xs text-muted transition-colors hover:border-accent"
            >
              <span className="font-medium text-fg">@{c.author}</span>:{" "}
              {c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex justify-end">
        <button
          onClick={() =>
            onAsk({
              id: `idea-${idea.title}`,
              author: "build idea",
              text: `Help me build this: "${idea.title}" — ${idea.whatItIs}`,
              likes: 0,
            })
          }
          className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20"
        >
          Brainstorm this in chat →
        </button>
      </div>
    </div>
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-fg"
    >
      {copied ? "Copied ✓" : "⧉ Copy"}
    </button>
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
