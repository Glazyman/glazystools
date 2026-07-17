"use client";

import { useEffect } from "react";
import { isImage } from "@/lib/weave/attachments";
import type { Attachment } from "@/lib/weave/types";

export type LightboxState = {
  cardId: string;
  items: Attachment[];
  /** Index into `items`. */
  at: number;
};

export type LightboxProps = {
  state: LightboxState;
  onClose: () => void;
  onMove: (at: number) => void;
  onDelete: (cardId: string, path: string) => void;
};

/**
 * View an attachment without leaving the board.
 *
 * Clicking a photo used to open a browser tab — which throws you out of the
 * thing you're thinking in to look at something pinned to it. A photo on a card
 * is context, not a destination.
 */
export function Lightbox({ state, onClose, onMove, onDelete }: LightboxProps) {
  const { items, at } = state;
  const item = items[at];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" && at < items.length - 1) onMove(at + 1);
      if (e.key === "ArrowLeft" && at > 0) onMove(at - 1);
      // Swallow everything else: the talk key must not fire the mic while
      // you're looking at a picture.
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [at, items.length, onClose, onMove]);

  if (!item) return null;

  return (
    <div
      // Click the backdrop to close; clicks inside the panel must not bubble
      // out to it.
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-8"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full max-w-5xl flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-panel shadow-card"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <span className="min-w-0 flex-1 truncate text-xs text-fg">
            {item.name}
          </span>
          {items.length > 1 && (
            <span className="shrink-0 font-mono text-[10px] text-subtle">
              {at + 1}/{items.length}
            </span>
          )}
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-md border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted transition-colors hover:bg-hover hover:text-fg"
          >
            Open
          </a>
          <button
            onClick={() => onDelete(state.cardId, item.path)}
            title="Remove from card"
            className="shrink-0 rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors hover:bg-hover"
            style={{ color: "var(--accent-2)", borderColor: "var(--accent-2)" }}
          >
            Remove
          </button>
          <button
            onClick={onClose}
            title="Close (esc)"
            className="shrink-0 rounded-md px-2 py-1 text-sm text-subtle transition-colors hover:bg-hover hover:text-fg"
          >
            ✕
          </button>
        </div>

        <div className="relative flex min-h-0 items-center justify-center bg-bg">
          {isImage(item) ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.url}
              alt={item.name}
              className="max-h-[70vh] max-w-full object-contain"
            />
          ) : (
            // Not everything can be shown. Say so rather than render a blank
            // rectangle and let it look broken.
            <div className="px-16 py-20 text-center">
              <div className="text-3xl">📎</div>
              <p className="mt-3 text-xs text-muted">{item.name}</p>
              <p className="mt-1 text-[11px] text-subtle">
                Can&rsquo;t preview this one — use Open.
              </p>
            </div>
          )}

          {items.length > 1 && (
            <>
              <Arrow side="left" disabled={at === 0} onClick={() => onMove(at - 1)} />
              <Arrow
                side="right"
                disabled={at === items.length - 1}
                onClick={() => onMove(at + 1)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Arrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous" : "Next"}
      className={[
        "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-panel text-sm text-muted transition-opacity hover:text-fg disabled:opacity-20",
        side === "left" ? "left-3" : "right-3",
      ].join(" ")}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
