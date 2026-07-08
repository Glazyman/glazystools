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
    "You are a sharp assistant helping a creator understand an Instagram video and its comments, and mine them for ideas.",
    "Answer using ONLY the video transcript, summary, and comments provided below. If something isn't covered, say so plainly. Be concise and concrete.",
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
