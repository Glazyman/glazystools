"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Analysis, ScoredComment, ScrapedPost } from "@/lib/grab-it/types";
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

export function GrabIt() {
  const [view, setView] = useState<View>("run");
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<ScrapedPost | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
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

      setStage("analyzing");
      const analyzeRes = await fetch("/api/grab-it/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ post: scrapeData.post }),
      });
      const analyzeData = await analyzeRes.json();
      if (!analyzeRes.ok)
        throw new Error(analyzeData.error ?? "Analysis failed.");
      setAnalysis(analyzeData.analysis);
      setStage("done");

      // Auto-save every completed run.
      setSaveState("saving");
      try {
        await saveRun(scrapeData.post, analyzeData.analysis);
        setSaveState("saved");
        refreshSaved();
      } catch {
        setSaveState("error");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage("error");
    }
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && url && !busy && run()}
              placeholder="https://www.instagram.com/reel/…"
              className="flex-1 rounded-lg border border-border bg-elevated px-3.5 py-2.5 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none"
            />
            <button
              onClick={run}
              disabled={!url || busy}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : "Grab it"}
            </button>
          </div>

          {stage !== "idle" && <StageBar stage={stage} />}

          {stage === "done" && <SaveIndicator state={saveState} />}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {analysis && post && <Results post={post} analysis={analysis} />}

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
    <div className="space-y-2">
      {items.map((r) => (
        <SavedCard key={r.id} run={r} onOpen={onOpen} onDeleted={onDeleted} />
      ))}
    </div>
  );
}

function SavedCard({
  run,
  onOpen,
  onDeleted,
}: {
  run: RunMeta;
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
    <div className="flex items-center gap-3 rounded-lg border border-border bg-panel p-3.5 transition-colors hover:border-border-strong">
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
  const shortcode = post.shortcode ?? deriveShortcode(post.url);

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
  if (shortcode) {
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
      Open on Instagram ↗
    </a>
  );
}

type SortKey = "score" | "likes" | "replies";
const sortOptions: { key: SortKey; label: string }[] = [
  { key: "score", label: "Top scored" },
  { key: "likes", label: "Most likes" },
  { key: "replies", label: "Most replies" },
];

function Results({ post, analysis }: { post: ScrapedPost; analysis: Analysis }) {
  const [sortBy, setSortBy] = useState<SortKey>("score");
  const [minScore, setMinScore] = useState(0);
  const [category, setCategory] = useState("all");
  const [visible, setVisible] = useState(PAGE);
  const [focused, setFocused] = useState<ScoredComment | null>(null);

  function askAbout(c: ScoredComment) {
    setFocused(c);
    document
      .getElementById("grab-chat")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(analysis.scoredComments.map((c) => c.category)))],
    [analysis.scoredComments],
  );

  const sorted = useMemo(() => {
    const filtered = analysis.scoredComments.filter(
      (c) => c.score >= minScore && (category === "all" || c.category === category),
    );
    const key = (c: ScoredComment) =>
      sortBy === "likes" ? c.likes : sortBy === "replies" ? c.replyCount ?? 0 : c.score;
    return [...filtered].sort((a, b) => key(b) - key(a));
  }, [analysis.scoredComments, sortBy, minScore, category]);

  // Reset pagination whenever the sort/filter changes.
  useEffect(() => setVisible(PAGE), [sortBy, minScore, category]);

  const shown = sorted.slice(0, visible);

  return (
    <div className="space-y-6">
      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="font-medium text-fg">@{post.author}</span>
        <span>{post.commentsCount ?? post.comments.length} comments</span>
        {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
        <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
          view on Instagram ↗
        </a>
      </div>

      {/* Video + what it's about */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,300px)_1fr]">
        <VideoPlayer post={post} />
        <div className="rounded-xl border border-border bg-panel p-5">
          <h3 className="mb-2 text-sm font-semibold text-fg">What the video is about</h3>
          <p className="text-sm leading-relaxed text-fg">{analysis.videoSummary}</p>
          <span className="mt-3 inline-block rounded bg-elevated px-1.5 py-0.5 text-[11px] text-subtle">
            transcript: {analysis.transcriptSource}
          </span>
        </div>
      </div>

      {/* Full transcript — collapsed by default */}
      <Collapsible title="📄 Full transcript">
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">
          {analysis.transcript?.trim() || "No transcript available for this video."}
        </p>
      </Collapsible>

      {/* Ideas — the main payoff, open by default */}
      <Collapsible
        title="💡 Ideas & follow-ups worth making"
        count={analysis.followUpIdeas.length}
        accent
        defaultOpen
      >
        <BulletList items={analysis.followUpIdeas} />
      </Collapsible>
      <div className="grid gap-4 md:grid-cols-2">
        <Collapsible
          title="What people are asking"
          count={analysis.audienceQuestions.length}
        >
          <BulletList items={analysis.audienceQuestions} />
        </Collapsible>
        <Collapsible
          title="What's missing / wanted more"
          count={analysis.gaps.length}
        >
          <BulletList items={analysis.gaps} />
        </Collapsible>
      </div>

      {/* Comments explorer */}
      <div className="rounded-xl border border-border bg-panel p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-fg">
            Comments{" "}
            <span className="text-subtle">({sorted.length})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <div className="flex overflow-hidden rounded-md border border-border">
              {sortOptions.map((o) => (
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
          </div>
        </div>

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

      {/* Ask Claude about the video or a comment */}
      <ChatPanel
        post={post}
        analysis={analysis}
        focused={focused}
        onClearFocus={() => setFocused(null)}
      />

      {/* Draft replies — secondary, tucked away */}
      {analysis.draftComments.length > 0 && (
        <details className="rounded-xl border border-border bg-panel p-5">
          <summary className="cursor-pointer text-sm font-semibold text-fg">
            ✍️ Draft replies you could post{" "}
            <span className="font-normal text-subtle">(optional)</span>
          </summary>
          <div className="mt-3 space-y-2">
            {analysis.draftComments.map((c, i) => (
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
  c: ScoredComment;
  onAsk: (c: ScoredComment) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-elevated p-3.5">
      <div className="flex items-start gap-3">
        <ScoreBadge score={c.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="font-medium text-fg">@{c.author}</span>
            <span>· {c.likes} likes</span>
            {c.replyCount != null && c.replyCount > 0 && (
              <span>· {c.replyCount} replies</span>
            )}
            <span className="rounded bg-panel px-1.5 py-0.5">{c.category}</span>
          </div>
          <p className="mt-1 text-sm text-fg">{c.text}</p>
          <p className="mt-1 text-xs italic text-subtle">{c.reason}</p>
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
  focused: ScoredComment | null;
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
