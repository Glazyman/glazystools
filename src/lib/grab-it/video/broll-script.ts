// The b-roll fetcher that ships INSIDE the generated project.
//
// It runs on the user's machine, not here, because the free image service
// (Pollinations) allows exactly one request at a time at ~45s each — measured:
// concurrency 2 and 4 both return 429 for 3 of every 4 requests. Sequentially
// that's minutes per video, which no serverless function can wait out, but is
// fine locally where nothing times out.
//
// Plain Node 22, zero dependencies, resumable: existing files are skipped, so a
// re-run only fetches what's missing.
export const BROLL_SCRIPT = `#!/usr/bin/env node
// Fetches the b-roll stills for this project. Free, no API key.
// Re-run it safely — images already on disk are skipped.
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ENDPOINT = "https://image.pollinations.ai/prompt";
const scenes = JSON.parse(await readFile("prompts.json", "utf8"));

const exists = async (p) => access(p).then(() => true, () => false);

async function fetchOne(scene, attempt = 1) {
  const url =
    ENDPOINT +
    "/" +
    encodeURIComponent(scene.prompt) +
    "?width=1080&height=1920&nologo=true&seed=" +
    scene.seed;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(150000) });
    if (res.status === 429) throw new Error("rate limited");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 2048) throw new Error("truncated response");
    await mkdir(dirname(scene.file), { recursive: true });
    await writeFile(scene.file, buf);
    return true;
  } catch (e) {
    if (attempt >= 4) {
      console.log("   ✗ " + scene.file + " — " + e.message);
      return false;
    }
    // The service only serves one caller at a time; back off and wait our turn.
    const wait = attempt * 20;
    console.log("   … retry " + attempt + "/3 in " + wait + "s (" + e.message + ")");
    await new Promise((r) => setTimeout(r, wait * 1000));
    return fetchOne(scene, attempt + 1);
  }
}

let done = 0;
let failed = 0;
console.log("Fetching " + scenes.length + " b-roll stills. One at a time (~45s each) — this is the slow, free bit.\\n");

for (const [i, scene] of scenes.entries()) {
  const label = "[" + (i + 1) + "/" + scenes.length + "] " + scene.file;
  if (await exists(scene.file)) {
    console.log(label + " — already there, skipping");
    done++;
    continue;
  }
  const t = Date.now();
  process.stdout.write(label + " … ");
  const ok = await fetchOne(scene);
  if (ok) {
    console.log("✓ " + Math.round((Date.now() - t) / 1000) + "s");
    done++;
  } else {
    failed++;
  }
}

console.log("\\n" + done + "/" + scenes.length + " stills ready" + (failed ? ", " + failed + " failed" : ""));
if (failed) {
  console.log("Re-run this script to retry just the missing ones.");
  console.log("Any still that never arrives will render as a black scene — the audio is unaffected.");
}
console.log("\\nNext:  npx hyperframes render -o out.mp4");
`;
