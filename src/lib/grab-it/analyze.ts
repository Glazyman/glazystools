import { generateObject, generateText } from "ai";
import { z } from "zod";
import type { Analysis, ScoredComment, ScrapedPost } from "./types";

// Model IDs are plain "provider/model" strings → routed through the Vercel AI
// Gateway (one key for every provider). Defaults are the cheapest sensible
// choice (Gemini Flash for everything); override via env to trade up on quality.
//   e.g. GRAB_IT_ANALYSIS_MODEL=anthropic/claude-sonnet-4.5 for stronger ideas.
// Gemini 2.5 Flash — the only model available on the AI Gateway FREE tier
// (Pro and Claude both need paid credits). It's multimodal so it reads the
// video. Override with GRAB_IT_ANALYSIS_MODEL once you add credits.
const ANALYSIS_MODEL =
  process.env.GRAB_IT_ANALYSIS_MODEL ?? "google/gemini-2.5-flash";
const VIDEO_MODEL =
  process.env.GRAB_IT_VIDEO_MODEL ?? "google/gemini-2.5-flash";

const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // 20 MB — inline limit for video parts
// How many comments the LLM scores. We can SCRAPE thousands, but scoring every
// one would be slow and blow through the AI Gateway rate limit — so we score the
// most-engaged N by likes and show the rest (sorted by likes) unscored.
const MAX_COMMENTS_TO_SCORE = Number(
  process.env.GRAB_IT_SCORE_LIMIT ?? 300,
);

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

// Fields common to both analysis modes.
const baseFields = {
  transcript: z
    .string()
    .describe(
      "Verbatim transcript of everything spoken in the attached video (include meaningful on-screen text in [brackets]). Empty string if no video is attached or there is no speech.",
    ),
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
  buildIdeas: z
    .array(
      z.object({
        title: z
          .string()
          .describe("Short, punchy name for the thing to build or start."),
        whatItIs: z
          .string()
          .describe(
            "1-2 sentences: the business, product, service, or content this is.",
          ),
        howToBuild: z
          .array(z.string())
          .describe(
            "2-5 concrete first steps to actually build or start it — real, specific actions, not fluff.",
          ),
        insight: z
          .string()
          .describe(
            "The insight from the video and/or a specific comment this idea is based on — name what sparked it.",
          ),
        sourceCommentIds: z
          .array(z.string())
          .describe(
            "ids of the comment(s) that inspired or support this idea; empty array if it comes from the video/topic itself.",
          ),
      }),
    )
    .describe(
      "Think like a builder/entrepreneur: actionable business & build opportunities inspired by the post's TOPIC and by the ideas/experiences people shared in the comments, each with a concrete way to start. THIS IS THE POINT of the tool — be generous and specific here (aim for 3-6 strong ideas).",
    ),
  playbookCommentIds: z
    .array(z.string())
    .describe(
      "ids of comments where someone shares FIRST-HAND experience or a concrete how-to: how they actually did it, unique tactics, real numbers, what worked or failed (e.g. someone explaining how they bought and grew a plumbing business). These are the gold nuggets to mine for building. Best/most-useful first.",
    ),
  draftComments: z
    .array(z.string())
    .describe(
      "Secondary: a few ready-to-post replies that add value. Keep this short — replies are not the main goal.",
    ),
};

