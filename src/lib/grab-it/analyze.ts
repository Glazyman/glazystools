import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { Analysis, ScoredComment, ScrapedPost } from "./types";

// Model IDs are plain "provider/model" strings → routed through the Vercel AI
// Gateway (one key for every provider). Defaults are the cheapest sensible
// choice (Gemini Flash for everything); override via env to trade up on quality.
//   e.g. GRAB_IT_ANALYSIS_MODEL=anthropic/claude-sonnet-4.5 for stronger ideas.
const ANALYSIS_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";
const VIDEO_MODEL =
  process.env.GRAB_IT_VIDEO_MODEL ?? "google/gemini-2.5-flash";

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB — inline limit for video parts
const MAX_COMMENTS_TO_SCORE = 200;

// Free pre-filter: drop comments the model would score ~0 anyway (emoji-only,
// pure @mention/#hashtag tags, empty). Saves tokens without losing signal —
// anything with actual words is kept. Instagram's "tag-a-friend" spam is a huge
// share of comments, so this trims a lot before the LLM ever sees it.
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}️‍\s]+$/u;

function isJunk(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (EMOJI_ONLY.test(t)) return true;
  // Remove @mentions and #hashtags; if no real letters/numbers remain, it's a tag.
  const meaningful = t
    .replace(/[@#][\w.]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return meaningful.length < 2;
}

// Step 2 — "Understand it": get the words the video actually says.
// Reels rarely ship a transcript, so we send the video to a multimodal model.
async function transcribeVideo(
  videoUrl: string,
): Promise<{ transcript: string; source: "video" } | null> {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len && len > MAX_VIDEO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_VIDEO_BYTES) return null;

    const { text } = await generateText({
      model: VIDEO_MODEL,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Transcribe everything spoken in this video, verbatim. If there is on-screen text that carries meaning, include it in [brackets]. Return only the transcript, no preamble.",
            },
            { type: "file", mediaType: "video/mp4", data: buf },
          ],
        },
      ],
    });
    const transcript = text.trim();
    return transcript ? { transcript, source: "video" } : null;
  } catch {
    return null;
  }
}

const analysisSchema = z.object({
  videoSummary: z
    .string()
    .describe("2-4 sentences on what the video is actually about."),
  audienceQuestions: z
    .array(z.string())
    .describe("Distinct things people in the comments are asking about."),
  gaps: z
    .array(z.string())
    .describe("What the video left out or what people want more of."),
  followUpIdeas: z
    .array(z.string())
    .describe(
      "The best ideas, add-ons, and improvements surfaced BY the commenters (or clearly implied by what they're asking) — the gold worth mining. Prioritize concrete ideas people actually raised over generic suggestions.",
    ),
  draftComments: z
    .array(z.string())
    .describe(
      "Secondary: a few ready-to-post replies that add value. Keep this short — replies are not the main goal.",
    ),
  scoredComments: z.array(
    z.object({
      id: z.string(),
      score: z
        .number()
        .describe(
          "0-100: how much genuine value/insight this comment adds relative to the video. Spam/emoji-only = low, great add-ons/ideas/corrections = high.",
        ),
      category: z
        .string()
        .describe(
          'One of: "add-on idea", "question", "insight", "critique", "praise", "spam".',
        ),
      reason: z.string().describe("One short line on why it scored that way."),
      replyIdea: z
        .string()
        .describe(
          "A short draft reply that builds on this comment, or empty string if not worth replying.",
        ),
    }),
  ),
});

// Step 2 alone — resolve just the transcript (used by "transcript only" mode).
export async function transcribePost(post: ScrapedPost): Promise<{
  transcript: string;
  transcriptSource: Analysis["transcriptSource"];
}> {
  let transcript = "";
  let transcriptSource: Analysis["transcriptSource"] = "unavailable";
  if (post.videoUrl) {
    const t = await transcribeVideo(post.videoUrl);
    if (t) {
      transcript = t.transcript;
      transcriptSource = t.source;
    }
  }
  if (!transcript && post.caption) {
    transcript = post.caption;
    transcriptSource = "captions";
  }
  return { transcript, transcriptSource };
}

// Step 3 & 4 — "Read the room" + "Get your ideas".
export async function analyzePost(post: ScrapedPost): Promise<Analysis> {
  const { transcript, transcriptSource } = await transcribePost(post);

  // Drop junk for free, then cap what the model scores.
  const meaningful = post.comments.filter((c) => !isJunk(c.text));
  const comments = meaningful.slice(0, MAX_COMMENTS_TO_SCORE);

  const prompt = [
    `You are helping a creator mine the comments on an Instagram ${post.type ?? "post"} for great ideas and add-ons.`,
    ``,
    `AUTHOR: @${post.author}`,
    `CAPTION: ${post.caption || "(none)"}`,
    ``,
    transcriptSource === "unavailable"
      ? `VIDEO TRANSCRIPT: (unavailable — reason about the caption + comments only)`
      : `VIDEO TRANSCRIPT (${transcriptSource}):\n${transcript}`,
    ``,
    `COMMENTS (${comments.length} of ${post.commentsCount ?? comments.length}) — id | @author | likes | text:`,
    ...comments.map(
      (c) => `${c.id} | @${c.author} | ${c.likes} | ${c.text.replace(/\n/g, " ")}`,
    ),
    ``,
    `My main goal: mine the comments for good ideas and add-ons — NOT to write replies. Replies are a nice-to-have afterthought.`,
    ``,
    `Tasks:`,
    `1. Summarize what the video is really about.`,
    `2. Read every comment against the video. Score each 0-100 on how much value/insight it adds (great add-ons, ideas, corrections, sharp questions score high; spam/emoji/generic praise score low). Return one entry per comment id above.`,
    `3. Pull out the best ideas & add-ons the commenters surfaced (this is the point), plus what people are asking and what's missing.`,
    `4. Only briefly: a few draft replies I could post. Keep this minimal.`,
  ].join("\n");

  const { object } = await generateObject({
    model: ANALYSIS_MODEL,
    schema: analysisSchema,
    prompt,
  });

  // Merge Claude's scores back onto the full comment objects by id.
  const byId = new Map(comments.map((c) => [c.id, c]));
  const scoredComments: ScoredComment[] = object.scoredComments
    .flatMap((s): ScoredComment[] => {
      const base = byId.get(s.id);
      if (!base) return [];
      return [
        {
          ...base,
          score: Math.max(0, Math.min(100, Math.round(s.score))),
          category: s.category,
          reason: s.reason,
          replyIdea: s.replyIdea?.trim() || undefined,
        },
      ];
    })
    .sort((a, b) => b.score - a.score);

  return {
    transcript,
    transcriptSource,
    videoSummary: object.videoSummary,
    audienceQuestions: object.audienceQuestions,
    gaps: object.gaps,
    followUpIdeas: object.followUpIdeas,
    draftComments: object.draftComments,
    scoredComments,
  };
}
