// Simple site-wide password gate. The password defaults to "glazy" and can be
// overridden with the SITE_PASSWORD env var. The auth cookie stores a hash of
// the password (never the plaintext); middleware compares against this token.

export const AUTH_COOKIE = "glazy_auth";
// A year — so once you're in, you stay in.
export const AUTH_MAX_AGE = 60 * 60 * 24 * 365;

export function sitePassword(): string {
  return process.env.SITE_PASSWORD || "glazy";
}

// Deterministic token derived from the password (works in edge + node runtimes).
export async function authToken(): Promise<string> {
  const data = new TextEncoder().encode(`glazy-gate:v1:${sitePassword()}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
