// Weave — the shape of a board and the operations that grow it.
//
// The model never mutates a board directly. It reads the board state and emits
// a list of Ops, which `applyOps` (ops.ts) folds into the document. That split
// keeps the AI layer pure and testable, and means a bad model response can only
// ever produce bad ops — never a corrupt board.

/**
 * Free-form on purpose: the model names what a point actually IS — "risk",
 * "goal", "metric", "constraint" — rather than being forced to file a risk
 * under "fact". One short lowercase word by convention (the prompts say so,
 * and `normalizeType` cleans up whatever comes back anyway).
 */
export type CardType = string;

/** The five workhorse types — quick-picks in menus and the colour anchors.
 *  Not a ceiling: any string is a valid CardType. */
export const CARD_TYPES: CardType[] = [
  "idea",
  "action",
  "question",
  "fact",
  "decision",
];

/** Model output → a display-ready type: lowercase, single-ish word, bounded.
 *  Falls back to "idea" rather than ever letting an empty type through. */
export function normalizeType(raw: string): CardType {
  const t = raw.trim().toLowerCase().replace(/[^a-z0-9 -]/g, "");
  if (!t) return "idea";
  // A type is a label, not a sentence — clamp anything rambling.
  return t.length > 16 ? t.slice(0, 16).trim() : t;
}

/** One bar of a chart card. */
export type ChartPoint = { label: string; value: number };

/**
 * A file pinned to a card. Only ever a URL — the bytes live in Supabase
 * Storage. Inlining a photo as base64 would re-upload the whole picture on
 * every autosave and bloat the row past usefulness.
 */
export type Attachment = {
  /** Storage path, so it can be deleted later. */
  path: string;
  url: string;
  name: string;
  /** MIME type. Anything image/* renders as a thumbnail. */
  mime: string;
};

export type Card = {
  id: string;
  type: CardType;
  title: string;
  body: string;
  /**
   * Present when you spoke a SERIES of numbers ("10k in Jan, 15k in Feb") —
   * the card draws them instead of burying them in prose. Two points minimum;
   * one number is a sentence, not a chart.
   */
  chart?: ChartPoint[];
  /** Files and photos you pinned to this card. */
  attachments?: Attachment[];
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
  /**
   * Prompt cards only: the cards this prompt was generated from. A prompt is
   * a snapshot of the idea; keeping its sources means "Regenerate" can re-read
   * them AS THEY ARE NOW instead of freezing the deliverable on day one.
   */
  promptSources?: string[];
  /**
   * Set when the user deliberately combined several cards into this one (the
   * Merge action). The cleanup pass must never split it back apart — pulling a
   * just-merged card into pieces is the exact opposite of what was asked.
   */
  noSplit?: boolean;
};

/**
 * The marker type for an image card: a picture that IS the card, not a file
 * pinned to a text card. The picture lives in `attachments[0]`; title/body are
 * an optional caption. Born pinned + noSplit — you dropped it, so neither the
 * mapper nor the cleanup pass gets to rewrite or dismember it.
 */
export const IMAGE_CARD_TYPE = "image";

export function isImageCard(card: Card): boolean {
  return card.type === IMAGE_CARD_TYPE && !!card.attachments?.length;
}

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
  /** Actions this utterance COMMANDED ("delete", "expand", "prompt") — the
   *  rail labels these lines so orders are distinguishable from thoughts. */
  commands?: string[];
  /**
   * What the cards this utterance CHANGED looked like before it changed them.
   *
   * Without this, correcting a mis-heard line is a one-way door: if the mapper
   * wrongly folded your words into an existing card, there's no record of what
   * that card used to say, so the correction can only ever patch the damage —
   * never undo it and put the point where it actually belonged.
   */
  before?: { id: string; type: CardType; title: string; body: string }[];
};

/** A spoken command ("delete that", "expand the pricing card") on its way to
 *  being executed — staged in the rail's Questions section when it needs a
 *  confirming hand. */
export type PendingCommand = {
  /** Client-side handle so a list of these can be confirmed independently. */
  key: string;
  boardId: string | null;
  action: "delete" | "expand" | "prompt";
  ids: string[];
  titles: string[];
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
  /**
   * Running total of what this board has cost in AI, in USD. Optional so
   * boards written before this existed still load.
   */
  spend?: number;
  /**
   * Card ids the user has already refused to let the cleanup pass split. Once
   * you dismiss a proposed split, it stays dismissed — the review won't keep
   * asking to break the same card apart every time you stop talking.
   */
  declinedSplits?: string[];
};

export type BoardMeta = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type Board = BoardMeta & { doc: BoardDoc };

export function emptyDoc(): BoardDoc {
  return { cards: [], edges: [], utterances: [], questions: [], spend: 0 };
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
      /** A spoken series, if there was one. See Card.chart. */
      chart?: ChartPoint[];
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
