# 🧠 BRAIN — Glazy's Tools

The running log of this project. Everything we build, decide, and learn gets
jotted here so nothing is lost between sessions. Newest entries at the top.

**How to use:** after each meaningful change, add a dated bullet under a new or
existing date heading. Keep it short — what changed, and *why* if it wasn't
obvious.

---

## 2026-07-15 — "Make a new video" in Post Analysis (HyperFrames b-roll)

**What it is:** a button on Post Analysis that turns an analyzed reel into a NEW
video — keeps the original audio verbatim, replaces the visuals with AI-generated
b-roll stills timed to the transcript, and renders via HeyGen's HyperFrames cloud.
Full-length or a ~30s highlight. Lives in `src/lib/grab-it/video/` +
`src/app/tools/post-analysis/MakeVideo.tsx` + `/api/grab-it/make-video[/status]`.

**Pipeline:** fetch source MP4 once → timed transcript (Gemini) → scene plan (LLM)
→ b-roll images (`generateImage`, 4-way concurrent) → composition HTML → zip →
`POST /v3/assets` → `POST /v3/hyperframes/renders` → client polls status.

**Things learned the hard way (don't re-derive these):**

- **No FFmpeg needed, and none is available on Vercel.** The audio is never
  extracted: `<audio src="assets/source.mp4">` points straight at the scraped MP4
  and HyperFrames pulls the track itself. Trimming for the highlight cut is
  `data-media-start` (offset into the source) — *verified* with a tone-ladder
  test video (1000Hz dominant at -24dB vs 200Hz at -52dB on an 8s offset).
- **`analyzePost` was deliberately NOT touched.** Its one `generateObject` already
  does transcription + comment scoring + build ideas; adding timestamps to it
  risks all three. The video path makes its own focused timed-transcript call,
  and only when the button is clicked.
- **Highlight = one CONTIGUOUS window**, not stitched moments — jump-cut audio
  sounds broken and multi-segment needs N audio elements.
- **Scenes hard-cut, no cross-fade.** The framework owns `.clip` visibility, so
  animating a clip's own opacity fights it. Ken Burns carries the motion.
- **fflate `mtime` gotcha:** ZIP encodes 1980-2099 and fflate reads the year via
  *local* `getFullYear()`. `mtime: 0` and `Date.UTC(1980,0,1)` BOTH throw
  ("date not in range") east of UTC. Pinned to a local-time `new Date(2000,0,1,12)`.
- **HeyGen API shapes (guessed wrong twice, these are verified):** upload is
  `multipart/form-data` with a `file` field (NOT a raw `application/zip` body);
  submit wants `{ project: { type: "asset_id", asset_id } }` (NOT a top-level
  `asset_id`). Source of truth is `buildRenderBody` in the CLI's `dist/cli.js`.
- **Ken Burns overflow is intentional** — declared via `data-layout-allow-overflow`
  so `hyperframes check` stays quiet (9 infos → 1).

**Verified:** `hyperframes check` passes (0 errors, layout 0 issues/9 samples,
captions 5/5 WCAG AA). Local `hyperframes render` produces 1080x1920 h264 + real
AAC audio, 684 frames in 18s. HeyGen upload returns a real `asset_id` and submit
passes validation.

**BLOCKED ON CREDITS (both verified by live API errors):**

1. **AI Gateway is free-tier** — the old "only Gemini Flash is free" comment in
   `analyze.ts` is still true. Image models allow a brief trickle then hard-refuse
   (`GatewayRateLimitError`). A video needs ~17 calls, so this needs paid credits.
2. **HeyGen needs ≥9 API credits per render**; the account has
   `hyperframes_api_render_free_credit: 5` and `remaining_quota: 0` → `402
   insufficient_credit`. The 5 free credits can't cover even one render.

`HEYGEN_API_KEY` is in `.env.local` (git-ignored) but NOT yet in Vercel env.

## 2026-07-09 — Dark-editorial redesign + Post Analysis overhaul (v20 → v38)

**Design system (21st.dev-inspired "mix of two directions"):** flipped the whole
app to a **dark editorial** look. `globals.css` keeps the same semantic token
names (so every component adopted it at once) but dark values: bg `#0b0b0d`,
panel `#15151a`, elevated `#1b1b21`, lime `--accent #d8ff3e` (+ `--accent-strong`,
`--accent-2 #ff6a3d`), status tokens `--live/--wip/--planned`. Fonts via
`next/font`: **Fraunces** (`--font-fraunces`, display, italic accent words),
**Inter** (`--font-inter`, body/`.font-display` uses Fraunces), **JetBrains Mono**
(`--font-jbmono`, eyebrows/labels). `.grain` = absolute film-grain overlay,
`.glow` = radial-gradient blobs (NOT `filter:blur` — that caused mobile
drawer-open lag; see below).
- Built via the **21st MCP plugin** (`/plugin install 21st@21st` → `/reload-plugins`;
  needs `21st login`). `generate` in sketch mode returns multiple takes; `get_take`
  copyPrompts are free. Used them as reference, rebuilt in our stack (zero code
  pasted). 21st AI itself runs on Vercel AI Gateway.

**Shell:** merged ActivityBar+Sidebar into ONE `Sidebar` (expanded panel /
collapsed w-16 icon rail; single hamburger toggle fixed top-left; separator under
Hub). Wordmark = **"Tool Box"**. `WorkspaceShell` persists collapsed state
(localStorage `sidebar:collapsed`). TopBar taller on mobile + big menu button +
`relative z-30` (so the Hub's overlay can't swallow the tap). Registry category
"Content" → **"Tools"**. Hub hero = centered **"Tool Box."** (no subtitle/status).
`ToolPage` full-width `max-w-6xl mx-auto`, text-only header, chevron far-right
(title block is `w-full` so it stretches on mobile). `ScrollRestore` component
persists scroll position per route (sessionStorage; suppresses saves during the
restore window so it isn't clobbered; uses timestamp throttle not rAF so it works
even backgrounded).

**Post Analysis (`GrabIt.tsx`, TOOL_VERSION now v38):**
- **Tabs:** New · Current run · @author · Saved. Finished run hides input, lives
  under Current run. Current run + active tab + active chat thread all persist
  across reload (localStorage). Sections reordered: transcript → comments → build
  ideas → playbook → chat. Removed "What this post is about", "Ideas & follow-ups",
  "What's missing", "Draft replies"; audience questions became chat quick-questions.
- **Build ideas:** each idea is its own collapsible card (persists per-idea; fixed
  an initial-`<details>`-toggle race that clobbered the saved state — start closed,
  effect sets real state). Each card shows a **model badge** (Claude accent / Gemini
  Flash muted). "Generate more ideas" button with a **1–4 count picker** and a
  **Use Claude** toggle; extra ideas persist per post (`pa:extra-ideas:<url>`).
- **Comment → ideas:** multi-select comments (checkbox) → floating bar (count +
  Claude + Generate) combines them into ideas tagged "Sparked by" + model.
- **Chat:** ChatGPT-style; markdown; word-by-word reveal; "Claude" toggle
  (auto-on when brainstorming a Claude idea); **full-screen modal on mobile** (✕ to
  close), inline card on desktop. Custom themed `Dropdown` replaces native
  `<select>` (OS menus ignored the dark theme).
- **Video:** centered, native aspect (9:16 reel stays 9:16), poster = play button
  only; view-original + download moved beneath it.

**Models (IMPORTANT — free tier reality):** Vercel AI Gateway **FREE tier only
allows Gemini Flash** — Gemini 2.5 **Pro AND Claude both 403** ("Free tier users
do not have access"). So analysis + idea research stay `google/gemini-2.5-flash`.
"Use Claude" (`GRAB_IT_IDEAS_MODEL`, default `anthropic/claude-sonnet-5`) and chat
Claude only work after adding **AI Gateway credits** (top-up in Vercel dashboard —
NOT a pasted API key; everything routes via the Gateway OIDC token). Ideas/chat
**auto-fall back to Flash** with a note if Claude is unavailable. `/api/grab-it/more-ideas`
= 2-step: Flash+Google-Search research → structure/ideate (Flash or Claude); accepts
`seeds[]`, `count`, `useClaude`. Claude can't read video, so `GRAB_IT_ANALYSIS_MODEL`
must stay a Gemini (multimodal) model.

**Mobile note:** the automation browser here won't render below ~1470px, so mobile
is breakpoint-verified (`sm:`/`md:hidden`), not visually confirmed — ask the user
to check on-device.

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

- [ ] **Add Vercel AI Gateway credits** — the free tier RATE-LIMITS Gemini
      (transcription + scoring burn it fast). This is the #1 reliability blocker
      for full analysis. ~$5 fixes it. Until then, full analysis fails
      intermittently (but the tool now degrades gracefully — see below).
- [ ] Preview env vars on Vercel (blocked on outdated CLI) — optional.
- [ ] Add a login before sharing the site (Saved runs are open to anyone).

## Grab It robustness (2026-07-08)

- **Graceful degradation:** if the AI step fails (rate limit / quota), the
  scraped comments STILL render (unscored, sorted by likes, "–" badge), with an
  amber ErrorBanner + Retry (re-runs analysis only, no re-scrape). AI-only
  sections (ideas/chat/scores) hide until analysis succeeds. Verified live.
- **Scale:** scrape limit `GRAB_IT_COMMENT_LIMIT` (default 500); LLM scores
  the top `GRAB_IT_SCORE_LIMIT` (default 200) by likes, the rest show unscored.
- **friendlyError()** maps rate-limit/quota errors to actionable copy.
- **THE REAL FREEZE ROOT CAUSE (found v7, 2026-07-08 ~5:30am):** a
  `replace_all` edit that renamed `<VideoPlayer>` → `<MediaBlock>` at call sites
  ALSO rewrote the call **inside MediaBlock itself** → MediaBlock recursed
  infinitely for every `kind:"video"` post → renderer hang → Chrome
  RESULT_CODE_HUNG. Text posts skipped the branch (why only video posts froze).
  Side-effect that confirmed it: VideoPlayer got tree-shaken out of the bundle
  (nothing referenced it). LESSON: never `replace_all` a component call — the
  recursive call site inside the wrapper gets hit too. Fixed + verified live on
  a video post (v7 badge, full render, no freeze).
- **v6/v7 hardening (kept):** video plays through `/api/grab-it/download?...&inline=1`
  (same-origin proxy — IG CDN blocks hotlinked playback); IG embed iframe REMOVED
  entirely (it can hang tabs); click-to-play (nothing mounts till Play);
  ResultsBoundary error boundary; `TOOL_VERSION` badge by the tabs to detect
  stale cached JS; client `postJson` timeouts.
- **Combined call (2026-07-08, supersedes the caption-only change):** full
  analysis now transcribes the video AND analyzes comments in ONE generateObject
  call (video attached as a file part; schema has a `transcript` field). This
  halves the rate-limit exposure that two back-to-back Gemini calls caused, and
  restores the real spoken transcript. `maxRetries: 4` rides out transient
  limits. `GRAB_IT_TRANSCRIBE_VIDEO=0` disables the video (caption only).
  Verified: transcriptSource=video, real transcript + 11 scores + 7 ideas in 21s.
- **Root cause of "google error code 5 / hang":** two sequential Gemini calls
  (transcribe then analyze) tripped the per-minute limit on the 2nd; transcription
  errors were also SWALLOWED silently → page hung. Combined call + surfaced errors
  fix both.
- **Limits raised:** scrape default 2000 (`GRAB_IT_COMMENT_LIMIT`), score top 300
  (`GRAB_IT_SCORE_LIMIT`); all scraped comments shown, top 300 AI-scored.

## Deploy notes (2026-07-08)

- **Auto-deploy now WORKS** (fixed 2026-07-08 ~02:00). Push to `main` →
  Vercel builds & deploys automatically (verified: deploy created 2s after push).
  Re-running `vercel git connect` re-activated it. The Vercel GitHub App was
  already installed on the account with **All repositories** access — the earlier
  "no webhook" diagnosis was WRONG (GitHub Apps don't create repo-level hooks, so
  `gh api /repos/.../hooks` returning empty was a red herring). No GitHub App
  action was needed.
- Manual deploy (if ever needed) still: `vercel --prod` (needs explicit user OK —
  the auto-mode classifier blocks unprompted prod deploys).
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

## Auth
- **Site password gate (2026-07-08):** `src/proxy.ts` (Next 16 proxy convention,
  NOT middleware) gates all pages+API; `/login` + `/api/login` public. Password
  `glazy` (env `SITE_PASSWORD`). Cookie `glazy_auth` = SHA-256 of password, 1yr
  maxAge (stays logged in). `src/lib/auth.ts` shared by proxy + login route.

## Chat (Post Analysis "Ask Chat")
- Model `google/gemini-2.5-flash` via AI Gateway free tier (NOT Claude/user tokens).
- **Web search:** Gemini Google Search grounding via `google.tools.googleSearch()`
  (@ai-sdk/google), attached only for google/* models; cast past an ai@7 generic
  mismatch. Verified live (returned current Next.js version). Not restricted to
  the video — uses general knowledge + web freely.
- **Chat history:** `grab_it_chats` table (post_url, title, messages jsonb);
  `src/lib/grab-it/chats.ts` CRUD. Auto-saves each exchange; opening a run loads
  its most recent thread; "New chat" + thread dropdown to switch/continue.
- **Streaming + UI polish (2026-07-08 → 09, ChatPanel in `GrabIt.tsx`, now v19):**
  - **Word-by-word reveal.** Network chunks buffer into `full`; a RAF loop paints
    one word per ~55ms tick (catches up on backlog via `ceil(words/8)`), holding
    back the incomplete trailing word until whitespace confirms it. Loop only runs
    while there's a buffered word AND pauses when caught up (restarts on next
    chunk / stream end) — no idle CPU spin. LESSON: a self-rescheduling RAF loop
    that runs while idle keeps the page "busy" and makes CDP/automation evals time
    out (looks frozen but isn't) — always gate the loop on having work. Also:
    background tabs throttle RAF, so the reveal stalls in a non-focused tab (fine
    for real users). We tried char-by-char smooth streaming first; user disliked
    it, reverted, then asked for word-by-word — that's what shipped.
  - **Loading indicator.** Before first word: big pulsing accent "Thinking…" +
    larger bouncing dots. While streaming: a live accent bouncing-dot row stays
    under the text the whole response (continuous "still generating" cue), keyed
    on `streaming && i === messages.length - 1`.
  - **ChatGPT-style card.** Borderless full-width assistant messages with ✦
    avatar, subtle right-aligned olive user bubbles, centered empty state with
    suggestion pills inside the conversation card, compact pill toolbar, clean
    input pill.
  - **History dropdown.** `appearance-none` pill matching the New-chat button +
    page `⌄` chevron; option labels clipped to ~30 chars (native `<option>` can't
    be CSS-truncated) with full title in the tooltip.

## Supabase schema

- **`grab_it_chats`** (migration `create_grab_it_chats`): chat threads per post.
- **`grab_it_runs`** (migration `create_grab_it_runs`): id, created_at, url,
  author, caption, thumbnail, comments_count, `post` jsonb, `analysis` jsonb.
  RLS enabled with permissive anon read/insert/delete policies (no auth yet).
  ⚠️ Anyone with the site can read/write saved runs — revisit when auth lands.
  Client access via `src/lib/grab-it/runs.ts` using the browser Supabase client.

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
- **ALL COMMENTS, FREE (2026-07-08 ~6am) — the big win:** Instagram/Apify
  logged-out scraping only returns a small variable batch (15–hundreds). Paid
  Apify actors cap FREE accounts at 15. SOLUTION: fetch comments straight from
  Instagram's own web API with a login cookie —
  `src/lib/grab-it/instagram-direct.ts` converts shortcode→media id and pages
  `/api/v1/media/{id}/comments/?min_id=<cursor>` with XHR headers
  (`x-ig-app-id: 936619743392459`, `x-csrftoken`, `x-requested-with`, etc.).
  Pulled **425/686** comments where Apify gave 15. FREE, and **works from
  Vercel's datacenter IP** (verified live). Cookie in `INSTAGRAM_COOKIES` env
  (throwaway account). Gets top-level comments (not nested replies). Falls back
  to the Apify logged-out actor if cookie missing/expired or IG serves HTML.
  ~40s for 425 comments (900ms/page pagination delay). Ban risk: throwaway acct.
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
- **Saved runs (2026-07-08):** Run/Saved tabs. Every completed run auto-saves to
  Supabase `grab_it_runs`; Saved tab lists them (author, caption, count, date),
  click to reopen (loads full post+analysis from DB), Delete to remove. Verified
  the whole insert→list→open→delete cycle end-to-end.
- **Ask Claude chat (2026-07-08):** streaming chat scoped to the open run
  (`/api/grab-it/chat`, `toTextStreamResponse`); transcript + top-150 comments
  as context; per-comment "ask about this" sets a focused-comment context;
  suggestion chips. IMPORTANT: model is `google/gemini-2.5-flash`, NOT Claude —
  the Gateway FREE tier returns 403 for premium models (Claude Sonnet). Switch
  with `GRAB_IT_CHAT_MODEL` once Gateway credits are added. The user's claude.ai
  subscription CANNOT be used as an app API credential.
- **Collapsible sections (2026-07-08):** full transcript, ideas, questions, gaps
  are `<details>` dropdowns (ideas open by default).
- **Cross-reference / combine (2026-07-08):** Saved tab has checkboxes; select 2+
  runs → "Combine & analyze" → `/api/grab-it/combine` (generateObject, Gemini
  Flash, top-40 comments/run) → cross-video CombinedAnalysis (overview, top ideas
  across videos, next moves, shared themes, audience patterns, gaps). Verified
  live with the real run + a temp run.
- **Real pipeline confirmed working:** Glazy ran it on a real reel
  (techno.optimist.prime, 785 comments scraped) — Apify + analysis + save all
  succeeded end-to-end.
- **Multi-platform (2026-07-08):** `src/lib/grab-it/platforms.ts` detects the
  platform from the URL and dispatches to an Apify actor per platform:
  Instagram (tested), TikTok, Reddit, X, Facebook, YouTube (best-effort, standard
  actors + defensive parsing — may need per-platform tweaks; actor ids
  overridable via env e.g. `APIFY_TIKTOK_ACTOR`). LinkedIn/Nextdoor detected but
  require `APIFY_LINKEDIN_ACTOR`/`APIFY_NEXTDOOR_ACTOR` to enable.
- **Run modes (2026-07-08):** Full analysis / Transcript only / Download video.
  Transcript uses `/api/grab-it/transcribe` (reuses `transcribePost`); Download
  streams via `/api/grab-it/download` proxy (forces attachment; SSRF guard blocks
  localhost/private IPs — verified). Only full runs auto-save.

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
