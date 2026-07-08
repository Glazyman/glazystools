import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { Analysis, ScoredComment, ScrapedPost } from "./types";

// Model IDs are plain "provider/model" strings → routed through the Vercel AI
// Gateway (one key for every provider). Override via env if you like.
const ANALYSIS_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "anthropic/claude-sonnet-4.5";
const VIDEO_MODEL =
  process.env.GRAB_IT_VIDEO_MODEL ?? "google/gemini-2.5-flash";

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB — inline limit for video parts
const MAX_COMMENTS_TO_SCORE = 200;

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
    .describe("Strong follow-up videos or add-ons that would land well."),
  draftComments: z
    .array(z.string())
    .describe(
      "Ready-to-post comments/replies that add real value the audience is looking for.",
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

// Step 3 & 4 — "Read the room" + "Get your ideas".
export async function analyzePost(post: ScrapedPost): Promise<Analysis> {
  // Resolve the transcript.
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

  const comments = post.comments.slice(0, MAX_COMMENTS_TO_SCORE);

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
    `Tasks:`,
    `1. Summarize what the video is really about.`,
    `2. Read every comment against the video. Score each one 0-100 on how much value it adds (great add-ons, ideas, corrections, sharp questions score high; spam/emoji/generic praise score low). Return one entry per comment id above.`,
    `3. Tell me what people are asking, what's missing, and the strongest follow-ups/add-ons.`,
    `4. Draft comments/replies I could post that add the value people want.`,
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
