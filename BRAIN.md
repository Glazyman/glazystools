# 🧠 BRAIN — Glazy's Tools

The running log of this project. Everything we build, decide, and learn gets
jotted here so nothing is lost between sessions. Newest entries at the top.

**How to use:** after each meaningful change, add a dated bullet under a new or
existing date heading. Keep it short — what changed, and *why* if it wasn't
obvious.

---

## 2026-07-17 — Weave: voice commands become a system (delete / expand / prompt)

The map route's `remove` list grew into `command: {action, ids, reason}` with
three verbs — delete, expand, prompt — returned BESIDE the ops (`commands` in
the response), never inside them. The client decides what runs:

- **Aimed commands run immediately.** Cards selected + Space + "make a prompt
  out of these" → executes on the spot (the speaker pointed AND spoke).
  `focusCardId` became `focusCardIds[]` — multi-select now rides into the map
  call; 1 card = full aimed-mapping block, several = command-target block.
- **Named commands wait for a hand.** No selection + "expand the pricing
  card" → a confirm question in the rail's Questions section ("Expand
  “Pricing”? [Expand] [Skip]"), one row per command (`pendingCommands[]`).
- **Deletes ALWAYS wait**, aimed or not.
- **The rail labels command lines** — "⌘ delete" / "⌘ expand" in accent-2
  next to the card count (`Utterance.commands`), so orders are visually
  distinct from thoughts.
- Executors: delete → delete_card ops; expand → expandCard per id; prompt →
  `buildPromptFrom(ids, anchor)` (extracted from buildPrompt so the menu path
  and the voice path share one body). mapBatch runs commands through
  `runCommandRef` because the executors are declared far below it — calling
  them directly would put not-yet-initialized consts in a dep array (TDZ).

Verified: aimed "make a prompt out of these" → prompt command with exactly
the selected ids; "expand on the scraping risk card" → expand a2; "delete the
revenue card" → delete a3; plain feature talk → zero commands, one create.

## 2026-07-17 — Weave: spoken deletes, prompt lineage, card→transcript lighting

1. **Spoken deletes with a confirm.** "delete the note you just created" →
   the map route's new `remove` list ({id, reason} — reason quotes the
   speaker, same no-justification-no-deletion guard as consolidate). Client
   NEVER auto-applies spoken delete_card ops: they're staged in
   `confirmDeletes` and land only from the accent-2 banner's [Delete] button
   ([Keep]/✕ discards; board-switch invalidates). "Newest card" resolution
   rides on cards being serialized oldest→newest. Verified: correct card
   picked via `recent` context; consolidate's own delete ops are unaffected
   (different call path).
2. **Hesitation guard** (found while testing): "hmm not sure about X
   honestly" was getting narrated INTO the card body ("Speaker is unsure
   about this."). New nothing-rule: hovering doubt is not a decision — no
   card, no update, never narrate mood; map the eventual decision instead.
3. **Prompt lineage.** Prompt cards store `promptSources` (the card ids they
   were built from). Right-click → "Regenerate from sources" re-reads those
   cards AS THEY ARE NOW and rewrites the prompt card in place (same id, same
   position, history-pushed, re-copied to clipboard). Sources that were
   deleted just drop out; zero survivors = error, not an empty prompt.
4. **Card→transcript lighting** (the reverse of the hover direction):
   selecting cards on the canvas lights the rail lines that built them
   (`railHighlight` in Weave → `highlight` prop). Rail hover still wins when
   both are active, and selection scrolls the first lit line into view;
   hover never scrolls (the pointer is already there).

## 2026-07-17 — Weave: quality-of-life batch (evening)

1. **Connector dots pop in the card's colour** on hover — radio-button style
   (colour dot + panel gap + colour ring via box-shadow on the Handle,
   reading --card so custom types work for free).
2. **Prompt cards: right-click → Download .md** (`downloadCardMd`, reuses
   export.ts `download`/`slugify`).
