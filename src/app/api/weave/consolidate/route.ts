// Weave — the cleanup pass. The whole board in, a tidier board out.
//
// The mapper only ever sees one utterance at a time, so it can't notice that
// something said at minute two and something said at minute nine are the same
// point. This route is the only place that reads the board as a whole. It runs
// on demand rather than continuously, because a map that reshuffles itself
// while you're talking is worse than a slightly messy one.

import { generateObject } from "ai";
import { z } from "zod";
import { normalizeType, type Op } from "@/lib/weave/types";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 120;

// Deliberately NOT thinking-disabled the way the map route is: this pass runs
// once, after you stop talking, and is allowed to actually reason about the
// whole board. Speed matters per-utterance; judgment matters here.
const MODEL = process.env.WEAVE_CONSOLIDATE_MODEL ?? "google/gemini-2.5-flash";

// One array per operation kind, every field required — same shape as the map
// route, and for the same hard-won reason: with a single `ops` array of
// all-optional fields the model emits {op:"update_card", id:"..."} and omits
// the title entirely, which then silently does nothing. Required fields make
// that a schema violation the model must retry instead.
const TypeEnum = z
  .string()
  .describe(
    'What the card IS, one short lowercase word: idea / action / question / fact / decision when they fit, or the truer word ("risk", "goal", "metric", "constraint") when they don\'t.',
  );

const ResultSchema = z.object({
  summary: z
    .string()
    .describe(
      'One short sentence naming what you changed, e.g. "Merged 2 duplicate cards, added 1 connection." Say "Nothing to clean up." if you changed nothing.',
    ),
  update: z.array(
    z.object({
      id: z.string(),
      type: TypeEnum,
      title: z.string().describe("The card's full new title. Required."),
      body: z.string().describe("The card's full new body. Required."),
    }),
  ),
  remove: z.array(
    z.object({
      id: z.string(),
      reason: z
        .string()
        .describe('Why: "duplicate of X" or "junk". Forces you to justify it.'),
    }),
  ),
  split: z.array(
    z.object({
      id: z.string().describe("The overloaded card being split."),
      keepType: TypeEnum,
      keepTitle: z
        .string()
        .describe("The original card's new title: its PRIMARY point only."),
      keepBody: z
        .string()
        .describe("The original card's new body, narrowed to that one point."),
      parts: z
        .array(
          z.object({
            ref: z.string().describe('Short handle you invent, e.g. "s1".'),
            type: TypeEnum,
            title: z.string().describe("3-7 words. The point itself."),
            body: z.string().describe("ONE sentence of detail."),
          }),
        )
        .describe("The OTHER points that were buried in the card. 1-3 of them."),
    }),
  ),
  link: z.array(
    z.object({
      source: z.string(),
      target: z.string(),
      label: z.string().describe('"" for no label.'),
    }),
  ),
  unlink: z.array(z.object({ source: z.string(), target: z.string() })),
  ask: z.array(
    z.object({
      text: z.string(),
      cardId: z.string().describe('"" if not about one specific card.'),
    }),
  ),
});

const SYSTEM = `You clean up a thought-map that was built live while someone
talked. You see the entire board at once — the first time anything has.

You cannot invent content. The ONLY way you may create a card is by SPLITTING
one that already exists — redistributing points the speaker actually said.
Nothing that isn't already on the board belongs on it.

## Prefer doing nothing

Churn is the failure mode. A board that has been reworded, reorganised, and
half-merged is worse than one with a couple of rough edges, because the user
recognises their own board and no longer recognises yours. Returning an empty
list is a good outcome and often the correct one.

Never touch a card marked pinned:true. The user wrote that text by hand. Do not
update it, do not delete it, do not merge it away. You may still link to it.

Never split a card marked noSplit:true. The user deliberately combined it out of
several cards; breaking it back apart is the exact opposite of what they asked.
You may still retitle, merge, or link it — just never split it.

## What you may fix

Duplicates — two cards making genuinely the SAME point in different words. This
is the main thing you are here for; people restate themselves constantly when
thinking aloud. Merge by updating the survivor to the better title/body, then
delete_card the other. Keep the card that is better connected, or older if it's
a wash. Two cards on the same TOPIC are not duplicates — only merge when one
card makes the other redundant. And a merge must never FATTEN the survivor: if
the duplicate also carried a point the survivor lacks, that point comes out as
a split part, not as an extra clause in the survivor's body. Cards stay small;
structure lives in the edges.

Sloppy titles — a title that is a fragment, a filler phrase, or a description of
a point rather than the point itself. Rewrite it to 3-7 words that state the
point. Leave titles that are merely plain; "could be sharper" is not a reason.

Missing connections — a link between two cards whose relationship is obvious
from their content and simply never got drawn, because the mapper never saw them
side by side. Only add edges you are confident are real. A wrong edge is worse
than a missing one.

Junk — a card that is filler, an abandoned half-thought, or says nothing. Delete
it. Be strict about what counts: if it carries any real content, it stays.

Overloaded cards — ONE card carrying TWO OR MORE distinct points: an idea and
its main risk, a decision and the action it demands, three features crammed
into one body. Split it: the card keeps its PRIMARY point (narrowed title and
body), and each buried point becomes its own card, automatically connected back
to the original. A card whose body merely elaborates its title in a couple of
clauses is NOT overloaded — split only when a reader would say "that's two
different things on one card".

Wrong types — a card typed "fact" that is plainly a risk, an "idea" that is
plainly a goal. Types are free-form: idea / action / question / fact / decision
are the workhorses, but the truer one-word name ("risk", "goal", "metric",
"constraint") is better when a card genuinely is one. Retype only when the
current type is wrong, not merely improvable.

## Operations

You return six lists: update, remove, split, link, unlink, ask. Any may be
empty and usually all are. Only ever reference ids that appear on the board
above.

update — restate the card's FULL new state: { id, type, title, body }.
  You can see the card; carry over verbatim whatever you aren't changing. Never
  leave title or body empty.
remove — { id, reason } a duplicate you merged away, or genuine junk. The reason
  is required: if you can't name it ("duplicate of card-x", "junk"), don't remove it.
split — { id, keepType, keepTitle, keepBody, parts } one overloaded card →
  several. keep* is the original card narrowed to its primary point; each part
  is one buried point, and each gets connected back to the original for you.
  Never split a pinned card.
link — { source, target, label } a real relationship that was missed. label "" if none.
unlink — { source, target } an edge that is plainly wrong.
ask — { text, cardId } at most one, only if the whole board hinges on it.

## Merging, precisely

To merge B into A: update A with the better title/body, AND remove B with
reason "duplicate of A". Do both. An update without the removal leaves the
duplicate sitting there; a removal without the update throws away the content.

## Output

summary: one short sentence, naming real numbers.
update / remove / link / unlink / ask: the five lists, often all empty.`;

