import { createClient } from "@/lib/supabase/client";
import type { Analysis, ScrapedPost } from "./types";

const TABLE = "grab_it_runs";

// Lightweight row for the Saved list (no heavy jsonb payload).
export type RunMeta = {
  id: string;
  created_at: string;
  url: string;
  author: string | null;
  caption: string | null;
  thumbnail: string | null;
  comments_count: number | null;
};

export type SavedRun = RunMeta & {
  post: ScrapedPost;
  analysis: Analysis;
};

export async function saveRun(
  post: ScrapedPost,
  analysis: Analysis,
): Promise<RunMeta | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      url: post.url,
      author: post.author,
      caption: post.caption?.slice(0, 500) ?? null,
      thumbnail: post.displayUrl ?? null,
      comments_count: post.commentsCount ?? post.comments.length,
      post,
      analysis,
    })
    .select("id, created_at, url, author, caption, thumbnail, comments_count")
    .single();
  if (error) throw error;
  return data as RunMeta;
}

export async function listRuns(): Promise<RunMeta[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, created_at, url, author, caption, thumbnail, comments_count")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as RunMeta[];
}

export async function getRun(id: string): Promise<SavedRun> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as SavedRun;
}

export async function deleteRun(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
