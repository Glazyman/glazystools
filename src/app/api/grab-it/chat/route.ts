import { streamText } from "ai";

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
  comments?: { author: string; text: string; likes: number; score: number }[];
  focused?: { author: string; text: string } | null;
};

type ChatMessage = { role: "user" | "assistant"; content: string };

function buildSystem(ctx: ChatContext): string {
  const lines = [
    "You are a sharp, genuinely helpful assistant for a creator analyzing a video/post and its comments.",
    "The transcript, summary, and comments below are your PRIMARY context — ground answers in them and reference them when relevant.",
    "You are NOT restricted to them. When the user wants to go further — explain a concept from the comments, expand on an idea, brainstorm, compare to other things, or figure out HOW TO BUILD or act on something — use your own general knowledge freely and help fully. Never refuse just because something isn't in the transcript; only flag the source distinction when it genuinely matters (e.g. 'the comments don't say, but here's how it generally works').",
    "Be concise, concrete, and practical. Give real steps, examples, and tools when asked how to do or build something.",
    "",
    `VIDEO by @${ctx.author ?? "unknown"}`,
    `SUMMARY: ${ctx.summary ?? "(none)"}`,
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
    const result = streamText({
      model: CHAT_MODEL,
      system: buildSystem(context ?? {}),
      messages,
    });
    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chat failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
