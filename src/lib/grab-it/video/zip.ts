import { zipSync } from "fflate";

// Pinned so the same project always zips to the same bytes, rather than
// carrying the wall clock into the archive. ZIP only encodes 1980-2099, and
// fflate reads the year via LOCAL getFullYear() — so this must be a local-time
// date comfortably inside the window. A UTC-midnight 1980 date reads as 1979
// west of Greenwich and throws "date not in range".
const ZIP_MTIME = new Date(2000, 0, 1, 12, 0, 0);

export function zipProject(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files, { level: 6, mtime: ZIP_MTIME });
}
