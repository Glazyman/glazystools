import { google } from "@ai-sdk/google";
import { generateObject, generateText, type ToolSet } from "ai";
import { z } from "zod";

export const maxDuration = 60;

// On the AI Gateway FREE tier, only Gemini Flash is available (Pro and Claude
// both require paid credits). So the free path uses Flash (which can also
// Google-search); toggling "Use Claude" upgrades the write-up to Claude and
// needs credits — we fall back to Flash automatically if they're not active.
const RESEARCH_MODEL =
  process.env.GRAB_IT_RESEARCH_MODEL ?? "google/gemini-2.5-flash";
const FREE_IDEAS_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";
const CLAUDE_MODEL =
  process.env.GRAB_IT_IDEAS_MODEL ?? "anthropic/claude-sonnet-5";

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
    const { context, existing, round, useClaude, count, seeds } =
      (await req.json()) as {
        context: Ctx;
        existing: string[];
        round: number;
        useClaude?: boolean;
        count?: number;
        seeds?: { author: string; text: string }[];
      };
    const n = Math.max(1, Math.min(4, Math.round(Number(count) || 3)));

    const level = BREADTH[Math.min(round ?? 0, BREADTH.length - 1)];
    const comments = (context.comments ?? []).slice(0, 40).join("\n");
    const avoid =
      existing?.length > 0
        ? existing.map((t) => `- ${t}`).join("\n")
        : "(none yet)";

    const researchPrompt = [
      "You are an entrepreneurial research analyst. Use web search to ground your thinking in CURRENT, real market context (existing tools, competitors, demand signals, how others have done it).",
      `Brainstorm exactly ${n} genuinely DISTINCT build/business ideas a creator could act on.`,
      seeds && seeds.length > 0
        ? `\nFOCUS: Base EVERY idea on the COMBINATION of these selected comment${
            seeds.length === 1 ? "" : "s"
          } — their angles, needs, and insights (weave them together where it makes sense) — using the video below only as background:\n${seeds
            .map((s) => `@${s.author}: "${s.text}"`)
            .join("\n")}\n`
        : "",
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

    // Step 1 — research with Google Search grounding (free Flash).
    const tools = RESEARCH_MODEL.startsWith("google/")
      ? ({ google_search: google.tools.googleSearch({}) } as unknown as ToolSet)
      : undefined;
    const research = await generateText({
      model: RESEARCH_MODEL,
      tools,
      maxRetries: 3,
      prompt: researchPrompt,
    });

    // Step 2 — write the ideas up. Claude when requested (paid), else Flash.
    const structurePrompt = `From the following idea research, produce polished, distinct build ideas. For each: a punchy title, what it is (1-2 sentences), 3-5 concrete realistic first steps, and the key insight it's based on. Keep the strongest ideas; sharpen the reasoning; don't invent ideas unrelated to the research.\n\n${research.text}`;

    const runStructure = (model: string) =>
      generateObject({ model, schema, maxRetries: 2, prompt: structurePrompt });

    let usedModel = useClaude ? CLAUDE_MODEL : FREE_IDEAS_MODEL;
    let fellBack = false;
    let object;
    try {
      ({ object } = await runStructure(usedModel));
    } catch (e) {
      // Claude blocked (no credits) → fall back to the free model.
      if (useClaude) {
        fellBack = true;
        usedModel = FREE_IDEAS_MODEL;
        ({ object } = await runStructure(usedModel));
      } else {
        throw e;
      }
    }

    return Response.json({
      ideas: object.ideas,
      usedClaude: useClaude && !fellBack,
      fellBack,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate.";
    return Response.json({ error: message }, { status: 500 });
  }
}
