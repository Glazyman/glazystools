import { google } from "@ai-sdk/google";
import { streamText, type ToolSet } from "ai";

export const maxDuration = 60;

// Chat model, via the AI Gateway. Defaults to Gemini Flash because the Gateway
// FREE tier blocks premium models (Claude Sonnet returns a 403). Once you add
// Gateway credits, switch to Claude with:
//   GRAB_IT_CHAT_MODEL=anthropic/claude-sonnet-4.5
const CHAT_MODEL = process.env.GRAB_IT_CHAT_MODEL ?? "google/gemini-2.5-flash";

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
    const { messages, context } = (await req.json()) as {
      messages: ChatMessage[];
      context: ChatContext;
    };
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "No messages." }, { status: 400 });
    }
    // Google Search grounding — lets Gemini look things up on the web for
    // current/outside info. Only attach it for Google models (the tool is
    // provider-executed by Gemini; the call still routes via the AI Gateway).
    const useSearch = CHAT_MODEL.startsWith("google/");
    // Cast bridges a generic mismatch between @ai-sdk/google and ai core; the
    // tool shape is correct at runtime.
    const tools = useSearch
      ? ({ google_search: google.tools.googleSearch({}) } as unknown as ToolSet)
      : undefined;
    const result = streamText({
      model: CHAT_MODEL,
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
