// Weave — split one overloaded card into several.
//
// The mapper aims for one point per card, but points still pile up: a long
// run of speech lands as one fat card, or updates accrete onto a card until
// it's three things wearing one title. This route unpacks exactly one card,
// on request — the user right-clicked it and asked, so unlike consolidate
// there is no "prefer doing nothing" here. The card was ALREADY judged too
// big by the person reading it.

import { generateObject } from "ai";
import { z } from "zod";
import { normalizeType, type Op } from "@/lib/weave/types";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_SPLIT_MODEL ?? "google/gemini-2.5-flash";

const TypeEnum = z
  .string()
  .describe(
    'What the point IS, one short lowercase word: idea / action / question / fact / decision when they fit, or the truer word ("risk", "goal", "metric", "constraint") when they don\'t.',
  );

const ResultSchema = z.object({
  summary: z
    .string()
    .describe(
      'One short sentence: what you pulled apart, e.g. "Split into the idea and its two risks." If the card is genuinely one point, say so.',
    ),
  keep: z.object({
    type: TypeEnum,
    title: z
      .string()
      .describe("The original card's new title: its PRIMARY point only."),
    body: z
      .string()
      .describe("The original card's new body, narrowed to that one point."),
  }),
  parts: z
    .array(
      z.object({
        ref: z.string().describe('Short handle you invent, e.g. "s1".'),
        type: TypeEnum,
        title: z.string().describe("3-7 words. The point itself. Required."),
        body: z.string().describe("ONE sentence of detail. Required."),
      }),
    )
    .describe(
      "Every OTHER distinct point in the card, one card each. EMPTY if the card is genuinely a single point.",
    ),
});

const SYSTEM = `You split ONE card on a thought-map into its distinct points.

The user pointed at this card and said it holds too much. Read its title and
body, find every distinct point in it, and redistribute: the card keeps its
PRIMARY point — the thing the card is really about — and each other point
becomes its own card. They will all be connected back to the original.

## What counts as a distinct point

A point that could stand on the map alone: a feature, a risk, a next step, a
constraint, a number worth tracking. "An app for booking padel courts, and we
should charge per booking, but the courts might not sign up" is three points —
the idea, a revenue model, a risk. Clauses that merely elaborate one point
("...which matches on skill level and location") are NOT separate points; keep
them in the card they describe.

Split by MEANING, never by grammar. Do not make one card per sentence, and do
not shave a card so thin the pieces say nothing alone.

## The honest empty answer

If the card is genuinely ONE point, return keep = the card exactly as it is
and an EMPTY parts list, and say so in the summary. Never invent a second
point to have something to split — nothing here may add content the card
doesn't already carry.

## Fields

keep — the original card, narrowed to its primary point. Rewrite title and
  body so nothing that moved into parts is still duplicated here, and nothing
  that stays is lost.
parts — one entry per other point. title states the point (3-7 words), body is
  one sentence of detail from the card's own content.
type — for keep and every part: what the point IS, one short lowercase word.
  idea / action / question / fact / decision cover most; use the truer word
  ("risk", "goal", "metric", "constraint") when they don't.

Between keep and parts, every point the card made must survive exactly once.`;

type Body = {
  cardId?: string;
  cards?: { id: string; type: string; title: string; body: string }[];
  edges?: { source: string; target: string }[];
};

export async function POST(req: Request) {
  try {
    const { cardId, cards = [], edges = [] } = (await req.json()) as Body;
    const target = cards.find((c) => c.id === cardId);
    if (!target) {
      return Response.json(
        { error: "That card isn't on the board." },
        { status: 400 },
      );
    }

    const board = cards
      .map((c) => `- id:${c.id} [${c.type}] "${c.title}" — ${c.body}`)
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
      maxRetries: 4,
      prompt: `## THE CARD to split
[${target.type}] "${target.title}"
${target.body}

## The rest of the board — context only
Use it to phrase the new cards consistently and avoid duplicating a point that
already has its own card (a point that does can simply be dropped from keep).
${board}

## Connections
${links}

Split the card. Every point it makes must survive exactly once between keep
and parts.`,
    });

    const parts = object.parts.filter((p) => p.title.trim());
    const ops: Op[] = [];
    // No parts = nothing to split; leave the card untouched rather than
    // rewording it under the guise of a split that did nothing.
    if (parts.length && object.keep.title.trim()) {
      ops.push({
        op: "update_card",
        id: target.id,
        type: normalizeType(object.keep.type),
        title: object.keep.title,
        body: object.keep.body,
      });
      for (const p of parts) {
        ops.push({
          op: "create_card",
          ref: p.ref,
          type: normalizeType(p.type),
          title: p.title,
          body: p.body,
          connectTo: [target.id],
        });
      }
    }

    return Response.json({
      ops,
      summary: object.summary,
      cost: await costOf(MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Split failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
