// Shared types for the Grab It tool.

export type ScrapedComment = {
  id: string;
  text: string;
  author: string;
  likes: number;
  timestamp?: string;
  replyCount?: number;
};

export type ScrapedPost = {
  url: string;
  shortcode?: string;
  type?: string; // raw platform type, e.g. "Video" | "Image" | "Sidecar"
  kind: "video" | "image" | "text"; // normalized: does it actually have a video?
  caption: string;
  author: string;
  videoUrl?: string;
  displayUrl?: string;
  likes?: number;
  commentsCount?: number;
  comments: ScrapedComment[];
  // How the comments were fetched, so the UI can be honest about it.
  commentSource?: "login" | "logged-out";
};

// A single comment after Claude has scored it.
export type ScoredComment = ScrapedComment & {
  score: number; // 0-100, how much value it adds relative to the video
  category: string; // e.g. "add-on idea", "question", "praise", "spam", "critique"
  reason: string; // why it got that score
  replyIdea?: string; // a draft reply that builds on it
};

// An actionable thing to build/start, inspired by the post's topic AND the
// ideas/experiences people shared in the comments. The heart of the tool.
export type BuildIdea = {
  title: string; // short punchy name for the thing to build
  whatItIs: string; // 1-2 sentences on the business/product/content
  howToBuild: string[]; // concrete first steps to actually start it
  insight: string; // the video/comment insight this is based on
  sourceCommentIds: string[]; // comments that inspired/support it (may be empty)
  model?: string; // which model produced it, e.g. "Claude" or "Gemini Flash"
};

// Cross-run analysis when combining multiple saved videos.
export type CombinedAnalysis = {
  overview: string; // the through-line across the videos
  sharedThemes: string[]; // themes/questions that recur across videos
  audiencePatterns: string[]; // what the audience consistently wants
  topIdeas: string[]; // strongest ideas across the whole set
  contentGaps: string[]; // gaps spanning the videos
  nextMoves: string[]; // concrete next content that combines the insights
};

export type Analysis = {
  transcript: string;
  transcriptSource: "captions" | "video" | "unavailable";
  videoSummary: string; // what the video is actually about
  audienceQuestions: string[]; // what people are asking
  gaps: string[]; // what's missing / what people want more of
  followUpIdeas: string[]; // strong follow-ups or add-ons to make
  draftComments: string[]; // value-adding comments/replies you could post
  // Business/build opportunities inspired by the topic + the comments — with a
  // concrete "how to start" for each. The main event for building/brainstorming.
  buildIdeas: BuildIdea[];
  // Comment ids where someone shares FIRST-HAND experience or a concrete how-to
  // (how they did it, unique tactics, numbers) — the gold nuggets to mine.
  playbookCommentIds: string[];
  // Full per-comment scoring — only when there aren't too many comments.
  scoredComments: ScoredComment[];
  // Whether every comment was scored, or we switched to a relevance shortlist
  // because there were too many.
  scoringMode: "scored" | "relevant";
  // The comment ids the model judged most relevant to the video (used when
  // there are too many comments to score each one).
  relevantCommentIds: string[];
};