3. **Review digest with veto.** When a review actually changes the board it
   shows a wip-tone banner — "✦ Review: {summary} [Undo]" — for 20s. Undo
   restores the PRE-REVIEW SNAPSHOT (not an undo-stack pop, so edits made
   after the review can't get caught in the blast radius); pushHistory first
   so ⌘⇧Z re-applies the review. No-change reviews still use the plain notice.
4. **⌘K search across boards** (BoardSearch.tsx + `allBoards()` in boards.ts —
   ONE Supabase query for all docs, searched client-side; personal scale).
   Hits on card title/body + board titles; ↑↓/↵; jump = openBoard + flash the
   card. ⌘K works even mid-typing (chorded). Toolbar "⌕ Search" too.
   Lint gotcha: `useEffect(() => setActive(0), [query])` is a build ERROR in
   this repo (no sync setState in effects) — clamp the index at read time.
5. **Rail hover shows the whole card-group.** Hovering a transcript line
   already spotlit its cards on canvas; now every OTHER line that fed the same
   card(s) stays lit too and unrelated lines recede — the visible group = how
   many messages built that card. (Chosen over per-card colour coding, which
   runs out of distinguishable colours by card ~8.)
6. **toMarkdown free-type fix:** export iterated only CARD_TYPES, silently
   dropping custom-typed cards (prompt, risk…). Sections now come from the
   board: five workhorses first, customs in first-appearance order.

## 2026-07-17 — Weave: the two-brain architecture (fast mapper + reasoning review)

The speed work (below) bought a fast per-utterance mapper by disabling
thinking. This session adds the slow brain back — in the right place:

1. **Auto-review on mic stop.** When you press Space to stop talking, Weave
   waits for the pipeline to drain (settles → debounce → maps; polled via refs
   `mappingRef`/`settlingRef`/`pending`/`flushTimer`, 30s bound), then runs the
   consolidate pass automatically. Consolidate keeps Gemini's thinking ON —
   per-utterance speed matters, end-of-session judgment matters more. It fixes
   what the fast mapper got wrong: duplicates, wrong update-vs-create calls,
   missed edges. Guarded by `spokeRef` (no speech → no review) and a
   board-at-call check (slow response after board switch must not graft).
2. **Consolidate can now SPLIT overloaded cards** — the one way it may create:
   `split: {id, keepType, keepTitle, keepBody, parts[]}` in the schema, parts
   auto-connected to the original. "You cannot create" became "you may only
   create by splitting". Verified: merged a duplicate + split out a buried
   feature and action + linked a risk, in one pass.
3. **Scope refinements update, not create.** "I want a betting app with the
   best odds" … pause … "it's a parlay app only" used to make two cards. New
   map-prompt rule with the parlay example: a refinement that redefines what a
   thing IS updates that card (test: without folding it in, does the card now
   say something wrong?). Verified against the exact transcript.
4. **Card types are free-form.** `CardType = string`; the model names what a
   point actually is — verified emitting `risk`, `feature`, `revenue model`,
   `requirement`. The five workhorses stay as menu quick-picks and colour
   anchors; unknown types hash onto the existing five palette tokens
   (`typeColor()` in CardNode) so no new colours enter the system.
   `normalizeType()` (types.ts) bounds whatever the model returns; z.enum →
   z.string in all four AI routes.
5. **Split on demand:** right-click → "Split into cards…" → /api/weave/split.
   Unlike consolidate there's no "prefer doing nothing" — the USER judged the
   card too big; the model's only honest refusal is "it's genuinely one
   point". Splitting a pinned card unpins it first (pins guard against the
   mapper, not against an explicit user action; applyOps would silently
   refuse the update otherwise).
6. **Shift+drag = selection box** (React Flow): the gotcha is that Shift was
   in `multiSelectionKeyCode`, which swallowed the box gesture. Shift moved to
   `selectionKeyCode`, ⌘ stays for click-accumulate, `SelectionMode.Partial`.
7. **The IS/HAS rebalance** (same day, after glazy testing): the scope rule
   overcorrected — the mapper started folding everything into one fat card.
   The decision rule is now explicit in the prompt: changes what a thing IS →
   update; something it HAS / DOES / COSTS / NEEDS / RISKS → own card,
   connected. "An update may REWRITE a card; it must never GROW one." Plus
   edge specificity: connect to the most SPECIFIC parent, not the hub ("books
   might ban us" → the scraping card, not the app card — verified). A rich
   single run now yields several wired cards (verified: idea + feature +
   constraint + revenue + risk from one breath, risk correctly hung off the
   feature). Consolidate got the matching rule: a merge must never fatten the
   survivor — extra points come out as split parts.
8. **Voice targeting — "talk at what you're pointing at."** Two entry points,
   one mechanism:
   - **Card**: select exactly one card, press the talk key → the whole session
     is aimed at it. `focusCardRef` is captured on the idle→listening
     transition (from `selectionRef`, synced in the hotkey ref effect), rides
     into `mapBatch` at flush time (NOT cleared on stop — settles trail the
     mic), and is released after the review quiesce. The map route gets
     `focusCardId` and injects an "AIMED AT THIS CARD" block: ambiguity
     resolves toward the card, "most runs deserve nothing" is suspended, and
     the pin is explicitly liftable (aimed speech IS the user editing) — the
     client unpins the focus card before applyOps since the reducer refuses
     pinned updates. A notice ("Speaking to …") confirms the aim. Verified:
     "make it twenty bucks a month actually" aimed at a pinned $10 revenue
     card → direct update to $20; a feature spoken at the app card → connected
     create, not a fold-in.
   - **Transcript line**: double-tap a line to edit, press SPACE before typing
     anything → re-dictate it by voice. Space-before-any-edit is the trigger
     (once the text is touched, space types spaces again). The next final
     REPLACES that line: it reuses the line's utterance id (so the accuracy
     pass flows back to it), auto-stops the mic, and routes through
     `editUtterance` — the same rewind-and-remap machinery as a typed
     correction. `redictateRef {id, captured}` guards against a stray second
     final; stopping before speaking cancels cleanly. Re-dictation skips
     `spokeRef`, so it doesn't trigger the end-of-session review.
