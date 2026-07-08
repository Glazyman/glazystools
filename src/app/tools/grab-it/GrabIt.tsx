"use client";

import { useMemo, useState } from "react";
import type { Analysis, ScrapedPost } from "@/lib/grab-it/types";

type Stage = "idle" | "scraping" | "analyzing" | "done" | "error";

const stageSteps = [
  { key: "scraping", label: "Grab it", detail: "Scraping video, caption & comments" },
  { key: "analyzing", label: "Understand & read the room", detail: "Transcribing + scoring every comment" },
  { key: "done", label: "Your ideas", detail: "Follow-ups & value-adding replies" },
] as const;

export function GrabIt() {
  const [url, setUrl] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [post, setPost] = useState<ScrapedPost | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  async function run() {
    setError(null);
    setPost(null);
    setAnalysis(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStage("error");
    }
  }

  const busy = stage === "scraping" || stage === "analyzing";

  return (
    <div className="space-y-6">
      {/* Input */}
      <div className="flex gap-2">
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

      {/* Stage progress */}
      {stage !== "idle" && (
        <StageBar stage={stage} />
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {analysis && post && <Results post={post} analysis={analysis} />}

      {stage === "idle" && <EmptyHint />}
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
              <div
                className={`text-sm ${active || done ? "text-fg" : "text-subtle"}`}
              >
                {s.label}
              </div>
              {active && (
                <div className="text-[11px] text-muted">{s.detail}</div>
              )}
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

function Results({ post, analysis }: { post: ScrapedPost; analysis: Analysis }) {
  const [minScore, setMinScore] = useState(0);
  const [category, setCategory] = useState<string>("all");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(analysis.scoredComments.map((c) => c.category)))],
    [analysis.scoredComments],
  );

  const visible = analysis.scoredComments.filter(
    (c) => c.score >= minScore && (category === "all" || c.category === category),
  );

  return (
    <div className="space-y-6">
      {/* Post meta */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>@{post.author}</span>
        <span>{post.commentsCount ?? post.comments.length} comments</span>
        {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
        <span className="rounded bg-elevated px-1.5 py-0.5">
          transcript: {analysis.transcriptSource}
        </span>
      </div>

      {/* What the video is about */}
      <Section title="What the video is about">
        <p className="text-sm leading-relaxed text-fg">{analysis.videoSummary}</p>
      </Section>

      {/* Read the room */}
      <div className="grid gap-4 md:grid-cols-2">
        <ListCard title="What people are asking" items={analysis.audienceQuestions} />
        <ListCard title="What's missing" items={analysis.gaps} />
      </div>

      {/* Ideas */}
      <ListCard
        title="💡 Strong follow-ups & add-ons"
        items={analysis.followUpIdeas}
        accent
      />

      {/* Draft comments */}
      <Section title="✍️ Draft comments you could post">
        <div className="space-y-2">
          {analysis.draftComments.map((c, i) => (
            <CopyRow key={i} text={c} />
          ))}
        </div>
      </Section>

      {/* Scored comments */}
      <Section
        title={`Scored comments (${visible.length})`}
        controls={
          <div className="flex items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1.5">
              min score
              <input
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="accent-[var(--accent)]"
              />
              <span className="w-6 tabular-nums text-fg">{minScore}</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded border border-border bg-elevated px-2 py-1 text-xs text-fg focus:outline-none"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="space-y-2">
          {visible.map((c) => (
            <div
              key={c.id}
              className="rounded-lg border border-border bg-elevated p-3.5"
            >
              <div className="flex items-start gap-3">
                <ScoreBadge score={c.score} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="font-medium text-fg">@{c.author}</span>
                    <span>· {c.likes} likes</span>
                    <span className="rounded bg-panel px-1.5 py-0.5">
                      {c.category}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-fg">{c.text}</p>
                  <p className="mt-1 text-xs italic text-subtle">{c.reason}</p>
                  {c.replyIdea && (
                    <div className="mt-2 rounded-md border border-accent/20 bg-accent/5 p-2 text-xs text-fg">
                      <span className="text-accent">Reply idea: </span>
                      {c.replyIdea}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="text-sm text-subtle">No comments match this filter.</p>
          )}
        </div>
      </Section>
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
    >
      {score}
    </span>
  );
}

function Section({
  title,
  children,
  controls,
}: {
  title: string;
  children: React.ReactNode;
  controls?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {controls}
      </div>
      {children}
    </div>
  );
}

function ListCard({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-5 ${
        accent ? "border-accent/30 bg-accent/5" : "border-border bg-panel"
      }`}
    >
      <h3 className="mb-3 text-sm font-semibold text-fg">{title}</h3>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2 text-sm text-fg">
            <span className="text-subtle">•</span>
            <span>{item}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-sm text-subtle">Nothing surfaced here.</li>
        )}
      </ul>
    </div>
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
        <span className="text-fg">Grab it</span>. You&apos;ll get a transcript,
        every comment scored for value, and ready-to-post ideas.
      </p>
    </div>
  );
}
