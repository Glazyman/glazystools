"use client";

// Weave — ⌘K: find a card on ANY board.
//
// Boards pile up fast when capture is this cheap, and "which board did I put
// that on" is the tax. This is the refund: one palette over every card of
// every board. All docs are fetched in one query when the palette opens and
// searched in memory — at personal scale that's simpler and faster than any
// server-side search endpoint would be.

import { useEffect, useMemo, useRef, useState } from "react";
import { allBoards } from "@/lib/weave/boards";
import type { Board } from "@/lib/weave/types";
import { typeColor } from "./CardNode";

export type SearchHit = {
  boardId: string;
  boardTitle: string;
  /** Absent when the BOARD TITLE itself is the match. */
  cardId?: string;
  cardType?: string;
  cardTitle?: string;
  snippet?: string;
};

export type BoardSearchProps = {
  onClose: () => void;
  onJump: (hit: SearchHit) => void;
};

const MAX_HITS = 30;

function findHits(boards: Board[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHit[] = [];
  for (const b of boards) {
    if (b.title.toLowerCase().includes(q)) {
      hits.push({ boardId: b.id, boardTitle: b.title });
    }
    for (const c of b.doc.cards) {
      const inTitle = c.title.toLowerCase().includes(q);
      const inBody = c.body.toLowerCase().includes(q);
      if (!inTitle && !inBody) continue;
      hits.push({
        boardId: b.id,
        boardTitle: b.title,
        cardId: c.id,
        cardType: c.type,
        cardTitle: c.title,
        // Show the matching text: the body when that's where the hit was.
        snippet: inBody ? snippetAround(c.body, q) : c.body.slice(0, 90),
      });
      if (hits.length >= MAX_HITS) return hits;
    }
    if (hits.length >= MAX_HITS) return hits;
  }
  return hits;
}

/** A slice of `text` centred on the first occurrence of `q`. */
function snippetAround(text: string, q: string): string {
  const at = text.toLowerCase().indexOf(q);
  const from = Math.max(0, at - 30);
  const to = Math.min(text.length, at + q.length + 60);
  return `${from > 0 ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
}

export function BoardSearch({ onClose, onJump }: BoardSearchProps) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    allBoards()
      .then((b) => {
        if (!cancelled) setBoards(b);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hits = useMemo(
    () => (boards ? findHits(boards, query) : []),
    [boards, query],
  );

  // Typing changes the list; the highlight must never point past its end.
  // Clamped at read time (not reset in an effect) so there's no extra render.
  const activeIdx = Math.min(active, Math.max(0, hits.length - 1));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[520px] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-panel shadow-card">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            }
            if (e.key === "Enter" && hits[activeIdx]) onJump(hits[activeIdx]);
          }}
          placeholder={
            failed
              ? "Search is unavailable — couldn't load the boards."
              : boards
                ? "Search every card on every board…"
                : "Loading boards…"
          }
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-subtle"
        />
        {query.trim() && (
          <div className="max-h-[50vh] overflow-y-auto py-1">
            {hits.length === 0 ? (
              <p className="px-4 py-3 text-xs text-subtle">
                {boards ? "No matches." : "Still loading…"}
              </p>
            ) : (
              hits.map((h, i) => (
                <button
                  key={`${h.boardId}:${h.cardId ?? "board"}`}
                  onClick={() => onJump(h)}
                  onMouseEnter={() => setActive(i)}
                  className={[
                    "flex w-full items-baseline gap-2 px-4 py-2 text-left transition-colors",
                    i === activeIdx ? "bg-hover" : "",
                  ].join(" ")}
                >
                  {h.cardId ? (
                    <>
                      <span
                        className="shrink-0 font-mono text-[9px] uppercase tracking-wider"
                        style={{ color: typeColor(h.cardType ?? "idea") }}
                      >
                        {h.cardType}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-fg">
                          {h.cardTitle}
                        </span>
                        {h.snippet && (
                          <span className="block truncate text-[11px] text-subtle">
                            {h.snippet}
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-xs text-fg">
                      {h.boardTitle}
                    </span>
                  )}
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-subtle">
                    {h.cardId ? h.boardTitle : "board"}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
