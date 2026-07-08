# 🧠 BRAIN — Glazy's Tools

The running log of this project. Everything we build, decide, and learn gets
jotted here so nothing is lost between sessions. Newest entries at the top.

**How to use:** after each meaningful change, add a dated bullet under a new or
existing date heading. Keep it short — what changed, and *why* if it wasn't
obvious.

---

## Project snapshot

- **What it is:** a personal workspace / web-IDE that hosts many AI-powered tools.
- **Not** a single app — the shell is generic; tools plug in via a registry.
- **Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Key files:**
  - `src/lib/tools.ts` — tool registry (source of truth)
  - `src/components/workspace/` — shared IDE chrome (ActivityBar, Sidebar, TopBar, ToolPage)
  - `src/app/tools/<slug>/page.tsx` — individual tool pages
  - `docs/ADDING-TOOLS.md` — how to add a tool
  - `docs/RECOMMENDED-TOOLS.md` — libraries & tips

## Infrastructure

- **GitHub:** https://github.com/Glazyman/glazystools (main branch).
- **Vercel:** project `daniels-projects-dce54a5d/glazystools`, GitHub-connected
  (push to main auto-deploys, PRs get preview URLs).
- **Supabase:** project `glazystools` (ref `rajhjdctynqtgpetcnbs`, us-east-1,
  free tier) in org "daniel's projects". URL + publishable key live in
  `.env.local` (local) and Vercel env (Production + Development).
  - Client helpers: `src/lib/supabase/client.ts` (browser),
    `src/lib/supabase/server.ts` (server/SSR).
  - Note: Preview env vars not set (outdated Vercel CLI rejected the flags);
    add later via dashboard if PR previews need Supabase.

## Open questions / next up

- [ ] Live end-to-end test of Grab It with a real Instagram URL (waiting on Glazy).
- [ ] Preview env vars on Vercel (blocked on outdated CLI) — optional.

## Deploy notes (2026-07-08)

- **Auto-deploy is NOT working:** the Vercel GitHub App was never installed on
  `Glazyman/glazystools` (repo has no webhook), so pushes don't trigger deploys.
  `vercel link` only set the connection on Vercel's side. To fix permanently:
  install https://github.com/apps/vercel/installations/new for the glazystools
  repo. Until then, deploy manually with `vercel --prod` (needs explicit user OK
  — the auto-mode classifier blocks unprompted prod deploys).
- Grab It went live via a **manual `vercel --prod`** (user-approved) at
  https://glazystools.vercel.app/tools/grab-it
- ⚠️ The production site is PUBLIC — anyone with the link can spend Glazy's Apify
  credits / AI Gateway usage. Consider Vercel password protection or auth before
  sharing widely.

## Auth / keys (verified 2026-07-08)

- **Apify:** `APIFY_TOKEN` set in `.env.local` + Vercel (prod/dev). Account
  `glazeyman`, FREE plan. Token validated via `/users/me`.
- **AI Gateway:** No separate key needed! Uses the **Vercel OIDC token**
  (`VERCEL_OIDC_TOKEN`, pulled via `vercel env pull`) locally, and OIDC
  automatically in prod. Probed `google/gemini-2.5-flash` → works. Note: local
  OIDC token expires ~12h; re-run `vercel env pull .env.local` to refresh.

## Tools

### Grab It (`grab-it`) — status: wip
Paste an Instagram reel/post URL → mine the comments for ideas.
- **Flow:** Apify scrape (caption, video, all comments) → free junk pre-filter
  (drop emoji-only / pure @mention / #hashtag / bare-number comments) →
  transcribe video via Gemini Flash → analysis via **Gemini 2.5 Flash**
  (cheapest; scores every comment 0-100, surfaces questions/gaps, drafts
  follow-ups + replies). Bump quality anytime with
  `GRAB_IT_ANALYSIS_MODEL=anthropic/claude-sonnet-4.5`.
- **Cost decisions (2026-07-08):** kept Apify (free $5/mo credits); chose
  Gemini Flash for everything to minimize cost (~1¢/reel vs ~10-15¢ on Sonnet).
- **Files:** `src/lib/grab-it/{types,apify,analyze}.ts`,
  `src/app/api/grab-it/{scrape,analyze}/route.ts`,
  `src/app/tools/grab-it/{page,GrabIt}.tsx`.
- **AI:** Vercel AI SDK v7, models as `provider/model` strings via AI Gateway.
- **Keys needed:** `APIFY_TOKEN`, `AI_GATEWAY_API_KEY` (Gateway routes both
  Claude + Gemini). Optional actor overrides: `APIFY_INSTAGRAM_POST_ACTOR`,
  `APIFY_INSTAGRAM_COMMENT_ACTOR`.
- **Notes:** comment scoring capped at 200/post; video transcription capped at
  20 MB (else falls back to caption).
- **UX (2026-07-08 revamp):** primary goal is exploring comments + mining ideas;
  replies are secondary (per-comment reply idea is a collapsed toggle, bulk
  drafts in a `<details>` at the bottom). Comments show top-scored first, 5 at a
  time with "Load more"; sortable by score/likes/replies + category & min-score
  filters. In-page video player (`<video>` from videoUrl, falls back to IG embed
  iframe via shortcode, then an Instagram link). Verified via mocked API in
  browser: sort, pagination, video fallback all render correctly.

---

## 2026-07-07 — Connected GitHub, Vercel, and Supabase

- Pushed the workspace to GitHub (Glazyman/glazystools).
- Linked & GitHub-connected the Vercel project → auto-deploy on push. First
  production deploy is live and Ready.
- Created Supabase project `glazystools` via MCP; added `@supabase/ssr` +
  `@supabase/supabase-js`, scaffolded browser/server client helpers, wired env
  vars locally and into Vercel (prod + dev).

---

## 2026-07-07 — Workspace shell built

- Scaffolded Next.js 16 + React 19 + TS + Tailwind v4 in place (had to scaffold in
  a temp dir first — the folder name "Glazys Tools" fails npm naming rules).
- Built the reusable IDE shell:
  - **ActivityBar** (far-left icon rail: Dashboard, All Tools, logo).
  - **Sidebar** — searchable, registry-driven tool list grouped by category, with
    per-tool status dots and an empty-state message.
  - **TopBar** — breadcrumbs derived from the route + registry, local status pill.
  - **WorkspaceShell** — composes the three around the page content.
  - **ToolPage** — consistent header wrapper every tool page uses.
- Made tools **data-driven** via `src/lib/tools.ts`. Sidebar, dashboard, `/tools`,
  and breadcrumbs all read from it, so adding a tool is 1 entry + 1 page.
- Dashboard (`/`): hero, live stat tiles, and a dotted-grid empty state.
- Dark IDE theme with semantic color tokens in `globals.css`.
- Added project docs: `CLAUDE.md` (instructions), `docs/ADDING-TOOLS.md`,
  `docs/RECOMMENDED-TOOLS.md`, and this brain file.
- Verified: dev server runs clean, `/` and `/tools` return 200, screenshot looks good.
