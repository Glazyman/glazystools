// Weave — expand a node.
//
// The mapper only ever reacts to what you actually said. This route does the
// opposite: it reads one card in the context of the whole board and surfaces
// what the map IMPLIES but nobody has spoken yet — the sub-questions, the
// options, the risks. It's the one place Weave is allowed to have ideas of its
// own, which is exactly why it's on a button and never automatic.

import { generateObject } from "ai";
import { z } from "zod";
import { CARD_TYPES, type CardType, type Op } from "@/lib/weave/types";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_EXPAND_MODEL ?? "google/gemini-2.5-flash";

// Per-kind array with every field required — see the map route for why the
// obvious all-optional shape silently drops titles.
const ResultSchema = z.object({
  summary: z.string().describe("Short sentence: what you surfaced."),
  cards: z
    .array(
      z.object({
        ref: z.string().describe('Short handle, e.g. "e1"'),
        type: z.enum(CARD_TYPES as [CardType, ...CardType[]]),
        title: z.string().describe("3-7 words, the point itself. Required."),
        body: z.string().describe("ONE sentence. Required."),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe("2-4 cards. Fewer and better beats more."),
});

const SYSTEM = `You expand one node on someone's thought-map.

You are given ONE card and the entire board around it. Your job is to surface
what this card IMPLIES but nobody has written down yet: the sub-questions it
raises, the options it forces a choice between, and the risks it carries.

## What good looks like

Return 2-4 cards. Three is usually right. Fewer and sharper always beats more.

Aim for a MIX rather than four of the same flavour:
- question — the thing that must be answered before this can proceed
- idea     — a concrete option or approach this opens up
- fact     — a constraint or reality this runs into
- action   — the specific next step this demands
- decision — a fork that has to be chosen between

## The bar

Every card must be SPECIFIC TO THIS BOARD. The test: could this sentence appear
on someone else's map about a different project? If yes, it's worthless — delete
it. "Consider the costs", "Validate with users", "Think about scalability" are
noise. "Patent attorneys cost $8-15k per filing, which kills the price point"
is a real card.

Use the rest of the board. The other cards tell you what this person is actually
building, what they've already decided, and what they already know — a card that
restates something already on the board is wasted, and a card that contradicts a
decision they've made is worse.

Be concrete and be short. You are adding to a map someone is thinking on, not
writing them a consulting report.

## Do not

- Do not repeat or reword anything already on the board.
- Do not pad to reach four. Two excellent cards is a great answer.
- Do not hedge. "It might be worth possibly considering" is not a thought.
- Do not ask questions the speaker has visibly already answered elsewhere.`;

type Body = {
  cardId?: string;
  cards?: {
    id: string;
    type: string;
    title: string;
    body: string;
  }[];
  edges?: { source: string; target: string }[];
};

export async function POST(req: Request) {
  try {
    const { cardId, cards = [], edges = [] } = (await req.json()) as Body;
    const target = cards.find((c) => c.id === cardId);
    if (!target) {
      return Response.json({ error: "That card isn't on the board." }, {
        status: 400,
      });
    }

    const board = cards
      .map(
        (c) =>
          `- ${c.id === cardId ? "THIS ONE >> " : ""}id:${c.id} [${c.type}] "${c.title}" — ${c.body}`,
      )
      .join("\n");

    const links =
      edges.length === 0
        ? "(none)"
        : edges.map((e) => `- ${e.source} -> ${e.target}`).join("\n");

    const { object } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.7, // higher than the mapper: here we want range, not caution
      maxRetries: 4,
      prompt: `## The card to expand
[${target.type}] "${target.title}" — ${target.body}

## The whole board it sits in
${board}

## Connections
${links}

Surface what this card implies but nobody has said yet. Specific to THIS board —
if a card could appear on someone else's map, it doesn't belong on this one.`,
    });

    // Everything hangs off the card being expanded; that's what makes it an
    // expansion rather than a pile of new orphans.
    const ops: Op[] = object.cards
      .filter((c) => c.title.trim())
      .map((c) => ({
        op: "create_card",
        ref: c.ref,
        type: c.type,
        title: c.title,
        body: c.body,
        confidence: c.confidence,
        connectTo: [target.id],
      }));

    return Response.json({ ops, summary: object.summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Expand failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
