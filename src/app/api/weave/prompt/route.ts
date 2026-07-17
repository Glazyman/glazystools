// Weave — cards in, ONE build prompt out.
//
// The board is where ideas land; this is how they leave. The user selects the
// cards that describe a thing worth building and gets back a single prompt
// they can paste into an AI coding agent. The output is a deliverable, not
// analysis — the whole job is compression without loss.

import { generateObject } from "ai";
import { z } from "zod";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_PROMPT_MODEL ?? "google/gemini-2.5-flash";

// Composition, not judgment — thinking buys nothing here and costs seconds.
const PROVIDER_OPTIONS = MODEL.startsWith("google/")
  ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
  : undefined;

const ResultSchema = z.object({
  title: z
    .string()
    .describe('3-6 words naming the deliverable, e.g. "Parlay app build prompt".'),
  prompt: z
    .string()
    .describe("The complete build prompt, ready to paste. Nothing around it."),
});

const SYSTEM = `You turn selected cards from a thought-map into ONE build
prompt — the text the user will paste into an AI coding agent to build the
thing the cards describe.

Shape:
- Open with one sentence: what to build. Direct and imperative ("Build a…").
- Then the essentials as short bullets, grouped only if it helps: features,
  constraints, pricing/model, and risks the build must handle.
- Close with nothing. No sign-off, no "let me know".

Rules:
- ONLY what the cards say. You compress; you never invent requirements,
  tech-stack choices, or scope the cards don't contain.
- The connections tell you what belongs to what — a risk hanging off a feature
  is a constraint on that feature, not a general worry.
- Plain imperative language. No preamble, no "You are an AI", no restating
  these instructions.
- Tight. Under ~200 words unless the cards genuinely carry more than that.`;

type Body = {
  cards?: { id: string; type: string; title: string; body: string }[];
  edges?: { source: string; target: string; label?: string }[];
};

export async function POST(req: Request) {
  try {
    const { cards = [], edges = [] } = (await req.json()) as Body;

    if (cards.length === 0) {
      return Response.json({ error: "No cards selected." }, { status: 400 });
    }

    const board = cards
      .map((c) => `- id:${c.id} [${c.type}] "${c.title}" — ${c.body}`)
      .join("\n");

    const links =
      edges.length === 0
        ? "(none)"
        : edges
            .map(
              (e) =>
                `- ${e.source} -> ${e.target}${e.label ? ` (${e.label})` : ""}`,
            )
            .join("\n");

    const { object, usage } = await generateObject({
      model: MODEL,
      schema: ResultSchema,
      system: SYSTEM,
      temperature: 0.3,
      providerOptions: PROVIDER_OPTIONS,
      maxRetries: 4,
      prompt: `## The selected cards (${cards.length})
${board}

## Connections between them
${links}

Write the build prompt.`,
    });

    return Response.json({
      title: object.title,
      prompt: object.prompt,
      cost: await costOf(MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Prompt failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
