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
import { costOf } from "@/lib/weave/cost";

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
      }),
    )
    .describe("2-4 cards. Fewer and better beats more."),
});

const SYSTEM = `You suggest the next cards that follow from ONE card on
someone's thought-map.

## THE CARD IS THE SUBJECT

Everything you return must follow from what THAT CARD says — from its title and
body, and nothing else. Not from the board's most recent addition, not from
whatever the person was last talking about, not from the board's general theme.

If the card reads "Build an API for Placeit", every card you return is about
building that API. If it reads "USPTO backlog is 18 months", every card you
return is about that delay. Read the card. Work from the card.

The rest of the board is CONTEXT ONLY, for two things: not repeating what's
already there, and not contradicting a decision already made. It is never the
topic. Drifting from the card to the board's general subject is the main way to
fail here.

## What to return

2-4 cards — three is usually right. These are SUGGESTED NEXT CARDS: what this
card makes necessary, possible, or risky. Where the thinking goes from here.

Aim for a MIX rather than four of the same flavour:
- action   — the concrete next step this card demands
- question — what has to be answered before this can proceed
- idea     — a concrete option or approach this card opens up
- fact     — a constraint or reality this card runs into
- decision — a fork this card forces

## The bar

Every card must be SPECIFIC TO THIS CARD. The test: could this sentence sit
under a different card, on a different map? If yes it's worthless — cut it.
"Consider the costs", "Validate with users", "Think about scalability" are
noise. Under "Build an API for Placeit", a real card is "Placeit's ToS may
forbid scraping".

Be concrete and be short. You are adding to a map someone is thinking on, not
writing them a consulting report.

## Do not

- Do not drift to the board's general topic. Stay on THIS card.
- Do not repeat or reword anything already on the board.
- Do not pad to reach four. Two excellent cards is a great answer.
- Do not hedge. "It might be worth possibly considering" is not a thought.
- Do not ask what the person has visibly already answered elsewhere.`;

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

    const { object, usage } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.7, // higher than the mapper: here we want range, not caution
      maxRetries: 4,
      prompt: `## THE CARD — this and only this is what you are expanding
[${target.type}] "${target.title}"
${target.body}

## The rest of the board — context only, NOT the topic
Use it solely to avoid repeating or contradicting what's already here.
${board}

## Connections
${links}

Suggest the next cards that follow from THE CARD above: what it makes necessary,
possible, or risky. Work from that card's own words. If a card you're about to
return could sit under a different card on a different map, don't return it.`,
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
        connectTo: [target.id],
      }));

    return Response.json({ ops, summary: object.summary, cost: await costOf(MODEL, usage) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Expand failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
