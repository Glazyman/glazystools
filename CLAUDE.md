@AGENTS.md

# Glazy's Tools — Project Instructions

This is **Glazy's Tools**: a personal workspace/IDE-on-the-web that hosts many
AI-powered tools. It is NOT a single-purpose app. Every decision should keep the
workspace reusable so new tools drop in cleanly.

## Golden rules

1. **The registry is the source of truth.** `src/lib/tools.ts` lists every tool.
   Adding a tool = one entry there + one page. Never hardcode a tool into the
   sidebar/dashboard; those read from the registry automatically.
2. **Every tool page uses `<ToolPage slug="...">`** (`src/components/workspace/ToolPage.tsx`)
   so headers, spacing, and status stay consistent.
3. **Keep the shell generic.** Anything tool-specific lives under that tool's
   folder, not in the shared workspace chrome.
4. **Log your work in `BRAIN.md`** after each meaningful change (see that file).
5. **Match the existing style**: dark IDE theme, semantic color tokens
   (`bg`, `panel`, `elevated`, `border`, `fg`, `muted`, `subtle`, `accent`) from
   `globals.css` — don't introduce raw hex or off-palette Tailwind colors.

## How to add a new tool (the one workflow that matters)

1. Add an entry to the `tools` array in `src/lib/tools.ts`.
2. Create `src/app/tools/<slug>/page.tsx` that renders `<ToolPage slug="<slug>">`.
3. Put tool-specific components in `src/app/tools/<slug>/` or
   `src/components/tools/<slug>/`.
4. Server routes (AI calls etc.) go in `src/app/api/<slug>/route.ts`.
5. Update `BRAIN.md`.

Full detail + a copy-paste template: `docs/ADDING-TOOLS.md`.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4
- Dev: `npm run dev` (http://localhost:3000)
- Recommended additions for tool-building are in `docs/RECOMMENDED-TOOLS.md`.

## Conventions

- Slugs are kebab-case and unique; they become the URL and the registry key.
- Status values: `live` | `wip` | `planned` (drives the sidebar dot + badges).
- Prefer Server Components; add `"use client"` only when a component needs
  interactivity/state.
- Secrets go in `.env.local` (git-ignored), never in the registry or client code.
