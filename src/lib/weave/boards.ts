// Weave — board persistence (Supabase).
// Mirrors the shape of lib/grab-it/runs.ts: browser client, anon key, and the
// password gate in proxy.ts is what actually keeps strangers out.
//
// Schema lives in docs/weave-schema.sql — run it once in the SQL editor.

import { createClient } from "@/lib/supabase/client";
import { emptyDoc, type Board, type BoardDoc, type BoardMeta } from "./types";

const TABLE = "weave_boards";
const META = "id, title, created_at, updated_at";

export async function listBoards(): Promise<BoardMeta[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select(META)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as BoardMeta[];
}

export async function createBoard(title = "Untitled board"): Promise<BoardMeta> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ title, doc: emptyDoc() })
    .select(META)
    .single();
  if (error) throw error;
  return data as BoardMeta;
}

export async function getBoard(id: string): Promise<Board> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  const row = data as Board;
  // Older rows may predate a field; merge over an empty doc so the UI can
  // assume every key exists.
  const doc = { ...emptyDoc(), ...row.doc };
  return {
    ...row,
    doc: {
      ...doc,
      // An accuracy pass that was in flight when the tab closed is never coming
      // back — its request died with the page. Without this the rail sits at
      // "sharpening…" forever on every reload.
      utterances: doc.utterances.map((u) =>
        u.status === "refining" ? { ...u, status: "final" as const } : u,
      ),
    },
  };
}

export async function saveBoard(id: string, doc: BoardDoc): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ doc, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function renameBoard(id: string, title: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from(TABLE)
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBoard(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw error;
}