type Body = {
  cards?: {
    id: string;
    type: string;
    title: string;
    body: string;
    pinned?: boolean;
    /** The user combined this card by hand — it may never be split. */
    noSplit?: boolean;
  }[];
  edges?: { source: string; target: string }[];
  /** Cards the user already refused to split — don't propose them again. */
  declinedSplitIds?: string[];
};

export async function POST(req: Request) {
  try {
    const {
      cards = [],
      edges = [],
      declinedSplitIds = [],
    } = (await req.json()) as Body;

    // Nothing to merge against — the model would only be tempted to fiddle.
    if (cards.length < 2) {
      return Response.json({ ops: [], summary: "Nothing to clean up." });
    }

    // Cards that must never be split: ones the user merged by hand, plus any
    // split they've already dismissed. Enforced twice — once as a rule the
    // model is told, once as a filter it can't get around.
    const noSplit = new Set<string>(declinedSplitIds);
    for (const c of cards) if (c.noSplit) noSplit.add(c.id);

    const board = cards
      .map(
        (c) =>
          `- id:${c.id} [${c.type}${c.pinned ? " pinned:true" : ""}${c.noSplit ? " noSplit:true" : ""}] "${c.title}" — ${c.body}`,
      )
      .join("\n");

    const links =
      edges.length === 0
        ? "(none)"
        : edges.map((e) => `- ${e.source} -> ${e.target}`).join("\n");

    const { object, usage } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.2,
      prompt: `## The whole board (${cards.length} cards)
${board}

## Existing connections
${links}

Clean this up. Remember: only merge cards that are genuinely the same point,
never touch pinned cards, and leaving the board alone is a perfectly good
answer.`,
    });

    // Hard backstop: drop any split the model proposed on a card that may not
    // be split, whatever the prompt said. A merged card the user is being
    // asked to un-merge is precisely the surprise this whole change removes.
    object.split = object.split.filter((s) => !noSplit.has(s.id));

    // Which cards this proposal still wants to split — so the client can
    // remember a "no" and stop the pass re-asking about the same card.
    const splitIds = object.split
      .filter((s) => s.parts.some((p) => p.title.trim()) && s.keepTitle.trim())
      .map((s) => s.id);

    return Response.json({
      ops: flatten(object),
      summary: object.summary,
      splitIds,
      cost: await costOf(MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Consolidation failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Fold the per-kind arrays into the ordered Op list the reducer expects.
 * Updates must precede removes: a merge writes the survivor's better text
 * first, then drops the duplicate. Reversing that would delete the card an
 * update still points at.
 */
function flatten(o: z.infer<typeof ResultSchema>): Op[] {
  const ops: Op[] = [];
  // Splits first: narrow the original, then hang each buried point off it.
  // A split with no usable parts is refused outright — otherwise it would
  // rewrite the card while adding nothing, which is just an unasked-for edit.
  for (const s of o.split) {
    const parts = s.parts.filter((p) => p.title.trim());
    if (!s.id || !s.keepTitle.trim() || !parts.length) continue;
    ops.push({
      op: "update_card",
      id: s.id,
      type: normalizeType(s.keepType),
      title: s.keepTitle,
      body: s.keepBody,
    });
    for (const p of parts) {
      ops.push({
        op: "create_card",
        ref: p.ref,
        type: normalizeType(p.type),
        title: p.title,
        body: p.body,
        connectTo: [s.id],
      });
    }
  }
  for (const u of o.update) {
    if (!u.id || !u.title.trim()) continue;
    ops.push({
      op: "update_card",
      id: u.id,
      type: normalizeType(u.type),
      title: u.title,
      body: u.body,
    });
  }
  for (const r of o.remove) {
    // No justification, no deletion — the cheapest guard against the model
    // quietly binning cards it merely didn't like.
    if (!r.id || !r.reason.trim()) continue;
    ops.push({ op: "delete_card", id: r.id });
  }
  for (const l of o.link) {
    if (!l.source || !l.target) continue;
    ops.push({
      op: "link",
      source: l.source,
      target: l.target,
      label: l.label || undefined,
    });
  }
  for (const u of o.unlink) {
    if (!u.source || !u.target) continue;
    ops.push({ op: "unlink", source: u.source, target: u.target });
  }
  for (const a of o.ask) {
    if (!a.text.trim()) continue;
    ops.push({ op: "ask", text: a.text, cardId: a.cardId || undefined });
  }
  return ops;
}
