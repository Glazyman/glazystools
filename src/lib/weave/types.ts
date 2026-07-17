// Weave — the shape of a board and the operations that grow it.
//
// The model never mutates a board directly. It reads the board state and emits
// a list of Ops, which `applyOps` (ops.ts) folds into the document. That split
// keeps the AI layer pure and testable, and means a bad model response can only
// ever produce bad ops — never a corrupt board.

export type CardType = "idea" | "action" | "question" | "fact" | "decision";

export const CARD_TYPES: CardType[] = [
  "idea",
  "action",
  "question",
  "fact",
  "decision",
];

export type Card = {
  id: string;
  type: CardType;
  title: string;
  body: string;
  x: number;
  y: number;
  createdAt: number;
  /** Which utterances fed this card — drives the transcript ↔ card highlight. */
  sourceUtteranceIds: string[];
  /**
   * Set once you hand-edit a card. The mapper is told not to rewrite pinned
   * cards, so your words survive anything you say later.
   */
  pinned?: boolean;
};

export type WeaveEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
};

export type UtteranceStatus =
  | "interim" // being spoken right now
  | "final" // Web Speech settled on it
  | "refining" // Gemini is re-transcribing the audio for accuracy
  | "refined"; // Gemini's better text replaced it

export type Utterance = {
  id: string;
  text: string;
  at: number;
  status: UtteranceStatus;
  /** Cards this utterance created or updated. Empty = it was filler. */
  cardIds: string[];
};

/** A clarifying question the model wants answered out loud. */
export type OpenQuestion = {
  id: string;
  text: string;
  cardId?: string;
  at: number;
};

export type BoardDoc = {
  cards: Card[];
  edges: WeaveEdge[];
  utterances: Utterance[];
  questions: OpenQuestion[];
};

export type BoardMeta = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Board = BoardMeta & { doc: BoardDoc };

export function emptyDoc(): BoardDoc {
  return { cards: [], edges: [], utterances: [], questions: [] };
}

// ── Operations ────────────────────────────────────────────────────────────
//
// `ref` on create_card is a throwaway handle ("c1") the model invents so that
// other ops in the same batch can point at a card that doesn't have a real id
// yet. applyOps resolves refs → ids before anything touches the document.

export type Op =
  | {
      op: "create_card";
      ref: string;
      type: CardType;
      title: string;
      body: string;
      /** Card ids or same-batch refs to draw an edge from. */
      connectTo?: string[];
    }
  | {
      op: "update_card";
      id: string;
      title?: string;
      body?: string;
      type?: CardType;
    }
  | { op: "link"; source: string; target: string; label?: string }
  | { op: "unlink"; source: string; target: string }
  | { op: "ask"; text: string; cardId?: string }
  | { op: "delete_card"; id: string };

/** Human-readable label for the ops counter in the header. */
export function describeOp(op: Op): string {
  switch (op.op) {
    case "create_card":
      return `+ ${op.title}`;
    case "update_card":
      return `~ ${op.title ?? op.id}`;
    case "link":
      return "linked";
    case "unlink":
      return "unlinked";
    case "ask":
      return "asked";
    case "delete_card":
      return "deleted";
  }
}
