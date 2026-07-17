"use client";

import { useEffect, useRef, useState } from "react";
// Aliased: React Flow's `Node` would otherwise shadow the DOM's `Node`, which
// the focus-out check below needs.
import { Handle, Position, type Node as FlowNode, type NodeProps } from "@xyflow/react";
import { CARD_W } from "@/lib/weave/layout";
import type { Attachment, Card, CardType, ChartPoint } from "@/lib/weave/types";
import { isImage } from "@/lib/weave/attachments";

// Every type maps onto an existing palette token — no new colours enter the
// design system just because this tool needs five categories.
//
// Exported: the card's colour IS its type, so anything that offers to change
// the type (the right-click menu) has to show the same swatches.
export const TYPE_VAR: Record<CardType, string> = {
  idea: "var(--accent)", // lime — a possibility
  action: "var(--live)", // green — go do it
  question: "var(--accent-2)", // orange — unresolved
  fact: "var(--planned)", // grey — immovable reality
  decision: "var(--wip)", // yellow — settled
};

export type CardNodeData = {
  card: Card;
  /** Briefly ringed after the mapper touches it, so you can see what changed. */
  flash: boolean;
  /** Faded because the transcript hover is spotlighting other cards. */
  dimmed: boolean;
  linkCount: number;
  /** This card is waiting on the expand call. */
  expanding: boolean;
  onCommit: (id: string, patch: { title: string; body: string }) => void;
  onCycleType: (id: string) => void;
  onExpand: (id: string) => void;
  onDelete: (id: string) => void;
  /** Which card, and which of its attachments you clicked. */
  onOpenFile: (cardId: string, index: number) => void;
};

export type CardNodeType = FlowNode<CardNodeData, "card">;

