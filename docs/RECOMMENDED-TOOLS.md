# Recommended Tools & Tips

A curated shortlist to make building tools in this workspace faster and nicer.
Nothing here is installed yet — pull each in only when a tool actually needs it,
so the base stays lean.

## UI & components

- **shadcn/ui** — copy-paste, fully-owned components (buttons, dialogs, inputs,
  tabs, command palette). Perfect fit for the IDE feel. Install with the CLI:
  `npx shadcn@latest init` then `npx shadcn@latest add button dialog input`.
  A Claude skill exists for it: `/vercel:shadcn`.
- **lucide-react** — clean, consistent icon set. Swap the emoji icons in the
  registry for real icons when ready: `npm i lucide-react`.
- **Radix UI primitives** — accessible unstyled primitives (shadcn is built on
  these); reach for them for menus, popovers, tooltips.
- **cmdk** — the ⌘K command-palette. High-value for an IDE-style workspace:
  jump between tools instantly. `npm i cmdk`.

## Motion & polish

- **motion** (formerly framer-motion) — page/panel transitions and micro-interactions.
  `npm i motion`. Keep it subtle to match the IDE tone.
- **tailwind-merge** + **clsx** — clean conditional class handling
  (`cn()` helper). `npm i tailwind-merge clsx`.

## State & data

- **zustand** — tiny global state when a tool needs shared client state.
  `npm i zustand`.
- **@tanstack/react-query** — server-state/caching if a tool does lots of fetches.
- **zod** — validate inputs and API payloads. Pairs great with AI structured
  output. `npm i zod`.

## AI (the point of this workspace)

- **Vercel AI SDK** (`ai` + provider) — streaming chat, structured output, tool
  calling, agents. This is the default for any AI tool here.
  - Use the Claude skills: `/vercel:ai-sdk` and `/vercel:ai-gateway`.
  - Prefer the **AI Gateway** with plain `"provider/model"` strings for easy
    provider switching + observability, rather than wiring one provider directly.
  - For Anthropic models, the latest are Opus 4.8 / Sonnet 5 / Haiku 4.5.
- **Structured output**: define a `zod` schema, let the model fill it — no brittle
  parsing.

## Editor / code tools

- **CodeMirror 6** (`@uiw/react-codemirror`) or **Monaco** (`@monaco-editor/react`)
  — drop-in code editors if a tool needs one (formatters, playgrounds, etc.).

## Local persistence

- **localStorage** for simple per-tool settings.
- **Dexie** (IndexedDB) if a tool stores larger structured data client-side.
- For real backend storage, use a Vercel Marketplace DB (Neon Postgres,
  Upstash Redis) via `/vercel:vercel-storage` — Vercel Postgres/KV are retired.

## Workflow tips

- **Context7 MCP** is wired up: ask Claude about any library and it fetches
  current docs instead of relying on memory. Great before using an unfamiliar API.
- **Keep tools isolated**: one tool's dependency or bug should never touch another.
- **Ship a `wip` first**: register the tool with `status: "wip"` and a stub page,
  then iterate. It shows in the sidebar immediately.
- **Reuse `<ToolPage>`** and the color tokens — consistency is what makes a
  workspace feel like one product instead of a pile of pages.
- **Run the dev server** (`npm run dev`) and check the page after each change.
