// Weave — incremental card placement.
//
// New cards land next to whatever they connect to and never on top of an
// existing card. Deliberately incremental rather than a force-directed
// re-layout: cards you've already dragged somewhere meaningful must not jump
// around every time you open your mouth.

import type { BoardDoc, Card } from "./types";

export const CARD_W = 300;
export const CARD_H = 150;
const GAP_X = 90;
const GAP_Y = 46;

type Point = { x: number; y: number };

function overlaps(a: Point, cards: Card[]): boolean {
  return cards.some(
    (c) =>
      Math.abs(c.x - a.x) < CARD_W + GAP_X * 0.5 &&
      Math.abs(c.y - a.y) < CARD_H + GAP_Y * 0.5,
  );
}

/**
 * Candidate offsets, nearest-first: right, then down/up, then diagonals,
 * widening each ring. Right-first keeps a spoken train of thought reading
 * left-to-right, which is what makes the board scannable afterwards.
 */
function* candidates(from: Point): Generator<Point> {
  yield from;
  for (let ring = 1; ring <= 6; ring++) {
    const dx = ring * (CARD_W + GAP_X);
    const dy = ring * (CARD_H + GAP_Y);
    yield { x: from.x + dx, y: from.y };
    yield { x: from.x, y: from.y + dy };
    yield { x: from.x, y: from.y - dy };
    yield { x: from.x + dx, y: from.y + dy };
    yield { x: from.x + dx, y: from.y - dy };
    yield { x: from.x - dx, y: from.y + dy };
    yield { x: from.x - dx, y: from.y - dy };
    yield { x: from.x - dx, y: from.y };
  }
}

/**
 * The nearest free spot to `preferred` that doesn't land on an existing card.
 * Returns `preferred` itself when it's already clear.
 */
export function freeSpotNear(doc: BoardDoc, preferred: Point): Point {
  for (const p of candidates(preferred)) {
    if (!overlaps(p, doc.cards)) return p;
  }
  // Every ring was full — drop it below the board rather than on top of it.
  if (doc.cards.length === 0) return preferred;
  const lowest = doc.cards.reduce((a, b) => (b.y > a.y ? b : a));
  return { x: preferred.x, y: lowest.y + CARD_H + GAP_Y };
}

/**
 * Where should a new card go, given the cards it links to?
 * Anchored to its parents when it has them, otherwise appended to the right
 * edge of the board so unrelated threads don't pile up on each other.
 */
export function placeCard(doc: BoardDoc, anchors: Card[]): Point {
  if (doc.cards.length === 0) return { x: 0, y: 0 };

  let preferred: Point;
  if (anchors.length > 0) {
    const cx = anchors.reduce((s, c) => s + c.x, 0) / anchors.length;
    const cy = anchors.reduce((s, c) => s + c.y, 0) / anchors.length;
    preferred = { x: cx + CARD_W + GAP_X, y: cy };
  } else {
    const rightmost = doc.cards.reduce((a, b) => (b.x > a.x ? b : a));
    preferred = { x: rightmost.x + CARD_W + GAP_X, y: rightmost.y };
  }

  return freeSpotNear(doc, preferred);
}

/**
 * Full tidy-up for the "Tidy" button — layered left-to-right by link depth,
 * so roots sit on the left and consequences flow right. Only runs when you
 * explicitly ask for it.
 */
export function tidy(doc: BoardDoc): Card[] {
  const incoming = new Map<string, number>();
  doc.cards.forEach((c) => incoming.set(c.id, 0));
  doc.edges.forEach((e) =>
    incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1),
  );

  // Longest-path depth via BFS from the roots.
  const depth = new Map<string, number>();
  const queue = doc.cards.filter((c) => (incoming.get(c.id) ?? 0) === 0);
  queue.forEach((c) => depth.set(c.id, 0));

  // Cards in a cycle never hit the queue via a root; seed them at 0 too.
  if (queue.length === 0 && doc.cards.length > 0) {
    depth.set(doc.cards[0].id, 0);
    queue.push(doc.cards[0]);
  }

  const byId = new Map(doc.cards.map((c) => [c.id, c]));
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const cur = queue.shift()!;
    const d = depth.get(cur.id) ?? 0;
    for (const e of doc.edges.filter((e) => e.source === cur.id)) {
      const next = byId.get(e.target);
      if (!next) continue;
      if ((depth.get(next.id) ?? -1) < d + 1) {
        depth.set(next.id, d + 1);
        queue.push(next);
      }
    }
  }
  // Anything unreachable (orphans, cycles) goes in the first column.
  doc.cards.forEach((c) => {
    if (!depth.has(c.id)) depth.set(c.id, 0);
  });

  const columns = new Map<number, Card[]>();
  doc.cards.forEach((c) => {
    const d = depth.get(c.id)!;
    (columns.get(d) ?? columns.set(d, []).get(d)!).push(c);
  });

  const placed: Card[] = [];
  for (const [d, cards] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const totalH = cards.length * CARD_H + (cards.length - 1) * GAP_Y;
    cards.forEach((c, i) => {
      placed.push({
        ...c,
        x: d * (CARD_W + GAP_X),
        y: i * (CARD_H + GAP_Y) - totalH / 2,
      });
    });
  }
  return placed;
}
