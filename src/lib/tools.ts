// The tool registry — the single source of truth for the workspace.
// To add a new tool: add an entry here + create a page at src/app/tools/<slug>/page.tsx
// Everything else (sidebar, dashboard, search, routing) is driven off this list.

export type ToolStatus = "live" | "wip" | "planned";

export type Tool = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  icon: string; // emoji or short glyph — swapped for real icons later
  category: string;
  status: ToolStatus;
  accent: string; // tailwind color token used for accents, e.g. "sky", "violet"
};

export const tools: Tool[] = [
  {
    slug: "grab-it",
    name: "Grab It",
    tagline: "Mine a reel's comments for ideas & add-ons",
    description:
      "Paste an Instagram reel/post URL. It scrapes the video, caption, and every comment, transcribes what the video says, then Claude scores each comment and hands you the strongest follow-up ideas and value-adding replies to post.",
    icon: "🎯",
    category: "Content",
    status: "wip",
    accent: "violet",
  },
];

export function getTool(slug: string): Tool | undefined {
  return tools.find((t) => t.slug === slug);
}

export function toolsByCategory(): Record<string, Tool[]> {
  return tools.reduce<Record<string, Tool[]>>((acc, tool) => {
    (acc[tool.category] ??= []).push(tool);
    return acc;
  }, {});
}