9. **Build prompt — the board's exit door.** Right-click a card (or a
   multi-selection containing it) → "Build prompt from N cards…" →
   /api/weave/prompt composes ONE paste-ready build prompt from those cards
   and the edges BETWEEN them (edges outside the selection are deliberately
   excluded — context the user didn't choose isn't part of the ask). Lands as
   a pinned card typed "prompt" (pinned so mapper/review can't rewrite a
   deliverable; type "prompt" renders UNCLAMPED in CardNode — a deliverable
   card is its body) and is copied to the clipboard when the browser allows.
   Thinking disabled — composition, not judgment. Verified: 5 cards → tight
   imperative prompt that fused a risk card and its connected mitigation card
   into one "handle X by Y" instruction, purely from the edge.
10. **Selected cards show a 2px outline** in the card's type colour. Outline
   for selection vs ring (box-shadow) for the mapper-touched flash — different
   CSS mechanisms so they can show simultaneously without clobbering. The
   outline is the ONLY selection visual now: React Flow's blue group overlay
   (`.react-flow__nodesselection-rect`) is display:none'd (glazy: the borders
   already say what's selected) — display, not visibility, so it can't
   intercept pointer events; dragging any selected card still moves the group.
   The 3px type stripe on the card's left edge is gone too (type colour still
   reads from the label, border glow, and outline); card padding back to
   symmetric px-4.

## 2026-07-17 — Weave: cards land ~2× faster (pause → card ≈ 6.5s → ≈ 3s)

Three cuts, all measured against the gateway with the real prompts:

1. **Map call was 3.3–4.1s because Gemini 2.5 Flash thinks by default.**
   `providerOptions: { google: { thinkingConfig: { thinkingBudget: 0 } } }`
   → 1.2–1.5s, and quality held on the tricky cases (filler → nothing,
   restatement → update, feature → connected create). Faster models were tried
   and rejected: 2.5-flash-lite / 3.1-flash-lite are quicker but *miss the
   restatement→update case* (they return nothing); haiku-4.5 took 6–15s.
   The option is gated on `MODEL.startsWith("google/")` so an env override to
   a non-Gemini model isn't sent a Google knob.
