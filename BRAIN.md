# 🧠 BRAIN — Glazy's Tools

The running log of this project. Everything we build, decide, and learn gets
jotted here so nothing is lost between sessions. Newest entries at the top.

**How to use:** after each meaningful change, add a dated bullet under a new or
existing date heading. Keep it short — what changed, and *why* if it wasn't
obvious.

---

## 2026-07-17 — New tool: **Weave** (voice → thought-map whiteboard)

Tap Space, talk, and the things worth keeping become connected cards on a
canvas. Modelled on sayweave.com but tap-to-toggle rather than hold-to-talk.

**Shape:** `src/lib/weave/` (types, `ops.ts` reducer, `layout.ts`, `boards.ts`)
· `src/app/api/weave/{map,transcribe,consolidate}` · `src/app/tools/weave/`
(Weave, Board, CardNode, TranscriptRail, useSpeech, export). React Flow
(`@xyflow/react` v12) for the canvas — gives edges, handles, pan/zoom free.

**The model never touches the board.** It reads state and emits `Op[]`;
`applyOps` folds them in. A hallucinated id or dupe edge gets dropped, never
corrupts the doc. Card types map onto existing palette tokens only (idea=accent,
action=live, question=accent-2, fact=planned, decision=wip) — no new colours.

**⚠️ The structured-output lesson (cost an hour, don't repeat it):** the obvious
schema — one `ops` array of `{op, ...all optional}` — *silently fails*. Gemini
returns `{op:"create_card", ref:"c1", type:"idea"}` with **no title/body**,
because nothing in the schema compels them; the reasoning field even claimed it
made a card. Fix: **one array per op kind, every field required** (`create`,
`update`, `link`, `unlink`, `ask`). Optional-in-spirit fields are required
strings where `""` = absent. Applies to `map` AND `consolidate`.

**React Flow gotcha:** `useReactFlow().fitView/zoomIn` came back **inert** here
(no-ops) while mouse wheel zoom worked and the store was perfectly populated.
Don't fight it — use the `fitView` **prop** for initial framing (it waits for
node measurement, which a hand-rolled effect gets wrong) and the instance from
`onInit` for buttons. `<Board key={boardId}>` remounts per board so each frames
once on open.

**Storage:** one jsonb doc per board in `weave_boards` (schema:
`docs/weave-schema.sql`, already run on prod). A board is always read/written
whole, so a document beats normalised tables + a sync protocol. Debounced 800ms
autosave. `getBoard` normalises `refining` → `final` on load: an accuracy pass
in flight when the tab closed never lands, and the rail would say "sharpening…"
forever.

**Speech:** two tiers. Web Speech API streams interim text live (Chrome only,
free); MediaRecorder captures the same audio and `/api/weave/transcribe` re-does
it properly with Gemini. `onSettled` fires **exactly once per utterance on every
path** (try/finally) — mapping keys off it, so a refinement failure must still
settle with the original text or the card never appears. MediaRecorder timeslice
chunks are bare EBML clusters: the **first chunk's header must be re-prepended**
to every slice or it won't decode.

**Shell change:** `ToolPage` gained generic `bleed` (no max-width, no page
scroll) and `hideHeader` props for tools that own their viewport. Kept generic
per golden rule 3.

**Themeable board, scoped (☾/☀ in the toolbar, light default).** `weave.css`
re-points the SAME semantic tokens (`--bg`, `--panel`, `--fg`, `--border`,
accents) at light values under `.weave-light`. Every component flips on its own,
none of them know a theme exists, nothing outside the scope changes — no
component needed editing and no raw hex entered them (golden rule 5 in spirit).
**Dark needs no CSS at all**: the workspace's `:root` tokens already *are* the
dark theme, so dark is simply the absence of the class. Light accents keep their
hue but darken (`--accent` `#d8ff3e` → `#5f7d00`) — they're used for text and
1.5px strokes, and the dark-theme lime is invisible on white.

**⚠️ StrictMode ate a persisted setting.** Both toggles first wrote
localStorage *inside* the `setState` updater. StrictMode double-invokes updaters
to check purity, so the write ran twice and the second pass read back its own
side effect and persisted the OPPOSITE of the click — UI went dark, storage said
light, reload undid it. Side effects belong in the handler, not the updater.
Only caught by toggling and reloading; the UI looked correct the whole time.

