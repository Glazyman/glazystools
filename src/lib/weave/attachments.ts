// Weave — files pinned to cards.
//
// Bytes go to Supabase Storage; the card keeps a URL. Schema:
// docs/weave-storage.sql (bucket + anon policies), already run on prod.

import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "./types";

const BUCKET = "weave";

/** Anything bigger is a link, not an attachment. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Keep the extension (Storage infers content-type from it) and put a uuid in
 * front, so two photos both called IMG_0001.jpg can't collide and a URL can't
 * be guessed from the filename.
 */
function objectPath(boardId: string, file: File): string {
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  return `${boardId}/${crypto.randomUUID()}${ext}`;
}

export async function uploadAttachment(
  boardId: string,
  file: File,
): Promise<Attachment> {
  if (file.size > MAX_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(0)}MB — the limit is 25MB.`,
    );
  }
  const supabase = createClient();
  const path = objectPath(boardId, file);
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return {
    path,
    url: data.publicUrl,
    name: file.name,
    mime: file.type || "application/octet-stream",
  };
}

/**
 * Best-effort. A file left orphaned in the bucket is untidy; a card you can't
 * detach from is broken — so a failure here never blocks the removal.
 */
export async function deleteAttachment(path: string): Promise<void> {
  try {
    await createClient().storage.from(BUCKET).remove([path]);
  } catch {
    // Ignore.
  }
}

export function isImage(a: Attachment): boolean {
  return a.mime.startsWith("image/");
}
