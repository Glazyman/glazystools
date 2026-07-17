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

/**
 * How to show a file, if at all.
 *
 * Deliberately mime-driven and conservative: an <iframe> pointed at something
 * the engine can't render doesn't fail loudly, it renders a blank white
 * rectangle — which looks exactly like a broken app. Better to say "can't
 * preview this" than to show nothing and call it a preview.
 */
export type Preview = "image" | "video" | "audio" | "pdf" | "text" | "none";

export function previewKind(a: Attachment): Preview {
  const m = a.mime.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  // Everything here renders as plain text in a frame. JSON and CSV are the ones
  // you actually end up pinning to a card.
  if (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml"
  ) {
    return "text";
  }
  return "none";
}