2. **Transcription now uses a real STT model, not a chat model.** The gateway
   serves transcription models (`gateway.transcription(...)` +
   `experimental_transcribe` from `ai`): `openai/gpt-4o-mini-transcribe` does
   the accuracy pass in ~0.9–1.0s vs Gemini's 1.3–1.7s, decodes our
   MediaRecorder webm/opus slices fine, and the gateway reports exact billed
   USD in `providerMetadata.gateway.cost` (better than token math). The old
   Gemini path stays as an in-route fallback for clips the STT model rejects
   (e.g. odd container slices from WKWebView's audio/mp4 recorder).
3. **`PAUSE_MS` 1500 → 900.** The post-settle debounce sits squarely between
   the speaker pausing and the card appearing; 900ms still groups same-run
   utterances given the accuracy pass's ~1s ± 0.5s jitter.

**Dev-server gotcha re-learned:** a long-lived `npm run dev` outlives its
`VERCEL_OIDC_TOKEN` — gateway calls then *hang* (not 401), which looks exactly
like a broken route. Restart the dev server before debugging AI routes.

**Next up (agreed with glazy, not built yet):** optimistic mapping — map the
live Web Speech text immediately at `onFinal` (in parallel with the accuracy
pass) so the card appears the moment you pause, then reconcile via the existing
correction re-map when the refined transcript differs. Pairs with letting a
continued thought after a pause update the just-created card.

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

**Weave Bar — the Mac app** (`~/WeaveBar`, installed to `/Applications`).
Menu bar icon → Weave opens as a real window AND the app appears in the Dock;
close it → Dock icon goes, app stays in the menu bar. That's an activation
policy flip: Accessory (LSUIElement) at rest, Regular while the window is open.
It's a WKWebView on **`/weave`** — the bare route, no workspace sidebar; a
sidebar listing other tools is noise inside an app that IS one tool. Built the
Desk Notes way: Objective-C + clang + ad-hoc codesign, no Xcode.

Things that would otherwise cost an hour each:
- **WKWebView ignores `<input type=file>` entirely** without
  `runOpenPanelWithParameters` — the click lands, the page never hears back,
  and "Attach photo" looks like a dead button. Chrome has a picker built in; a
  bare web view has nothing.
- **WKWebView denies `getUserMedia` silently** — the page just sees a mic that
  never works. `requestMediaCapturePermissionForOrigin` is what actually grants
  it; `NSMicrophoneUsageDescription` only drives macOS's own prompt.
- **`webkitSpeechRecognition` DOES exist in WKWebView** (probed it: `"function"`,
  and the app confirms the board renders with speech live). Desk Notes bundling
  whisper.cpp was a choice, not a workaround.
- **The web view outlives the window** — closing hides it. Rebuilding would
  reload the board, drop the mic session, and cost a Supabase round-trip per open.
- **A Regular app with no main menu has no ⌘C/⌘V/⌘Q** — the shortcuts live on
  menu items, so the web view couldn't even copy. Hence `buildMenu`.
- **Flip the policy to Accessory in a deferred block** on window close; doing it
  inline is too early and the Dock icon can survive it.
- **No traffic lights**, and the window opens on the ACTIVE Space. Without
  `NSWindowCollectionBehaviorMoveToActiveSpace` the window keeps whichever Space
  it was born on, so clicking the icon threw you onto a different desktop
  instead of showing up where you were. ⌘W replaces the close button.
- **The app can't be screenshotted by computer-use** — an LSUIElement app has no
  Dock identity to allowlist, so the compositor hides it. Verify it through
  `osascript` window counts and `evaluateJavaScript` logs instead.

Since it's a shell around the live site, **shipping the website updates the app**.
Rebuild only for shell changes.

**Shell change:** `ToolPage` gained generic `bleed` (no max-width, no page
scroll) and `hideHeader` props for tools that own their viewport. Kept generic
per golden rule 3.

**Two board themes, scoped (☾/☀ in the toolbar, light default).** `weave.css`
re-points the SAME semantic tokens (`--bg`, `--panel`, `--fg`, `--border`,
accents) under `.weave-light` / `.weave-dark`. Every component flips on its own,
none of them know a theme exists, nothing outside the scope changes — no
component needed editing and no raw hex entered them (golden rule 5 in spirit).
- **light** — a whiteboard. Accents keep their hue but darken (`--accent`
  `#d8ff3e` → `#5f7d00`): they're used for text and 1.5px strokes, and the
  dark-theme lime is invisible on white.
- **dark** — neon (per glazy's Weave reference). Near-black `#08080c` field,
  cards lit in their type colour. The glow is ONE rule: `.weave-dark
  .weave-card` reads the `--card` var each node already sets inline from its
  type, so all five types (and any added later) are covered by
  `color-mix(in srgb, var(--card) …)` in the border + box-shadow. `--planned`
  (fact) goes grey → `#7aa2ff`; grey has no neon register.

**Cost, not a timer.** The header showed minutes since the board's first
utterance, which climbed while the tab just sat there. It shows real spend now
(`7 cards · $0.002`). Pricing comes from `gateway.getAvailableModels()` — a
hard-coded price table would be wrong the moment Google moved a number, and
quiet about it. Every route returns its call's cost; `doc.spend` accumulates it
per board. A mapped sentence ≈ $0.001, an expand ≈ $0.004.

**⚠️ applyOps silently ate a field.** It rebuilt the doc from an explicit key
list (`{cards, edges, utterances, questions}`), so `spend` was banked and wiped
microseconds later by the very next op — and the NEXT field added would have
gone the same way. It spreads `input` now.

**Talk key is rebindable (⚙), including bare modifiers** (⌘/⌃/⌥/⇧/Caps).
Modifiers fire their own keydown when pressed alone, so excluding them was just
wrong. Two catches: the handler's normal "held with a modifier ⇒ that's a chord,
not our key" rule must be skipped when the binding IS a modifier, or it can
never fire; and `e.repeat` has to be guarded, since holding a key repeats
keydown and a toggle must fire once per press. The UI warns when a modifier is
bound (⌘+C would start listening as it copies). Escape stays reserved as
capture's way out. **Fn is not bindable** — browsers don't report a keydown for
it on macOS. Stored as `event.code` (layout-independent, unlike `key`), and the
capture listener runs in the CAPTURE phase so the key you press can't be
swallowed by the binding it's replacing.

**Type as well as talk.** A box at the foot of the rail runs the same pipeline
with no mic. Double-click any transcript line to fix what it misheard.

**No confidence score.** Cut entirely — model, schemas, prompts, UI. It was
meant to separate "you clearly said this" from "half-caught from a mumble", but
models can't self-rate: every AI card came back ~100%, so the dots and % were
decoration. An unused required field still costs prompt tokens and model
attention on every card, so it went from `Card`, all three route schemas, and
the reducer — not just the UI.

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

**Expand a node** (`✨ Expand` on the card's footer, on hover →
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

**Right-click a card** → Duplicate · Attach file or photo · Type · Delete.
Right-click, not left: left-click already selects and drags, so a menu there
would fire on every touch of a card.
- **Duplicate** is offset, `pinned`, and deliberately carries neither the
  original's edges nor its `sourceUtteranceIds` — a copy is a new thought, not
  a second face on the original's relationships.
- **Type is the colour picker.** Colour IS type here; keeping them welded is the
  only reason a zoomed-out board still means anything. A free-colour option was
  offered and declined for exactly that reason.
- **Attachments** go to Supabase Storage (`docs/weave-storage.sql`: bucket +
  anon policies, already run on prod). The card keeps a URL — inlining a photo
  as base64 would re-upload the whole picture on every autosave and bloat the
  row. Object path is `boardId/uuid.ext`, so same-named photos can't collide and
  URLs aren't guessable. Public-read bucket: fine for a password-gated
  single-user tool, but **don't put anything sensitive on a card**. Deleting a
  card removes its files too (fire-and-forget — a failed cleanup must never
  block the delete), or the bucket fills with orphans nothing points at.

**⚠️ Tailwind's `group-open:` emits nothing in this build** — not one
rotate-180 rule in the output — so every `<details>` chevron using it was
silently frozen, ToolPage's included. Fixed globally with a plain `.chevron`
rule in globals.css, which also works in server components where a state-driven
flip can't.

**Delete** — red `✕` badge on the card's top-left corner, revealed on hover
(matches Weave's own). No confirm: undo is a better answer than a dialog on
every card. `⌫` on a selection still works too. Edges get a faint `⊗` at their
midpoint (custom `DeletableEdge`). It's always visible rather than
hover-revealed because `EdgeLabelRenderer` **portals the label out of the edge's
SVG group** — there's no ancestor to hang a `:hover` off.

**⚠️ Card hijacking (glazy hit this live).** "lets make a brand new app called
Glazys for basketball", with "Create a new app — Tinder for developers" on the
board, returned `update_card`: it RENAMED the Tinder card, destroying idea one
and losing idea two. The model matched on the *category* ("making an app")
rather than the specific thing. Fix: the prompt now says a different thing of
the same kind is not a restatement (two apps = two cards), and calls out "a
brand new / another / a different / a separate / a second / also" as the speaker
explicitly signalling a new thing. Verified fixed, and a real restatement
("basically a dating app for programmers") still correctly updates.

**Correcting a transcript line = rewind, then re-map.** `Utterance.before`
snapshots what each card said before this line changed it. On edit, the cards
it wrongly altered are restored **in code**, then the corrected text is mapped
against the clean board — which naturally lands the point in a new card. Asking
the model to restore-and-split in one step half-worked: it made the new card and
left the damage, ending up with two Glazys cards. Don't ask a model to do what
you can do deterministically. Cards the line *created* are left standing (the
`correcting` payload) so they keep their id and position and get updated in
place.

**Auto charts.** A spoken series becomes bars: "10k in Jan, 15k in Feb, 22k in
March" → a `fact` card with `chart: ChartPoint[]`. Separate `chart` list in the
map schema (not a field on every card), values coerced to plain numbers by the
model ("10k" → 10000). Two-point minimum, enforced in code as well as prompt —
one number is a sentence, not a chart. Verified it fires on a series and on
same-measure categories, and does NOT fire on a lone number or mixed units.
Chart bars are `height: %` — the columns must **stretch** (no `items-end`), or
the percentage resolves against a column that shrank to its content and nothing
renders.

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