/** Compact number for an axis: 22000 → 22k, 1200000 → 1.2M. */
function shortNum(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trimZero(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trimZero(n / 1_000)}k`;
  return trimZero(n);
}
function trimZero(n: number): string {
  return n.toFixed(1).replace(/\.0$/, "");
}

/**
 * Bars, not a charting library. A card is 300px wide and read at a glance from
 * across a zoomed-out board — the shape of the trend is the whole payload, and
 * anything more would be pixels nobody can see.
 */
function Chart({ points, color }: { points: ChartPoint[]; color: string }) {
  // Baseline at zero unless the data goes negative; a chart that silently
  // starts at the minimum exaggerates every trend it draws.
  const values = points.map((p) => p.value);
  const top = Math.max(...values, 0);
  const bottom = Math.min(...values, 0);
  const span = top - bottom || 1;

  return (
    <div className="nodrag mt-2.5">
      {/* The columns must STRETCH to the row's height (no items-end): a bar's
          height is a percentage, and a percentage of a column that shrank to
          fit its content is a percentage of nothing. */}
      <div className="flex h-14 gap-1">
        {points.map((p, i) => (
          <div
            key={`${p.label}-${i}`}
            className="flex h-full min-w-0 flex-1 flex-col justify-end"
            title={`${p.label}: ${p.value.toLocaleString()}`}
          >
            <div
              className="rounded-t-[2px] transition-opacity"
              style={{
                height: `${Math.max(2, (Math.abs(p.value - Math.max(bottom, 0)) / span) * 100)}%`,
                background: color,
                opacity: 0.55,
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {points.map((p, i) => (
          <div key={`${p.label}-lbl-${i}`} className="min-w-0 flex-1">
            <div className="truncate font-mono text-[9px] leading-tight text-fg">
              {shortNum(p.value)}
            </div>
            <div className="truncate font-mono text-[9px] leading-tight text-subtle">
              {p.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Attachments. Photos get a thumbnail because a photo you can't see is just a
 * filename; anything else gets a chip. Clicking either opens the real file.
 */
function Attachments({
  items,
  onOpen,
}: {
  items: Attachment[];
  /** Index into `items` — the viewer pages through them all. */
  onOpen: (index: number) => void;
}) {
  // Keep each one's real index: the viewer pages across images AND files, so a
  // position in a filtered list would open the wrong thing.
  const withIndex = items.map((a, i) => ({ a, i }));
  const images = withIndex.filter(({ a }) => isImage(a));
  const files = withIndex.filter(({ a }) => !isImage(a));
  return (
    <div className="nodrag mt-2.5 space-y-1.5">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map(({ a, i }) => (
            <button
              key={a.path}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(i);
              }}
              title={a.name}
              className="overflow-hidden rounded-md border border-border transition-opacity hover:opacity-80"
            >
              {/* Plain <img>: these are arbitrary uploads on a canvas node, not
                  layout-stable page content, so next/image buys nothing here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={a.name}
                className="h-14 w-14 object-cover"
                draggable={false}
              />
            </button>
          ))}
        </div>
      )}
      {files.map(({ a, i }) => (
        <button
          key={a.path}
          onClick={(e) => {
            e.stopPropagation();
            onOpen(i);
          }}
          title={a.name}
          className="flex w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 text-left transition-colors hover:bg-hover"
        >
          <span className="shrink-0 text-[10px]">📎</span>
          <span className="min-w-0 flex-1 truncate text-[10px] text-muted">
            {a.name}
          </span>
        </button>
      ))}
    </div>
  );
}

export function CardNode({ data, selected }: NodeProps<CardNodeType>) {
  const {
    card,
    flash,
    dimmed,
    linkCount,
    expanding,
    onCommit,
    onCycleType,
    onExpand,
    onDelete,
    onOpenFile,
  } = data;
  // The draft exists only while editing. Keeping no mirrored copy of the card
  // means there's nothing to re-sync when the mapper rewrites this card
  // underneath us — the props stay the single display source.
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(
    null,
  );
  const editing = draft !== null;
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) titleRef.current?.focus();
  }, [editing]);

  const commit = () => {
    if (!draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    setDraft(null);
    if (title && (title !== card.title || body !== card.body)) {
      onCommit(card.id, { title, body });
    }
  };

  const color = TYPE_VAR[card.type];

  return (
    <div
      style={{ width: CARD_W, ["--card" as string]: color }}
      onDoubleClick={() => setDraft({ title: card.title, body: card.body })}
      className={[
        // weave-card is the hook the neon dark theme hangs its per-type glow
        // off — it reads the --card var set just above.
        "weave-card group relative rounded-[var(--radius)] border bg-panel shadow-card transition-all duration-200",
        selected ? "border-[var(--card)]" : "border-border",
        flash ? "ring-2 ring-[var(--card)] ring-offset-2 ring-offset-bg" : "",
        dimmed ? "opacity-25" : "opacity-100",
      ].join(" ")}
    >
      {/* Type stripe — the fastest way to read the board at a glance. */}
      <div
        className="absolute left-0 top-0 h-full w-[3px] rounded-l-[var(--radius)]"
        style={{ background: color }}
      />

      {/* Delete — a badge on the corner, revealed on hover. Deliberately
          outside the card's own padding so it never competes with the text. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(card.id);
        }}
        title="Delete card"
        className="nodrag absolute -left-2.5 -top-2.5 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[11px] leading-none text-white opacity-0 shadow-card transition-opacity group-hover:opacity-100 hover:brightness-110"
        style={{ background: "var(--accent-2)" }}
      >
        ✕
      </button>

      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-border-strong !opacity-0 transition-opacity group-hover:!opacity-100 hover:!bg-[var(--card)]"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-0 !bg-border-strong !opacity-0 transition-opacity group-hover:!opacity-100 hover:!bg-[var(--card)]"
      />

      <div className="px-4 py-3 pl-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <button
            onClick={() => onCycleType(card.id)}
            title="Click to change type"
            className="nodrag cursor-pointer font-mono text-[10px] uppercase tracking-[0.12em] transition-opacity hover:opacity-70"
            style={{ color }}
          >
            {card.type}
          </button>
          {card.pinned && (
            <span
              title="You edited this — the AI won't rewrite it"
              className="font-mono text-[9px] uppercase tracking-wider text-subtle"
            >
              pinned
            </span>
          )}
        </div>

        {draft ? (
          // onBlur bubbles (it's focusout), so this commits when focus leaves
          // the editor entirely — but not when it moves title → body.
          <div
            className="nodrag space-y-1.5"
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                commit();
              }
            }}
          >
            <textarea
              ref={titleRef}
              value={draft.title}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, title: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") setDraft(null);
                e.stopPropagation();
              }}
              rows={2}
              className="w-full resize-none rounded-md bg-elevated px-2 py-1 text-sm font-medium leading-snug outline-none ring-1 ring-border-strong"
            />
            <textarea
              value={draft.body}
              onChange={(e) =>
                setDraft((d) => ({ ...d!, body: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Escape") setDraft(null);
                e.stopPropagation();
              }}
              rows={3}
              className="w-full resize-none rounded-md bg-elevated px-2 py-1 text-xs leading-relaxed text-muted outline-none ring-1 ring-border-strong"
            />
          </div>
        ) : (
          <>
            <h3 className="text-sm font-medium leading-snug text-fg">
              {card.title}
            </h3>
            {card.body && (
              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted">
                {card.body}
              </p>
            )}
            {card.chart && card.chart.length >= 2 && (
              <Chart points={card.chart} color={color} />
            )}
            {card.attachments && card.attachments.length > 0 && (
              <Attachments
                items={card.attachments}
                onOpen={(i) => onOpenFile(card.id, i)}
              />
            )}
          </>
        )}

        <div className="mt-3 flex items-center gap-2">
          {/* Suggest next cards off this one. Reveal on hover — a deliberate
              act, not something to fire by accident while dragging. */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpand(card.id);
            }}
            disabled={expanding}
            title="Suggest next steps from this card"
            className={[
              "nodrag flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-none transition-opacity",
              expanding
                ? "animate-pulse opacity-100"
                : "opacity-0 group-hover:opacity-100 hover:bg-hover",
            ].join(" ")}
            style={{ color, borderColor: color }}
          >
            <span className="text-[13px] leading-none">✨</span>
            {expanding ? "Thinking…" : "Expand"}
          </button>

          {linkCount > 0 && (
            <span className="ml-auto font-mono text-[10px] text-subtle">
              ⇄ {linkCount}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