**⚠️ Batching regression (found by watching glazy's real speech, not a test):**
"I want an app for patenting. I want an app like Tinder for devs." returned ZERO
ops — the mapper judged the whole run a restatement and silently ate the second,
genuinely new idea. Cause: the prompt's "read the run as ONE thought" was too
strong, so one point's verdict decided the whole run. Fix: the prompt now says a
run is frequently a MIXTURE and each point is judged independently — a
restatement tells you nothing about the point beside it, and dropping a new idea
is the worst available outcome. Verified: mixed run → new card survives; pure
restatement → still 0; pure filler → still 0. **Lesson: batching trades a
per-sentence prompt for a per-run one, and the run prompt must be explicit that
runs are heterogeneous.**

**⚠️ Drag perf — the controlled React Flow trap.** The obvious pattern (derive
`nodes` from `doc.cards`, write every `position` change straight back) re-renders
the ENTIRE app on every frame of a drag: new doc → Weave re-renders → the rail
re-renders → every card's `data` object is rebuilt → RF re-renders all nodes. At
60fps that's what made dragging lurch and the board flicker/white-out when moving
over other cards. Fix: `useNodesState` owns node state, `onNodesChangeRF` handles
moves internally, and positions reach the document ONLY in `onNodeDragStop`
(which gets the `moved[]` array, so multi-select drags commit too). The
doc→nodes sync effect early-returns while `dragging.current` — otherwise an
utterance landing mid-drag snaps the card back to the position the doc still
remembers. Selection moved to RF's `onSelectionChange`.

**Expand a node** (`+` on the card's footer by the confidence % →
`/api/weave/expand`). Suggested next cards: what this card makes necessary,
possible, or risky. 2-4 cards, all `connectTo` the source. `temperature: 0.7`
(vs the mapper's 0.2 — here we want range, not caution). **THE CARD IS THE
SUBJECT** — the prompt hammers this, because the failure mode is drifting to the
board's general topic instead of the card you clicked (verified: expanding the
Placeit-API card on a mostly-patents board returned three API cards incl.
"Placeit's ToS may forbid scraping", zero patent drift). The board is context
ONLY, for not repeating and not contradicting. The other half of the prompt
kills generic filler: "could this sentence sit under a different card on a
different map?" → if yes it's noise. It reads across cards when that's what the
card implies — expanding "simplify patenting" on a board holding "ship MVP
without the API" surfaced *"Manual upload vs. 'fast' promise"*, the
contradiction between them. On a button, never automatic: the one place Weave
has ideas of its own.

**Delete** — red `✕` badge on the card's top-left corner, revealed on hover
(matches Weave's own). No confirm: undo is a better answer than a dialog on
every card. `⌫` on a selection still works too.

**`+ Card`** — manual card at the viewport centre, born `pinned:true` (you wrote
it, the mapper must not rewrite it). Needs `screenToFlowPosition`, so `Board`
publishes a `BoardApi` handle via `onApi` (stable useCallback, or its
publish-once effect re-fires every render). Placement runs through
`freeSpotNear(doc, point)` — extracted out of `placeCard` — because dead-centre
drops it on top of whatever you were looking at.

**Batched mapping (not per-sentence).** Utterances buffer in `pending` and flush
as ONE call after `PAUSE_MS` 1500ms of silence (or `MAX_BATCH` 6 / `MAX_WAIT_MS`
12s, so a monologue can't bank up forever). This started as a rate-limit dodge
(3-5x fewer calls) but is the better design outright: the mapper gets the whole
thought, so same-batch `connectTo` refs let it chain cards. Verified — one
3-sentence run produced idea → fact → action *connected*, which per-sentence
mapping physically cannot do (each call saw one sentence, nothing to link to).
`applyOps` therefore takes `utteranceIds: string[]`; every utterance in a run
gets credit for the cards, since you can't attribute a card to one sentence
inside it. `dropBatch()` on board switch, and `mapBatch` compares `boardIdRef`
before applying — a response landing after a switch would otherwise graft cards
onto the wrong board.

**Rate limits — resolved.** Heaviest AI use in the repo: `transcribe` fires once
per *sentence* (sends audio, not batched), `map` once per *pause* (batched). The
free tier throttles requests/minute regardless of remaining Free Credit, which
blocked testing repeatedly. Fixed by putting paid credit on the AI Gateway —
note it's the *paid lane* that lifts the throttle, not the balance; $3.24 of
Free Credit sat unused while every call 429'd. Cost is negligible: 21 requests =
$0.01, so a session is ~a cent. If it ever needs cutting further, batch the
run's audio into one transcribe call at flush (≈40 calls → ≈10).

**update vs create+connect.** Original prompt said update whenever speech
"adds detail" to an existing card — too broad. It swallowed new points into fat
cards ("match on GitHub languages" → updated the Tinder card instead of making a
connected card), which defeats the point of a *graph*. Now: same point restated
→ `update`; a NEW point that builds on a card (feature / consequence /
requirement / next step) → `create` + `connectTo` it; new point about nothing on
the board → `create` with empty `connectTo`. Cards stay small, relationships
live in the edges. When unsure, leave unconnected — a missing line costs a
one-second drag, a wrong line has to be spotted first.

**Verified end-to-end:** live mic → transcript → `map` 200 in ~1.15s → card ·
autosave to Supabase · all 5 card types · edges + labels · board frames on load ·
no console errors · filler ignored ("I wanna get a" → 0 ops) · batched 3-sentence
run → idea→fact→action *chained* · **dedup** (pure restatement → 0 ops;
restatement + new detail → `update_card`, never a duplicate) · **consolidate**
(merged dupe via update-then-delete, dropped junk, added a missed link, and left
the `pinned:true` card untouched).

---

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
