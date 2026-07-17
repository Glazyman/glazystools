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
    slug: "weave",
    name: "Weave",
    tagline: "Think out loud, watch the map build itself",
    description:
      "Tap Space and talk. Everything you say lands in the transcript; the things that actually matter become cards on a whiteboard, connected to what they follow from. Filler and false starts are ignored. Drag cards around, rewire the connections by hand, and consolidate the board in one pass when you're done. Keep as many boards as you like.",
    icon: "🕸️",
    category: "Tools",
    status: "wip",
    accent: "lime",
  },
  {
    slug: "post-analysis",
    name: "Post Analysis",
    tagline: "Analyze any post's video & comments for ideas",
    description:
      "Paste a link from Instagram, TikTok, Reddit, X, Facebook or YouTube. It scrapes the video, caption, and every comment, transcribes what the video says, then surfaces the best ideas from the comments — every comment scored and sortable. Or just grab the transcript or download the video.",
    icon: "🔎",
    category: "Tools",
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
