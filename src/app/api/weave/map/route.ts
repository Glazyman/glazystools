// Weave — the mapping layer. One utterance + the whole board → a list of ops.
//
// This is the tool. Everything else is plumbing. The two failure modes that
// matter are (1) carding every throwaway sentence and (2) re-creating a card
// that already exists under a different phrasing — so the prompt spends most of
// its budget on "usually do nothing" and "check the board first".

import { generateObject } from "ai";
import { z } from "zod";
import { CARD_TYPES, type CardType, type Op } from "@/lib/weave/types";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_MAP_MODEL ?? "google/gemini-2.5-flash";

// One array per operation kind, and EVERY field required.
//
// The obvious shape — a single `ops` array of {op, ...optional fields} — fails
// badly in practice: with every field optional the model happily emits
// {op:"create_card", ref:"c1", type:"idea"} and simply omits the title and
// body, because nothing in the schema compels them. Splitting by kind lets each
// field be required, so a create that lacks a title is a schema violation the
// model is made to retry rather than a card that silently never appears.
//
// Fields that are conceptually optional (label, cardId) are required strings
// where "" means absent — cheaper than reintroducing optionality.
const TypeEnum = z.enum(CARD_TYPES as [CardType, ...CardType[]]);

const ResultSchema = z.object({
  reasoning: z
    .string()
    .describe("One short sentence: what you decided and why. Max 15 words."),
  create: z.array(
    z.object({
      ref: z.string().describe('Short handle you invent, e.g. "c1"'),
      type: TypeEnum,
      title: z.string().describe("3-7 words. The point itself. Required."),
      body: z.string().describe("ONE sentence of detail. Required."),
      connectTo: z
        .array(z.string())
        .describe("Card ids or same-batch refs. Empty array if none."),
    }),
  ),
  chart: z.array(
    z.object({
      ref: z.string().describe('Short handle you invent, e.g. "h1"'),
      title: z.string().describe("What the series is. 3-7 words."),
      body: z.string().describe("ONE sentence on what it shows."),
      points: z
        .array(z.object({ label: z.string(), value: z.number() }))
        .describe("At least TWO. Values as plain numbers: 10k -> 10000."),
      connectTo: z.array(z.string()).describe("Empty array if none."),
    }),
  ),
  update: z.array(
    z.object({
      id: z.string(),
      type: TypeEnum,
      title: z.string().describe("The card's full new title."),
      body: z.string().describe("The card's full new body."),
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
      cardId: z.string().describe('"" if it isn\'t about a specific card.'),
    }),
  ),
});

