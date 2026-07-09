import { google } from "@ai-sdk/google";
import { streamText, type ToolSet } from "ai";

export const maxDuration = 60;

// Chat models, via the AI Gateway. Free default is Gemini Flash (the only
// free-tier model, and it can Google-search). "Use Claude" switches to Claude
// Sonnet 5 for that message — needs AI Gateway credits (and loses web search,
// which is Gemini-only).
const CHAT_MODEL = process.env.GRAB_IT_CHAT_MODEL ?? "google/gemini-2.5-flash";
const CHAT_CLAUDE_MODEL =
  process.env.GRAB_IT_IDEAS_MODEL ?? "anthropic/claude-sonnet-5";

type ChatContext = {
  author?: string;
  summary?: string;
  transcript?: string;
  transcriptSource?: string;
  ideas?: string[];
  comments?: { author: string; text: string; likes: number; score: number }[];
  focused?: { author: string; text: string } | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildSystem(ctx: ChatContext): string {
  const lines = [
    "You are a sharp builder/entrepreneur's brainstorming partner. The user is analyzing a video/post and its comments to find BUSINESS IDEAS, inspiration, and things to BUILD.",
    "The transcript, summary, surfaced build-ideas, and comments below are your PRIMARY context — ground answers in them and reference them (especially comments where someone shares first-hand how they did something).",
    "Lean into helping the user CREATE and act: flesh out ideas, pressure-test them, map out concrete steps, tools, costs, and first moves. When they point at a comment or idea, help them build on it.",
    "You are NOT restricted to this post. Use your own general knowledge freely and search the web (Google Search) when a question needs current, factual, or outside info — then answer with what you found. Never refuse just because something isn't in the transcript.",
    "Be concise, concrete, and practical. Give real steps, examples, numbers, and tools — not vague encouragement.",
    "",
    `VIDEO by @${ctx.author ?? "unknown"}`,
    `SUMMARY: ${ctx.summary ?? "(none)"}`,
    ctx.ideas?.length
      ? `BUILD IDEAS ALREADY SURFACED:\n${ctx.ideas.map((i) => `- ${i}`).join("\n")}`
      : "",
    "",
    ctx.transcript
      ? `TRANSCRIPT (${ctx.transcriptSource ?? "unknown"}):\n${ctx.transcript}`
      : "TRANSCRIPT: (unavailable)",
    "",
  ];
  if (ctx.comments?.length) {
    lines.push(
      `COMMENTS (${ctx.comments.length}, shown as @author | likes | score | text):`,
      ...ctx.comments.map(
        (c) => `@${c.author} | ${c.likes} | ${c.score} | ${c.text.replace(/\n/g, " ")}`,
      ),
      "",
    );
  }
  if (ctx.focused) {
    lines.push(
      `The user is asking specifically about this comment — @${ctx.focused.author}: "${ctx.focused.text}"`,
      "",
    );
  }
  return lines.join("\n");
}

export async function POST(req: Request) {
  try {
    const { messages, context, useClaude } = (await req.json()) as {
      messages: ChatMessage[];
      context: ChatContext;
      useClaude?: boolean;
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "No messages." }, { status: 400 });
    }
    const model = useClaude ? CHAT_CLAUDE_MODEL : CHAT_MODEL;
    // Google Search grounding — lets Gemini look things up on the web. Only
    // attach it for Google models (Claude can't use it). Cast bridges a generic
    // mismatch between @ai-sdk/google and ai core; the shape is correct at runtime.
    const tools = model.startsWith("google/")
      ? ({ google_search: google.tools.googleSearch({}) } as unknown as ToolSet)
      : undefined;
    const result = streamText({
      model,
      system: buildSystem(context ?? {}),
      messages,
      tools,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