// Small posts: score every comment 0-100.
const scoringSchema = z.object({
  ...baseFields,
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

// Large posts: skip per-comment scoring (too many) and instead pick the comments
// most RELEVANT to the video — the ones that genuinely engage with its content.
const relevanceSchema = z.object({
  ...baseFields,
  relevantCommentIds: z
    .array(z.string())
    .describe(
      "The ids of the comments MOST RELEVANT to the video — ones that engage with its actual content: real ideas, add-ons, sharp questions, corrections, insights. Exclude spam, emoji-only, tag-a-friend, and generic praise. Best/most-relevant first, up to ~40.",
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

// Transcribe the video in the SAME call as the analysis (default on). Doing it
// as one combined request — instead of a separate transcription call followed by
// an analysis call — halves the rate-limit exposure that was breaking full runs.
// Set GRAB_IT_TRANSCRIBE_VIDEO=0 to skip the video entirely (caption only).
const TRANSCRIBE_IN_ANALYSIS = process.env.GRAB_IT_TRANSCRIBE_VIDEO !== "0";

type VideoFilePart = { type: "file"; mediaType: "video/mp4"; data: Buffer };

// Download the video as an inline file part, or null if unavailable/too big.
async function loadVideoPart(
  videoUrl: string,
): Promise<VideoFilePart | null> {
  try {
    const res = await fetch(videoUrl);
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len && len > MAX_VIDEO_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_VIDEO_BYTES) return null;
    return { type: "file", mediaType: "video/mp4", data: buf };
  } catch {
    return null;
  }
}

// Above this many comments, per-comment scoring is too big/slow (and blows the
// rate limit), so we switch to a "most relevant to the video" shortlist instead.
const SCORE_THRESHOLD = Number(process.env.GRAB_IT_SCORE_THRESHOLD ?? 50);

// Step 2, 3 & 4 combined — transcribe + read the room + get ideas, in one call.
export async function analyzePost(post: ScrapedPost): Promise<Analysis> {
  // Drop junk for free, most-engaged first, cap what the model sees.
  const meaningful = post.comments
    .filter((c) => !isJunk(c.text))
    .sort((a, b) => b.likes - a.likes);
  const comments = meaningful.slice(0, MAX_COMMENTS_TO_SCORE);

  // Small enough → score each; too many → relevance shortlist only.
  const scoringMode: Analysis["scoringMode"] =
    comments.length <= SCORE_THRESHOLD ? "scored" : "relevant";

  const isVideo = post.kind === "video";
  const noun = isVideo ? "video" : "post";

  // Attach the actual video so the model transcribes it in the same request.
  const videoPart =
    TRANSCRIBE_IN_ANALYSIS && isVideo && post.videoUrl
      ? await loadVideoPart(post.videoUrl)
      : null;
  const hasVideo = !!videoPart;

  const commentTask =
    scoringMode === "scored"
      ? `Read every comment against the ${noun}. Score each 0-100 on how much value/insight it adds (great add-ons, ideas, corrections, sharp questions score high; spam/emoji/generic praise score low). Return one scoredComments entry per comment id above.`
      : `There are too many comments to score individually. Instead, pick the ones MOST RELEVANT to the ${noun} — comments that genuinely engage with its content (real ideas, add-ons, sharp questions, corrections, insights). Return their ids in relevantCommentIds, best first (up to ~40). Skip spam, emoji, tag-a-friend, and generic praise.`;

  const prompt = [
    `You are a sharp builder/entrepreneur's research partner. Your job: mine this ${noun} AND its comments for BUSINESS IDEAS, opportunities, and inspiration for things to BUILD — then lay out how to actually start them.`,
    ``,
    `AUTHOR: @${post.author}`,
    `CAPTION: ${post.caption || "(none)"}`,
    ``,
    hasVideo
      ? `The ${noun}'s video is attached. First transcribe everything spoken in it into the "transcript" field, then use that transcript (plus the caption + comments) for the rest.`
      : post.caption
        ? `No video is attached — use this ${noun}'s text as the "transcript": ${post.caption}`
        : `No video or text is available — leave "transcript" empty and reason about the comments only.`,
    ``,
    `COMMENTS (${comments.length} of ${post.commentsCount ?? comments.length}) — id | @author | likes | text:`,
    ...comments.map(
      (c) => `${c.id} | @${c.author} | ${c.likes} | ${c.text.replace(/\n/g, " ")}`,
    ),
    ``,
    `What I care about most: (a) BUILD IDEAS — concrete businesses/products/content I could create based on the topic and on what people shared, each with real first steps; and (b) the GOLD-NUGGET comments where someone shares how they actually did something — their first-hand experience, unique tactics, numbers, what worked (e.g. on a reel about buying a plumbing business, a commenter explaining exactly how they bought and grew theirs). Surface those, don't let them get buried.`,
    ``,
    `Tasks:`,
    `1. ${hasVideo ? "Transcribe the video, then summarize" : "Summarize"} what this ${noun} is really about.`,
    `2. ${commentTask}`,
    `3. Generate strong, specific buildIdeas (the main event) with concrete how-to steps, and flag the playbook/first-hand-experience comments in playbookCommentIds.`,
    `4. Also pull the best ideas & add-ons commenters surfaced, what people are asking, and what's missing.`,
    `5. Only briefly: a few draft replies I could post. Keep this minimal.`,
  ].join("\n");

  const content: Array<{ type: "text"; text: string } | VideoFilePart> =
    hasVideo
      ? [{ type: "text", text: prompt }, videoPart]
      : [{ type: "text", text: prompt }];

  const { object } = await generateObject({
    model: ANALYSIS_MODEL,
    schema: scoringMode === "scored" ? scoringSchema : relevanceSchema,
    maxRetries: 4, // ride out transient rate limits with backoff
    messages: [{ role: "user", content }],
  });

  // Resolve the transcript: model output if we sent a video, else the caption.
  let transcript = object.transcript?.trim() ?? "";
  let transcriptSource: Analysis["transcriptSource"];
  if (hasVideo && transcript) {
    transcriptSource = "video";
  } else if (post.caption) {
    transcript = transcript || post.caption;
    transcriptSource = "captions";
  } else {
    transcriptSource = "unavailable";
  }

  const byId = new Map(comments.map((c) => [c.id, c]));
  let scoredComments: ScoredComment[] = [];
  let relevantCommentIds: string[] = [];

  if (scoringMode === "scored" && "scoredComments" in object) {
    scoredComments = object.scoredComments
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
  } else if ("relevantCommentIds" in object) {
    // Keep only ids that map to real comments, preserving the model's order.
    relevantCommentIds = object.relevantCommentIds.filter((id) => byId.has(id));
  }

  // Keep only comment-id references that map to real comments.
  const buildIdeas = (object.buildIdeas ?? []).map((b) => ({
    title: b.title,
    whatItIs: b.whatItIs,
    howToBuild: b.howToBuild ?? [],
    insight: b.insight,
    sourceCommentIds: (b.sourceCommentIds ?? []).filter((id) => byId.has(id)),
  }));
  const playbookCommentIds = (object.playbookCommentIds ?? []).filter((id) =>
    byId.has(id),
  );

  return {
    transcript,
    transcriptSource,
    videoSummary: object.videoSummary,
    audienceQuestions: object.audienceQuestions,
    gaps: object.gaps,
    followUpIdeas: object.followUpIdeas,
    draftComments: object.draftComments,
    buildIdeas,
    playbookCommentIds,
    scoredComments,
    scoringMode,
    relevantCommentIds,
  };
}
