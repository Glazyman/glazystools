"use client";

import { useEffect, useRef } from "react";
import { CARD_TYPES, type Card, type CardType } from "@/lib/weave/types";
import { TYPE_VAR } from "./CardNode";

export type CardMenuState = {
  card: Card;
  /** Screen coords of the right-click. */
  x: number;
  y: number;
};

export type CardMenuProps = {
  state: CardMenuState;
  onClose: () => void;
  onDuplicate: (id: string) => void;
  onSetType: (id: string, type: CardType) => void;
  onAttach: (id: string) => void;
  onDelete: (id: string) => void;
};

export function CardMenu({
  state,
  onClose,
  onDuplicate,
  onSetType,
  onAttach,
  onDelete,
}: CardMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { card } = state;

  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Next tick: the same right-click that opened this would otherwise close it.
    const t = setTimeout(() => {
      document.addEventListener("pointerdown", away);
      document.addEventListener("keydown", esc);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  // Flip the menu when it would otherwise open off the edge of the window.
  const W = 200;
  const H = 260;
  const x = Math.min(state.x, window.innerWidth - W - 8);
  const y = Math.min(state.y, window.innerHeight - H - 8);

  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      ref={ref}
      style={{ left: x, top: y, width: W }}
      className="fixed z-50 overflow-hidden rounded-[10px] border border-border bg-panel py-1 shadow-card"
    >
      <Item onClick={act(() => onDuplicate(card.id))}>Duplicate</Item>
      <Item onClick={act(() => onAttach(card.id))}>Attach file or photo…</Item>

      <div className="my-1 border-t border-border" />
      <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-subtle">
        Type
      </div>
      {CARD_TYPES.map((t) => (
        <button
          key={t}
          onClick={act(() => onSetType(card.id, t))}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-hover"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: TYPE_VAR[t] }}
          />
          <span className="flex-1 capitalize">{t}</span>
          {card.type === t && (
            <span className="font-mono text-[10px] text-subtle">✓</span>
          )}
        </button>
      ))}

      <div className="my-1 border-t border-border" />
      <Item onClick={act(() => onDelete(card.id))} danger>
        Delete card
      </Item>
    </div>
  );
}

function Item({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-hover"
      style={danger ? { color: "var(--accent-2)" } : { color: "var(--fg)" }}
    >
      {children}
    </button>
  );
}
