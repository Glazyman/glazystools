import { generateObject } from "ai";
import { z } from "zod";

export const maxDuration = 120;

const MODEL = process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";
const MAX_COMMENTS_PER_RUN = 40;

type RunInput = {
  author: string;
  url: string;
  summary: string;
  transcript?: string;
  comments: { author: string; text: string; likes: number; score: number }[];
};

const schema = z.object({
  overview: z
    .string()
    .describe("2-4 sentences: the through-line connecting these videos."),
  sharedThemes: z
    .array(z.string())
    .describe("Themes, questions, or reactions that recur ACROSS the videos."),
  audiencePatterns: z
    .array(z.string())
    .describe("What this audience consistently wants or responds to."),
  topIdeas: z
    .array(z.string())
    .describe(
      "The strongest ideas/add-ons across the whole set. Note which video each came from where useful.",
    ),
  contentGaps: z
    .array(z.string())
    .describe("Gaps or unmet requests that span the videos."),
  nextMoves: z
    .array(z.string())
    .describe(
      "Concrete next content ideas that COMBINE insights from multiple videos.",
    ),
});

export async function POST(req: Request) {
  try {
    const { runs } = (await req.json()) as { runs: RunInput[] };
    if (!Array.isArray(runs) || runs.length < 2) {
      return Response.json(
        { error: "Select at least two saved runs to combine." },
        { status: 400 },
      );
    }

    const blocks = runs.map((r, i) => {
      const comments = [...r.comments]
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_COMMENTS_PER_RUN);
      return [
        `=== VIDEO ${i + 1} — @${r.author} (${r.url}) ===`,
        `Summary: ${r.summary}`,
        r.transcript ? `Transcript: ${r.transcript}` : `Transcript: (none)`,
        `Top comments (@author | likes | score | text):`,
        ...comments.map(
          (c) =>
            `@${c.author} | ${c.likes} | ${c.score} | ${c.text.replace(/\n/g, " ")}`,
        ),
      ].join("\n");
    });

    const prompt = [
      `I'm a creator cross-referencing ${runs.length} of my videos and their comments. Analyze them TOGETHER — I want patterns and ideas that span the videos, not a per-video recap.`,
      ``,
      ...blocks,
      ``,
      `Find the through-line, recurring themes, what my audience consistently wants, the best ideas across all of them, gaps, and concrete next content that combines these insights.`,
    ].join("\n");

    const { object } = await generateObject({ model: MODEL, schema, prompt });
    return Response.json({ combined: object });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Combine failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
