import { zipSync } from "fflate";
import type { RenderJob, RenderStatus } from "./types";

const API_BASE = process.env.HEYGEN_API_URL ?? "https://api.heygen.com";

export class HeyGenError extends Error {}

function apiKey(): string {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    throw new HeyGenError(
      "HEYGEN_API_KEY is not set — cloud rendering needs a HeyGen key.",
    );
  }
  return key;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-api-key": apiKey(), ...extra };
}

// Pinned so the same project always zips to the same bytes, rather than
// carrying the wall clock into the archive. ZIP only encodes 1980-2099, and
// fflate reads the year via LOCAL getFullYear() — so this must be a local-time
// date comfortably inside the window. A UTC-midnight 1980 date reads as 1979
// west of Greenwich and throws.
const ZIP_MTIME = new Date(2000, 0, 1, 12, 0, 0);

export function zipProject(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6, mtime: ZIP_MTIME });
}

// POST /v3/assets is NOT idempotent — a blind retry creates a duplicate asset
// and bills twice, so the caller's idempotency key is required, not optional.
export async function uploadProject(
  zip: Uint8Array,
  idempotencyKey: string,
): Promise<string> {
  // Multipart with a `file` field — a raw application/zip body is rejected.
  // content-type is deliberately unset so fetch can add the mime boundary.
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(zip)], { type: "application/zip" }),
    "project.zip",
  );

  const res = await fetch(`${API_BASE}/v3/assets`, {
    method: "POST",
    headers: headers({ "idempotency-key": idempotencyKey }),
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HeyGenError(`Upload failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let id: string | undefined;
  try {
    const json = JSON.parse(text);
    id = json?.data?.id ?? json?.data?.asset_id ?? json?.id ?? json?.asset_id;
  } catch {
    throw new HeyGenError(`Upload returned unreadable JSON: ${text.slice(0, 200)}`);
  }
  if (!id) {
    throw new HeyGenError(`Upload returned no asset id: ${text.slice(0, 300)}`);
  }
  return id;
}

// Submits and returns immediately. We never block on the render: a Vercel
// function caps at 300s and a render can outlast that, so the client polls
// getRender() instead.
export async function submitRender(
  assetId: string,
  opts: { idempotencyKey: string; callbackUrl?: string },
): Promise<string> {
  // The project is a tagged object, not a bare asset_id at the top level:
  // { project: { type: "asset_id", asset_id } }.
  const body: Record<string, unknown> = {
    project: { type: "asset_id", asset_id: assetId },
    composition: "index.html",
    aspect_ratio: "9:16",
    fps: 30,
    quality: "standard",
    resolution: "1080p",
    format: "mp4",
  };
  if (opts.callbackUrl) body.callback_url = opts.callbackUrl;

  const res = await fetch(`${API_BASE}/v3/hyperframes/renders`, {
    method: "POST",
    headers: headers({
      "content-type": "application/json",
      "idempotency-key": opts.idempotencyKey,
    }),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new HeyGenError(`Render submit failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let id: string | undefined;
  try {
    const json = JSON.parse(text);
    id = json?.data?.id ?? json?.data?.render_id ?? json?.id ?? json?.render_id;
  } catch {
    throw new HeyGenError(`Submit returned unreadable JSON: ${text.slice(0, 200)}`);
  }
  if (!id) {
    throw new HeyGenError(`Submit returned no render id: ${text.slice(0, 300)}`);
  }
  return id;
}

function normalizeStatus(raw: unknown): RenderStatus {
  const s = String(raw ?? "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled"].includes(s)) return "failed";
  if (["processing", "running", "in_progress", "started"].includes(s)) return "processing";
  return "pending";
}

// video_url is a short-lived presigned URL — always re-fetch, never cache it.
export async function getRender(renderId: string): Promise<RenderJob> {
  const res = await fetch(
    `${API_BASE}/v3/hyperframes/renders/${encodeURIComponent(renderId)}`,
    { headers: headers() },
  );
  const text = await res.text();
  if (!res.ok) {
    throw new HeyGenError(`Status check failed (${res.status}): ${text.slice(0, 300)}`);
  }

  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HeyGenError(`Status returned unreadable JSON: ${text.slice(0, 200)}`);
  }

  const d = ((json.data as Record<string, unknown>) ?? json) as Record<string, unknown>;
  return {
    renderId,
    status: normalizeStatus(d.status),
    videoUrl: (d.video_url as string) ?? undefined,
    thumbnailUrl: (d.thumbnail_url as string) ?? undefined,
    error: (d.error as string) ?? (d.error_message as string) ?? undefined,
  };
}
