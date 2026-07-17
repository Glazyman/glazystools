"use client";

import { useEffect, useRef } from "react";
import type { OpenQuestion, Utterance } from "@/lib/weave/types";

export type TranscriptRailProps = {
  utterances: Utterance[];
  /** What's being said right now, before Web Speech commits to it. */
  interim: string;
  questions: OpenQuestion[];
  listening: boolean;
  /** Mic input level 0..1. */
  level: number;
  onSpotlight: (cardIds: string[] | null) => void;
  onDismissQuestion: (id: string) => void;
  onAnswerQuestion: (q: OpenQuestion) => void;
};

export function TranscriptRail({
  utterances,
  interim,
  questions,
  listening,
  level,
  onSpotlight,
  onDismissQuestion,
  onAnswerQuestion,
}: TranscriptRailProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [utterances.length, interim]);

  return (
    <aside className="flex h-full w-[320px] shrink-0 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Live transcript
        </span>
        {listening && (
          <div className="flex items-center gap-2">
            {/* Mic meter — proof the browser is actually hearing you, which is
                the first thing you doubt when no cards appear. */}
            <div className="h-1 w-12 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-75"
                style={{ width: `${Math.min(100, level * 140)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-accent">REC</span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {utterances.length === 0 && !interim ? (
          <p className="text-xs leading-relaxed text-subtle">
            Tap{" "}
            <kbd className="rounded border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted">
              Space
            </kbd>{" "}
            and start talking. Tap it again to stop. Everything you say lands
            here; the things that matter become cards on the right.
          </p>
        ) : (
          <div className="space-y-2">
            {utterances.map((u) => (
              <button
                key={u.id}
                onMouseEnter={() =>
                  onSpotlight(u.cardIds.length ? u.cardIds : null)
                }
                onMouseLeave={() => onSpotlight(null)}
                className={[
                  "w-full rounded-[10px] border px-3 py-2 text-left transition-colors",
                  u.cardIds.length
                    ? "border-border-strong bg-elevated hover:border-accent"
                    : // Filler that produced nothing — visibly lesser, so the
                      // rail reads as a record rather than a list of failures.
                      "border-border bg-transparent opacity-50 hover:opacity-80",
                ].join(" ")}
              >
                <p className="text-xs leading-relaxed text-fg">
                  &ldquo;{u.text}&rdquo;
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  {u.status === "refining" && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-subtle">
                      sharpening…
                    </span>
                  )}
                  {u.cardIds.length > 0 && (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-accent">
                      {u.cardIds.length} card{u.cardIds.length > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </button>
            ))}

            {interim && (
              <div className="rounded-[10px] border border-dashed border-border-strong px-3 py-2">
                <p className="text-xs leading-relaxed text-muted">
                  {interim}
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-accent align-middle" />
                </p>
              </div>
            )}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Questions for you {questions.length > 0 && `(${questions.length})`}
        </div>
        {questions.length === 0 ? (
          <p className="text-xs text-subtle">None open.</p>
        ) : (
          <div className="max-h-40 space-y-2 overflow-y-auto">
            {questions.map((q) => (
              <div
                key={q.id}
                className="rounded-[10px] border border-dashed px-3 py-2"
                style={{ borderColor: "var(--accent-2)" }}
              >
                <p className="text-xs italic leading-relaxed text-fg">
                  {q.text}
                </p>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    onClick={() => onAnswerQuestion(q)}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent-2 transition-opacity hover:opacity-70"
                  >
                    Make a card
                  </button>
                  <button
                    onClick={() => onDismissQuestion(q.id)}
                    className="font-mono text-[10px] uppercase tracking-wider text-subtle transition-colors hover:text-fg"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
