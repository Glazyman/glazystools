"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  OpenQuestion,
  PendingCommand,
  Utterance,
} from "@/lib/weave/types";

export type TranscriptRailProps = {
  utterances: Utterance[];
  /** Utterances to light up because their card is selected on the canvas —
   *  the card-to-transcript direction. Hover inside the rail overrides it. */
  highlight: Set<string> | null;
  /** What's being said right now, before Web Speech commits to it. */
  interim: string;
  questions: OpenQuestion[];
  listening: boolean;
  /** Mic input level 0..1. */
  level: number;
  /** Whatever the talk key is currently bound to, for the empty state. */
  talkKeyLabel: string;
  /** Spoken commands waiting for a hand to confirm them. They live with the
   *  questions: each IS one — the most consequential kind. */
  commandAsks: PendingCommand[];
  onCommandConfirm: (cmd: PendingCommand) => void;
  onCommandSkip: (key: string) => void;
  onSpotlight: (cardIds: string[] | null) => void;
  /** Typed instead of spoken. */
  onSubmitText: (text: string) => void;
  /** Corrected a mis-heard line — the cards it made get fixed to match. */
  onEditUtterance: (id: string, text: string) => void;
  /** Re-say a mis-heard line by voice instead of retyping it. */
  onRedictate: (id: string) => void;
  onDismissQuestion: (id: string) => void;
  onAnswerQuestion: (q: OpenQuestion) => void;
};

