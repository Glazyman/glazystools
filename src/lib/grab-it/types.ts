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
  type?: string; // "Video" | "Image" | "Sidecar"
  caption: string;
  author: string;
  videoUrl?: string;
  displayUrl?: string;
  likes?: number;
  commentsCount?: number;
  comments: ScrapedComment[];
};

// A single comment after Claude has scored it.
export type ScoredComment = ScrapedComment & {
  score: number; // 0-100, how much value it adds relative to the video
  category: string; // e.g. "add-on idea", "question", "praise", "spam", "critique"
  reason: string; // why it got that score
  replyIdea?: string; // a draft reply that builds on it
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
  scoredComments: ScoredComment[];
};