const SYSTEM = `You maintain a live thought-map while someone thinks out loud.

You receive ONE RUN of new speech — everything the speaker said between two
pauses, which may be a single fragment or several sentences — plus the board
that already exists. You return a list of operations. You are the difference
between a useful map and a wall of noise, so you are conservative by default.

## Read the run as one thought — but judge its points separately

The sentences in a run belong together; the speaker said them without stopping.
They are usually one point approached from a few angles, NOT one point per
sentence. "I need a patent app. Well, the real problem is the USPTO backlog. So
maybe ship without the API." is one line of reasoning: a card for the idea and a
card for the constraint, connected — not three.

Extract the POINTS in the run, not the sentences. A four-sentence run very often
deserves exactly one card, and quite often none.

BUT a run is frequently a MIXTURE, and every point in it stands on its own.
Judge each one independently against the board. If the speaker restates
something already on the board and THEN says something genuinely new, the
restatement is skipped and the new thing STILL GETS ITS CARD. One point being
old tells you nothing whatsoever about the next one.

Never let a restatement at the start of a run swallow a real idea at the end of
it. Read to the end of the run before you decide anything. Silently dropping a
new idea is the worst thing you can do here — worse than an extra card, worse
than a wrong type. If any part of the run is new and substantive, it must
survive.

## The single most important rule

Most runs deserve NO operations. Return empty lists for:
- filler, false starts, and abandoned sentences ("I wanna get a", "so like, um")
- thinking noises, restatements of something already on the board
- pleasantries, asides, tangents that go nowhere
- anything under ~4 words that isn't a complete thought

A person talking for ten minutes should produce roughly 5-12 cards, not 60.
If you are unsure whether something deserves a card, it does not.

## Before you create anything, read the board

update is ONLY for the SAME point said again — restated, reworded, or corrected.
Saying the same idea a second time in different words is the most common thing
people do when thinking aloud, and it must never produce a duplicate card. Match
on meaning, not wording.

A DIFFERENT THING OF THE SAME KIND IS NOT A RESTATEMENT. Match on the specific
thing being talked about, not its category. Two apps are two cards. Two hires
are two cards. Two customers are two cards.

  board: "Create a new app — Tinder for developers"
  "let's make a brand new app called Glazys for basketball"
    → NEW card. A different app, for different people. NOT an update.
      Renaming the Tinder card to "Glazys" would destroy the first idea and
      lose the second. This is the single worst mistake you can make.

"a brand new", "another", "a different", "a separate", "a second", "also",
"on another note" — these are the speaker telling you outright that they have
moved to a NEW thing. When one appears, it is a new card. Never fold it into
the card it superficially resembles.

A NEW point that BUILDS ON an existing card is also not an update — it is its
own card, connected back to what it came from. If the speaker adds a feature, a
requirement, a consequence, a problem, or a next step for something already on
the board, that is a new point. Cards should stay small and the relationships
should live in the edges; do not fatten one card with everything said about it.

  "I want a Tinder for devs"                   → new card
  "...a dating app for developers, basically"  → update: same point, reworded
  "...it should match on GitHub languages"     → NEW card, connected to it
  "...and the patent thing is still the goal"  → nothing: already on the board

So: same point → update. New point about an old card → create + connectTo.
New point about nothing on the board → create with an empty connectTo.

Never rewrite a card marked pinned:true — the user wrote that text themselves.
You may still link to it or connect new cards to it.

## Operations

You return six lists: create, chart, update, link, unlink, ask. Any of them may
be empty, and usually ALL of them are. Never invent a card id — only ids shown
on the board, or a ref from your own create/chart lists this batch.

create — a new distinct point. Every field is required.
  ref: a short handle you invent ("c1") so other ops in THIS batch can point at it
  type: idea | action | question | fact | decision
    idea     — something to build/try; a possibility
    action   — a concrete thing that must get done
    question — an open problem the speaker themselves raised
    fact     — a constraint or piece of reality that shapes decisions
    decision — a choice that has been made
  title: 3-7 words, no trailing period. The point itself, not a description of it.
         NEVER omit this and never leave it empty — a card with no title is useless.
  body: ONE sentence of detail in the speaker's own framing. Never repeat the title.
  connectTo: ids of existing cards (or refs from this batch) this follows from.
             Use an empty array when it genuinely follows from nothing.

chart — a card that DRAWS a spoken series instead of burying it in a sentence.
  Only when the speaker gives TWO OR MORE numbers that belong on the same axis:
  a trend over time, or the same measure across categories.
    "10k in Jan, 15k in Feb, 22k in March"   → chart. Three points on one axis.
    "we're at 40% on iOS and 60% on Android" → chart. Two, same measure.
    "I want to make 10k this month"          → NOT a chart. One number → normal card.
    "it costs 5k and takes 3 weeks"          → NOT a chart. Different units.
  points: label is the axis tick ("Jan"), value is a plain number — convert as
  you go: "10k" → 10000, "1.2 million" → 1200000, "40%" → 40. Never a string.
  A chart card is INSTEAD of a normal card for that point, not as well.

update — restate the card's FULL new state: { id, type, title, body }.
  You have the card in front of you; carry over the parts you aren't changing.
link — { source, target, label } a relationship between two cards already on the
  board. label is "" unless a short word genuinely clarifies it.
unlink — { source, target } only when the speaker explicitly says two things aren't related.
ask — { text, cardId } a clarifying question; cardId is "" if not about one card.

## Connections

Connect a new card to what it actually follows from — the idea it serves, the
problem it solves, the constraint it runs into, the thing it is a feature of.
If the speaker is talking about something already on the board, the new card
MUST connect back to it; that edge is the whole value of the map.

Pick the RIGHT card. When several are on the board, connect to the one the
speaker is actually talking about, not the most recent or the most prominent.

A card with no real relationship to anything on the board gets an empty
connectTo. That is a perfectly good outcome and far better than a wrong edge —
the user can draw a line by hand in a second, but a wrong one they have to spot
first. When genuinely unsure, leave it unconnected.

## Questions

Use ask only when a genuinely important thing is ambiguous and the answer would
change what gets built. At most one per utterance, and only when the board is
otherwise coherent. Never ask about something the speaker is obviously about to
say. Most batches contain no ask. Phrase it as one short, direct question.

## Output

reasoning: one short sentence.
create / chart / update / link / unlink / ask: the six lists, usually all empty.

Your reasoning and your lists must agree. If you say you're creating a card,
the create list must actually contain it, complete with its title and body.`;