export function TranscriptRail({
  utterances,
  highlight,
  interim,
  questions,
  commandAsks,
  onCommandConfirm,
  onCommandSkip,
  listening,
  level,
  talkKeyLabel,
  onSpotlight,
  onSubmitText,
  onEditUtterance,
  onRedictate,
  onDismissQuestion,
  onAnswerQuestion,
}: TranscriptRailProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  // Only ever one line under edit; null means none. Same shape as CardNode's
  // draft, and for the same reason: nothing to re-sync when the text changes
  // underneath.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  );
  const [hovered, setHovered] = useState<string | null>(null);

  // Hovering a line answers "what did this become" in BOTH panes: the canvas
  // spotlights its cards (via onSpotlight), and here every line that fed any
  // of those same cards lights up with it — so the size of the group IS how
  // many messages it took to build that card.
  const siblings = useMemo(() => {
    if (!hovered) return null;
    const u = utterances.find((x) => x.id === hovered);
    if (!u || u.cardIds.length === 0) return null;
    const mine = new Set(u.cardIds);
    const set = new Set<string>();
    for (const other of utterances) {
      if (other.cardIds.some((c) => mine.has(c))) set.add(other.id);
    }
    return set;
  }, [hovered, utterances]);

  // One set drives the lit/receded styling. A hover inside the rail is the
  // more specific intent, so it wins over the canvas selection.
  const lit = siblings ?? (highlight?.size ? highlight : null);

  // Follow the conversation as it grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [utterances.length, interim]);

  // Selecting a card can light lines that are scrolled far out of view —
  // bring the first one in. Hover never scrolls (the pointer is already here).
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!highlight?.size) return;
    const first = utterances.find((u) => highlight.has(u.id));
    if (!first) return;
    listRef.current
      ?.querySelector(`[data-uid="${first.id}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [highlight, utterances]);

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

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {utterances.length === 0 && !interim ? (
          <p className="text-xs leading-relaxed text-subtle">
            Tap{" "}
            <kbd className="rounded border border-border bg-elevated px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {talkKeyLabel}
            </kbd>{" "}
            and start talking. Tap it again to stop. Everything you say lands
            here; the things that matter become cards on the right — or type it
            below.
          </p>
        ) : (
          <div className="space-y-2">
            {utterances.map((u) =>
              editing?.id === u.id ? (
                <div
                  key={u.id}
                  className="rounded-[10px] border border-accent bg-elevated px-2 py-1.5"
                >
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={(e) =>
                      setEditing({ id: u.id, text: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        onEditUtterance(u.id, editing.text);
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                      // Space BEFORE any typing = "let me just say it again".
                      // The moment the text is touched, space types spaces —
                      // you're keyboard-editing now, not re-dictating.
                      if (e.key === " " && editing.text === u.text) {
                        e.preventDefault();
                        setEditing(null);
                        onRedictate(u.id);
                      }
                    }}
                    onBlur={() => {
                      onEditUtterance(u.id, editing.text);
                      setEditing(null);
                    }}
                    rows={3}
                    className="w-full resize-none bg-transparent text-xs leading-relaxed text-fg outline-none"
                  />
                  <div className="font-mono text-[9px] uppercase tracking-wider text-subtle">
                    space to re-say it · ↵ to fix its cards · esc to cancel
                  </div>
                </div>
              ) : (
                <button
                  key={u.id}
                  data-uid={u.id}
                  onMouseEnter={() => {
                    setHovered(u.id);
                    onSpotlight(u.cardIds.length ? u.cardIds : null);
                  }}
                  onMouseLeave={() => {
                    setHovered(null);
                    onSpotlight(null);
                  }}
                  onDoubleClick={() => setEditing({ id: u.id, text: u.text })}
                  title="Double-click to fix what it heard"
                  className={[
                    "w-full rounded-[10px] border px-3 py-2 text-left transition-all",
                    u.cardIds.length
                      ? "border-border-strong bg-elevated hover:border-accent"
                      : // Filler that produced nothing — visibly lesser, so the
                        // rail reads as a record rather than a list of failures.
                        "border-border bg-transparent opacity-50 hover:opacity-80",
                    // While a line is hovered (or a card is selected on the
                    // canvas), the lines that built that card stay lit and
                    // everything unrelated recedes — the group you see is the
                    // group that built it.
                    lit
                      ? lit.has(u.id)
                        ? "!border-accent !opacity-100"
                        : "!opacity-25"
                      : "",
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
                    {(u.commands?.length ?? 0) > 0 && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-accent-2">
                        ⌘ {u.commands!.join(" · ")}
                      </span>
                    )}
                    {u.cardIds.length > 0 && (
                      <span className="font-mono text-[9px] uppercase tracking-wider text-accent">
                        {u.cardIds.length} card{u.cardIds.length > 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </button>
              ),
            )}

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

      {/* Type instead of talk — same pipeline, no mic. Useful when you can't
          speak, and when the mic keeps mangling a particular word. */}
      <div className="border-t border-border px-4 py-3">
        <textarea
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmitText(typed);
              setTyped("");
            }
          }}
          rows={2}
          placeholder="…or type it. ↵ to map, ⇧↵ for a new line."
          className="w-full resize-none rounded-[10px] border border-border bg-elevated px-3 py-2 text-xs leading-relaxed text-fg outline-none transition-colors placeholder:text-subtle focus:border-border-strong"
        />
      </div>

      <div className="border-t border-border px-4 py-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Questions for you{" "}
          {questions.length + commandAsks.length > 0 &&
            `(${questions.length + commandAsks.length})`}
        </div>
        {commandAsks.map((cmd) => {
          const names = cmd.titles.map((t) => `“${t}”`).join(", ");
          const wording =
            cmd.action === "delete"
              ? `You asked to delete ${names} — sure?`
              : cmd.action === "expand"
                ? `Expand ${names}?`
                : `Build a prompt from ${names}?`;
          const verb =
            cmd.action === "delete"
              ? "Delete"
              : cmd.action === "expand"
                ? "Expand"
                : "Do it";
          return (
            <div
              key={cmd.key}
              className="mb-2 rounded-[10px] border border-dashed px-3 py-2"
              style={{ borderColor: "var(--accent-2)" }}
            >
              <p className="text-xs italic leading-relaxed text-fg">{wording}</p>
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={() => onCommandConfirm(cmd)}
                  className="font-mono text-[10px] uppercase tracking-wider text-accent-2 transition-opacity hover:opacity-70"
                >
                  {verb}
                </button>
                <button
                  onClick={() => onCommandSkip(cmd.key)}
                  className="font-mono text-[10px] uppercase tracking-wider text-subtle transition-colors hover:text-fg"
                >
                  Skip
                </button>
              </div>
            </div>
          );
        })}
        {questions.length === 0 && commandAsks.length === 0 ? (
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
