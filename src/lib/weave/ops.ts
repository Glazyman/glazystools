// Weave — the reducer that turns model Ops into board state.
//
// Pure and total: every op is validated against the current document before it
// lands, so a hallucinated card id or a duplicate edge is dropped rather than
// corrupting the board. This is the only place the document is allowed to grow.

import { placeCard } from "./layout";
import type { BoardDoc, Card, Op, WeaveEdge } from "./types";

function nid(): string {
  return crypto.randomUUID();
}

/** Deterministic id makes duplicate edges impossible by construction. */
function edgeId(source: string, target: string): string {
  return `${source}->${target}`;
}

export type ApplyResult = {
  doc: BoardDoc;
  /** Cards created or updated by this batch — used to flash them on canvas. */
  touched: string[];
};

/**
 * @param utteranceIds every utterance in the batch that produced these ops.
 *   Mapping runs on a short run of speech rather than one sentence, so a card
 *   is generally owed to several of them at once.
 */
export function applyOps(
  input: BoardDoc,
  ops: Op[],
  utteranceIds: string[] = [],
): ApplyResult {
  // Reassignable: removeCard returns a fresh document rather than mutating.
  // The closures below read `doc` at call time, so they follow the swap.
  let doc: BoardDoc = {
    cards: [...input.cards],
    edges: [...input.edges],
    utterances: [...input.utterances],
    questions: [...input.questions],
  };
  const touched: string[] = [];

  // Model-invented refs ("c1") → real card ids, for same-batch references.
  const refs = new Map<string, string>();
  const resolve = (key: string): string | undefined =>
    refs.get(key) ?? (doc.cards.some((c) => c.id === key) ? key : undefined);

  const addEdge = (source: string, target: string, label?: string) => {
    if (source === target) return;
    const id = edgeId(source, target);
    // Treat A→B and B→A as the same connection; the first one spoken wins.
    if (doc.edges.some((e) => e.id === id || e.id === edgeId(target, source)))
      return;
    const edge: WeaveEdge = { id, source, target };
    if (label) edge.label = label;
    doc.edges.push(edge);
  };

  for (const op of ops) {
    switch (op.op) {
      case "create_card": {
        const anchorIds = (op.connectTo ?? [])
          .map(resolve)
          .filter((v): v is string => Boolean(v));
        const anchors = doc.cards.filter((c) => anchorIds.includes(c.id));
        const pos = placeCard(doc, anchors);
        const card: Card = {
          id: nid(),
          type: op.type,
          title: op.title.trim(),
          body: op.body.trim(),
          confidence: clamp(op.confidence),
          x: pos.x,
          y: pos.y,
          createdAt: Date.now(),
          sourceUtteranceIds: [...utteranceIds],
        };
        doc.cards.push(card);
        refs.set(op.ref, card.id);
        anchorIds.forEach((a) => addEdge(a, card.id));
        touched.push(card.id);
        break;
      }

      case "update_card": {
        const id = resolve(op.id);
        if (!id) break;
        const i = doc.cards.findIndex((c) => c.id === id);
        if (i === -1) break;
        const prev = doc.cards[i];
        // A hand-edited card is the user's, not the model's. Still record the
        // utterance so the transcript link works, but leave the text alone.
        const next: Card = prev.pinned
          ? { ...prev }
          : {
              ...prev,
              title: op.title?.trim() ?? prev.title,
              body: op.body?.trim() ?? prev.body,
              type: op.type ?? prev.type,
              confidence:
                op.confidence !== undefined
                  ? clamp(op.confidence)
                  : prev.confidence,
            };
        next.sourceUtteranceIds = [
          ...new Set([...next.sourceUtteranceIds, ...utteranceIds]),
        ];
        doc.cards[i] = next;
        touched.push(next.id);
        break;
      }

      case "link": {
        const s = resolve(op.source);
        const t = resolve(op.target);
        if (s && t) addEdge(s, t, op.label);
        break;
      }

      case "unlink": {
        const s = resolve(op.source);
        const t = resolve(op.target);
        if (!s || !t) break;
        doc.edges = doc.edges.filter(
          (e) => e.id !== edgeId(s, t) && e.id !== edgeId(t, s),
        );
        break;
      }

      case "ask": {
        const cardId = op.cardId ? resolve(op.cardId) : undefined;
        // Don't stack near-identical questions if you circle a topic twice.
        const dupe = doc.questions.some(
          (q) => q.text.toLowerCase() === op.text.trim().toLowerCase(),
        );
        if (dupe) break;
        doc.questions.push({
          id: nid(),
          text: op.text.trim(),
          cardId,
          at: Date.now(),
        });
        break;
      }

      case "delete_card": {
        const id = resolve(op.id);
        if (!id) break;
        // A pinned card is the user's own text; deletion would destroy it
        // outright, so it's refused here the same way update_card refuses.
        if (doc.cards.find((c) => c.id === id)?.pinned) break;
        doc = removeCard(doc, id);
        break;
      }
    }
  }

  // Record which cards this batch was responsible for. Every utterance in the
  // run gets credit: the mapper saw them together and we can't attribute a card
  // to one sentence within the run, so hovering any of them lights it up.
  if (utteranceIds.length && touched.length) {
    doc.utterances = doc.utterances.map((u) =>
      utteranceIds.includes(u.id)
        ? { ...u, cardIds: [...new Set([...u.cardIds, ...touched])] }
        : u,
    );
  }

  return { doc, touched };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/** Removing a card must take its edges and transcript links with it. */
export function removeCard(doc: BoardDoc, id: string): BoardDoc {
  return {
    ...doc,
    cards: doc.cards.filter((c) => c.id !== id),
    edges: doc.edges.filter((e) => e.source !== id && e.target !== id),
    questions: doc.questions.filter((q) => q.cardId !== id),
    utterances: doc.utterances.map((u) => ({
      ...u,
      cardIds: u.cardIds.filter((c) => c !== id),
    })),
  };
}
