import { google } from "@ai-sdk/google";
import { generateObject, generateText, type ToolSet } from "ai";
import { z } from "zod";

export const maxDuration = 60;

// Research/ideation uses a stronger reasoning model (Gemini 2.5 Pro) for better
// quality; the cheap Flash structures the result. Both overridable via env.
// For the best results, add AI Gateway credits and set:
//   GRAB_IT_IDEAS_MODEL=anthropic/claude-sonnet-4.5
const RESEARCH_MODEL =
  process.env.GRAB_IT_IDEAS_MODEL ?? "google/gemini-2.5-pro";
const STRUCTURE_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";

const IDEAS_PER_REQUEST = 3;

// Each successive request goes broader — from obvious/on-topic to ambitious and
// cross-industry — so "generate more" keeps surfacing new territory.
const BREADTH = [
  "Focus on the most obvious, high-confidence opportunities directly tied to the video and its comments.",
  "Go broader: adjacent products, services, tools, and audiences around this topic.",
  "Broader still: different business models, monetization angles, and markets that share the same underlying insight.",
  "Ambitious and cross-industry: bolder, less-obvious plays, platforms, and moonshots that extend the core insight well beyond the original niche.",
];

type Ctx = {
  author?: string;
  summary?: string;
  transcript?: string;
  comments?: string[];
};

const schema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe("Short, punchy name for the thing to build."),
      whatItIs: z
        .string()
        .describe("1-2 sentences: the business/product/service/content."),
      howToBuild: z
        .array(z.string())
        .describe("3-5 concrete, realistic first steps to actually start it."),
      insight: z
        .string()
        .describe(
          "The insight (from the video, a comment, or market research) this is based on.",
        ),
    }),
  ),
});

export async function POST(req: Request) {
  try {
    const { context, existing, round } = (await req.json()) as {
      context: Ctx;
      existing: string[];
      round: number;
    };

    const level = BREADTH[Math.min(round ?? 0, BREADTH.length - 1)];
    const comments = (context.comments ?? []).slice(0, 40).join("\n");
    const avoid =
      existing?.length > 0
        ? existing.map((t) => `- ${t}`).join("\n")
        : "(none yet)";

    const researchPrompt = [
      "You are an entrepreneurial research analyst. Use web search to ground your thinking in CURRENT, real market context (existing tools, competitors, demand signals, how others have done it).",
      `Brainstorm ${IDEAS_PER_REQUEST} genuinely DISTINCT build/business ideas a creator could act on.`,
      "",
      `VIDEO by @${context.author ?? "unknown"}`,
      `SUMMARY: ${context.summary ?? "(none)"}`,
      context.transcript
        ? `TRANSCRIPT (excerpt):\n${context.transcript.slice(0, 3000)}`
        : "TRANSCRIPT: (unavailable)",
      "",
      comments ? `TOP COMMENTS:\n${comments}` : "",
      "",
      "ALREADY SUGGESTED — do NOT repeat or lightly reword these:",
      avoid,
      "",
      `BREADTH FOR THIS ROUND: ${level}`,
      "",
      "For each idea: search the web for the real landscape, then give a punchy title, what it is (1-2 sentences), 3-5 concrete and realistic first steps to build/start it, and the key insight it's based on (name what — from the video, a comment, or the market — sparked it). Prefer ideas with real demand signals over generic ones. Write each idea out clearly.",
    ].join("\n");

    // Step 1 — research + ideate with Google Search grounding.
    const tools = RESEARCH_MODEL.startsWith("google/")
      ? ({ google_search: google.tools.googleSearch({}) } as unknown as ToolSet)
      : undefined;
    const research = await generateText({
      model: RESEARCH_MODEL,
      tools,
      maxRetries: 3,
      prompt: researchPrompt,
    });

    // Step 2 — structure the research into clean idea cards.
    const { object } = await generateObject({
      model: STRUCTURE_MODEL,
      schema,
      maxRetries: 3,
      prompt: `Convert the following idea research into structured data. Keep every distinct idea; extract title, whatItIs, howToBuild (array of steps), and insight. Do not invent ideas that aren't in the research.\n\n${research.text}`,
    });

    return Response.json({ ideas: object.ideas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate.";
    return Response.json({ error: message }, { status: 500 });
  }
}