type Body = {
  utterance: string;
  /**
   * Set when the speaker has hand-corrected an earlier utterance's text.
   * Each entry is a card the old text changed: what it says now, and what it
   * said before — so the model can put a card back if the old text never
   * should have touched it.
   */
  correcting?: { id: string; title: string; body: string }[];
  recent?: string[];
  cards?: {
    id: string;
    type: string;
    title: string;
    body: string;
    pinned?: boolean;
  }[];
  edges?: { source: string; target: string }[];
};

export async function POST(req: Request) {
  try {
    const {
      utterance,
      correcting = [],
      recent = [],
      cards = [],
      edges = [],
    } = (await req.json()) as Body;

    if (!utterance || utterance.trim().length < 2) {
      return Response.json({ ops: [], reasoning: "empty" });
    }

    const board =
      cards.length === 0
        ? "The board is empty. This is the first thing said."
        : cards
            .map(
              (c) =>
                `- id:${c.id} [${c.type}${c.pinned ? " pinned:true" : ""}] "${c.title}" — ${c.body}`,
            )
            .join("\n");

    const links =
      edges.length === 0
        ? "(none)"
        : edges.map((e) => `- ${e.source} -> ${e.target}`).join("\n");

    const context =
      recent.length === 0
        ? "(nothing yet)"
        : recent.map((r) => `- "${r}"`).join("\n");

    const { object, usage } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.2,
      maxRetries: 4, // ride out transient gateway rate limits with backoff
      prompt: `## Cards already on the board
${board}

## Existing connections
${links}

## The few utterances just before this one (context only — already handled, do not re-card)
${context}

${
  correcting.length
    ? `## A CORRECTION — this is not new speech

The speaker hand-fixed something they said earlier, because it was heard wrong.
The corrected text is:
"${utterance}"

Any card the old text wrongly altered has ALREADY been put back — the board
above is accurate. These cards, though, were CREATED by the old text, so they
are this point's home:

${correcting.map((c) => `- id:${c.id} "${c.title}" — ${c.body}`).join("\n")}

Update them to match the corrected text rather than creating a duplicate beside
them. If the corrected text is only a spelling fix and the point is unchanged,
return nothing. If the correction turns out to also contain a genuinely separate
new point, that part may still get its own card.`
    : `## The new run of speech to map (said without pausing — read it as ONE thought)
"${utterance}"`
}

Return the operations. Extract points, not sentences. Remember: all-empty is the
most common correct answer.`,
    });

    return Response.json({
      ops: flatten(object),
      reasoning: object.reasoning,
      cost: await costOf(MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Mapping failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * Fold the per-kind arrays into the ordered Op list the reducer expects.
 * Creates must come first so that same-batch refs resolve before anything
 * points at them.
 */
function flatten(o: z.infer<typeof ResultSchema>): Op[] {
  const ops: Op[] = [];
  for (const c of o.create) {
    // A title is the card; without one there's nothing to show.
    if (!c.title.trim()) continue;
    ops.push({
      op: "create_card",
      ref: c.ref,
      type: c.type,
      title: c.title,
      body: c.body,
      connectTo: c.connectTo,
    });
  }
  for (const c of o.chart) {
    // Fewer than two points isn't a series; drop the chart rather than draw a
    // one-bar graph. A dropped chart is better than a silly one.
    const points = c.points.filter(
      (p) => p.label.trim() && Number.isFinite(p.value),
    );
    if (!c.title.trim() || points.length < 2) continue;
    ops.push({
      op: "create_card",
      ref: c.ref,
      type: "fact", // a series is a measurement — that's what fact means here
      title: c.title,
      body: c.body,
      chart: points,
      connectTo: c.connectTo,
    });
  }
  for (const u of o.update) {
    if (!u.id || !u.title.trim()) continue;
    ops.push({
      op: "update_card",
      id: u.id,
      type: u.type,
      title: u.title,
      body: u.body,
    });
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
