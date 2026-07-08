import { createClient } from "@/lib/supabase/client";

const TABLE = "grab_it_chats";

export type ChatMsg = { role: "user" | "assistant"; content: string };

export type ChatThreadMeta = {
  id: string;
  title: string | null;
  updated_at: string;
};

export type ChatThread = ChatThreadMeta & {
  post_url: string;
  messages: ChatMsg[];
};

function titleFrom(messages: ChatMsg[]): string {
  const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
  return first.trim().slice(0, 60) || "New chat";
}

// Threads for a given post, newest first (metadata only — light).
export async function listChats(postUrl: string): Promise<ChatThreadMeta[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, title, updated_at")
    .eq("post_url", postUrl)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ChatThreadMeta[];
}

export async function getChat(id: string): Promise<ChatThread> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as ChatThread;
}

export async function createChat(
  postUrl: string,
  messages: ChatMsg[],
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ post_url: postUrl, title: titleFrom(messages), messages })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateChat(
  id: string,
  messages: ChatMsg[],
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({
      messages,
      title: titleFrom(messages),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteChat(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
