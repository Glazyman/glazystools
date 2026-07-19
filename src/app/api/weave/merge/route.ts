// Weave — merge several cards into one.
//
// The inverse of split: the user selected two or more cards and asked for them
// to become a single card. The model's only job is the TEXT — one type, title,
// and body that carry everything the chosen cards said. The structural half
// (which card survives, re-pointing edges and transcript links) happens on the
// client, deterministically, so a slow or flaky model response can never leave
// the board half-merged.

import { generateObject } from "ai";
import { z } from "zod";
import { normalizeType } from "@/lib/weave/types";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_MERGE_MODEL ?? "google/gemini-2.5-flash";

const ResultSchema = z.object({
  summary: z
    .string()
    .describe(
      'One short sentence: what the merged card now holds, e.g. "Merged the idea with its two risks."',
    ),
  merged: z.object({
    type: z
      .string()
      .describe(
        'What the combined card IS, one short lowercase word: idea / action / question / fact / decision when they fit, or the truer word ("risk", "goal", "metric", "constraint") when they don\'t. If every source card shares a type, keep it.',
      ),
    title: z
      .string()
      .describe("3-9 words naming the combined point. Required."),
    body: z
      .string()
      .describe(
        "Every point the source cards made, as tight prose. A few sentences is fine; losing a point is not.",
      ),
  }),
});

const SYSTEM = `You merge SEVERAL cards on a thought-map into ONE card.

The user selected these cards and asked for them to become a single card, so
there is no "prefer doing nothing" here — they were ALREADY judged to belong
together by the person reading them. Combine them.

## Rules

- Every distinct point the source cards carry must survive in the merged card.
  Fold duplicates and overlaps into one statement; never drop a point that
  only one card made.
- Add NOTHING. The merged card may not say anything the source cards didn't
  already say between them.
- Write it as one coherent card, not a stapled list: lead with the point the
  cards share, then the detail. Only fall back to short lines when the points
  genuinely don't flow as prose.
- title names the COMBINED point in 3-9 words — not "Card A and Card B".
- type is what the combined card IS, one short lowercase word. If every source
  card shares a type, keep it; otherwise pick the truest word for the whole.`;

type Body = {
  cards?: { id: string; type: string; title: string; body: string }[];
};

export async function POST(req: Request) {
  try {
    const { cards = [] } = (await req.json()) as Body;
    if (cards.length < 2) {
      return Response.json(
        { error: "Merging needs at least two cards." },
        { status: 400 },
      );
    }

    const listed = cards
      .map((c) => `- [${c.type}] "${c.title}" — ${c.body || "(no body)"}`)
      .join("\n");

    const { object, usage } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.2,
      maxRetries: 4,
      prompt: `## THE CARDS to merge (${cards.length})
${listed}

Merge them into one card. Every point must survive; nothing may be added.`,
    });

    return Response.json({
      merged: {
        type: normalizeType(object.merged.type),
        title: object.merged.title,
        body: object.merged.body,
      },
      summary: object.summary,
      cost: await costOf(MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Merge failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
