// Weave — getting a board back out.
// Markdown is the useful one (it pastes into anything); JSON is the escape
// hatch so a board is never trapped in this tool.

import { CARD_TYPES, type BoardDoc } from "@/lib/weave/types";

export function toMarkdown(title: string, doc: BoardDoc): string {
  const out: string[] = [`# ${title}`, ""];
  const byId = new Map(doc.cards.map((c) => [c.id, c]));

  for (const type of CARD_TYPES) {
    const cards = doc.cards.filter((c) => c.type === type);
    if (!cards.length) continue;
    out.push(`## ${type[0].toUpperCase()}${type.slice(1)}s`, "");
    for (const c of cards) {
      out.push(`### ${c.title}`);
      if (c.body) out.push("", c.body);
      const links = doc.edges
        .filter((e) => e.source === c.id || e.target === c.id)
        .map((e) => byId.get(e.source === c.id ? e.target : e.source)?.title)
        .filter(Boolean);
      if (links.length) out.push("", `*Connects to: ${links.join(", ")}*`);
      out.push("");
    }
  }

  if (doc.questions.length) {
    out.push("## Open questions", "");
    doc.questions.forEach((q) => out.push(`- ${q.text}`));
    out.push("");
  }

  const said = doc.utterances.filter((u) => u.text.trim());
  if (said.length) {
    out.push("---", "", "## Transcript", "");
    said.forEach((u) => out.push(`> ${u.text}`, ""));
  }

  return out.join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "board"
  );
}
