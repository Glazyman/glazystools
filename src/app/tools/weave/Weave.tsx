"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { CARD_H, CARD_W, freeSpotNear, tidy } from "@/lib/weave/layout";
import { applyOps, removeCard } from "@/lib/weave/ops";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  renameBoard,
  saveBoard,
} from "@/lib/weave/boards";
import {
  CARD_TYPES,
  emptyDoc,
  type BoardDoc,
  type BoardMeta,
  type Card,
  type CardType,
  type OpenQuestion,
  type Op,
  type PendingCommand,
  type WeaveEdge,
} from "@/lib/weave/types";
import { Board, type BoardApi } from "./Board";
import { CardMenu, type CardMenuState } from "./CardMenu";
import { Lightbox, type LightboxState } from "./Lightbox";
import { deleteAttachment, uploadAttachment } from "@/lib/weave/attachments";
import { TranscriptRail } from "./TranscriptRail";
import { BoardSearch, type SearchHit } from "./BoardSearch";
import { useSpeech } from "./useSpeech";
import {
  download,
  downloadDataUrl,
  slugify,
  toMarkdown,
  type ExportKind,
} from "./export";
import "./weave.css";

const LAST_BOARD = "weave:lastBoard";
const RAIL_OPEN = "weave:railOpen";
const THEME = "weave:theme";
const TALK_KEY = "weave:talkKey";

/** Stored as KeyboardEvent.code — layout-independent, unlike `key`. */
const DEFAULT_TALK_KEY = "Space";

/**
 * Modifiers are bindable. They fire their own keydown when pressed alone, so
 * there's no reason to exclude them — but the handler has to know, because its
 * normal "ignore anything held with a modifier" rule would make the binding
 * unreachable by itself.
 */
const MODIFIER_CODES: Record<string, string> = {
  MetaLeft: "⌘ Left",
  MetaRight: "⌘ Right",
  ControlLeft: "⌃ Left",
  ControlRight: "⌃ Right",
  AltLeft: "⌥ Left",
  AltRight: "⌥ Right",
  ShiftLeft: "⇧ Left",
  ShiftRight: "⇧ Right",
  CapsLock: "Caps Lock",
};

function isModifierKey(code: string): boolean {
  return code in MODIFIER_CODES;
}

/** "KeyT" → "T", "Digit1" → "1", "MetaLeft" → "⌘ Left". */
function keyLabel(code: string): string {
  if (MODIFIER_CODES[code]) return MODIFIER_CODES[code];
  if (code === "Space") return "Space";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

// ── Batching ──────────────────────────────────────────────────────────────
//
// One model call per sentence is both wasteful and worse: the mapper would see
// "I need a patent app" / "actually the backlog is the problem" / "so ship
// without the API" as three unrelated fragments rather than one argument.
// Buffering until you pause hands it the whole thought at once — and cuts calls
// by 3-5x, which is the difference between working and rate-limited.

/** Silence that ends a run of speech. Long enough to survive a breath — but
 *  every ms here sits between the speaker pausing and the card appearing, so
 *  it stays as short as run-grouping allows. Utterances that belong to one
 *  run finalise close together; their settles land within this window even
 *  with the accuracy pass's jitter (~1s ± 0.5s). */
const PAUSE_MS = 900;
/** Flush early rather than let an uninterrupted monologue bank up forever. */
const MAX_BATCH = 6;
const MAX_WAIT_MS = 12000;

export function Weave() {
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [doc, setDoc] = useState<BoardDoc>(emptyDoc);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving">(
    "saved",
  );
  const [interim, setInterim] = useState("");
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [spotlight, setSpotlight] = useState<Set<string> | null>(null);
  const [expanding, setExpanding] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(0);
  const [menu, setMenu] = useState<CardMenuState | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [mapping, setMapping] = useState(0);
  const [consolidating, setConsolidating] = useState(false);
  const [merging, setMerging] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last review changed, plus the board as it was — the veto. */
  const [reviewDigest, setReviewDigest] = useState<{
    summary: string;
    before: BoardDoc;
  } | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Spoken commands awaiting the hand that confirms them. Commands aimed at
   *  the SELECTION run straight away (deletes excepted — a misheard "delete
   *  that" must never cost a card); commands naming a card wait here. */
  const [pendingCommands, setPendingCommands] = useState<PendingCommand[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Rail open/closed, remembered across sessions. Read via useSyncExternalStore
  // rather than an effect: localStorage doesn't exist during SSR, and reading it
  // in a lazy useState initialiser would break the server render.
  const railStored = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem(RAIL_OPEN) !== "0",
    () => true, // server: assume open, so it never flashes shut on hydrate
  );
  const [railOverride, setRailOverride] = useState<boolean | null>(null);
  const railOpen = railOverride ?? railStored;
  // The write stays OUT of the setState updater: StrictMode double-invokes
  // updaters to check purity, so a side effect in there runs twice and the
  // second pass reads back its own write — which silently persisted the
  // opposite of what you clicked.
  const toggleRail = useCallback(() => {
    const next = !railOpen;
    localStorage.setItem(RAIL_OPEN, next ? "1" : "0");
    setRailOverride(next);
  }, [railOpen]);

  // Board theme. Light by default — it's a whiteboard. Same SSR-safe read as
  // the rail; the workspace around it stays dark either way.
  const themeStored = useSyncExternalStore(
    () => () => {},
    () => (localStorage.getItem(THEME) === "dark" ? "dark" : "light"),
    () => "light" as const,
  );
  const [themeOverride, setThemeOverride] = useState<"light" | "dark" | null>(
    null,
  );
  const theme = themeOverride ?? themeStored;
  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME, next);
    setThemeOverride(next);
  }, [theme]);

  // Which key toggles talking. Same SSR-safe read as the two above.
  const talkKeyStored = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem(TALK_KEY) || DEFAULT_TALK_KEY,
    () => DEFAULT_TALK_KEY,
  );
  const [talkKeyOverride, setTalkKeyOverride] = useState<string | null>(null);
  const talkKey = talkKeyOverride ?? talkKeyStored;
  const setTalkKey = useCallback((code: string) => {
    localStorage.setItem(TALK_KEY, code);
    setTalkKeyOverride(code);
  }, []);

  // docRef is the real source of truth. Async work (a map response landing
  // seconds later) must never read a stale doc from a closure, so every
  // mutation updates the ref synchronously and the state only for rendering.
  const docRef = useRef<BoardDoc>(emptyDoc());
  const boardIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const history = useRef<{ past: BoardDoc[]; future: BoardDoc[] }>({
    past: [],
    future: [],
  });
  // Utterances waiting to be mapped as one run. See the batching notes above.
  const pending = useRef<{ id: string; text: string }[]>([]);
  const flushTimer = useRef<number | null>(null);
  const batchStartedAt = useRef(0);

  // The auto-review that fires when you stop talking needs live values inside
  // an async wait loop, where React state would be a stale snapshot.
  /** Mirrors `mapping` — how many map calls are in flight. */
  const mappingRef = useRef(0);
  /** Mirrors `speech.settling` — accuracy passes still in flight. */
  const settlingRef = useRef(false);
  /** Anything actually said since listening started? No speech, no review. */
  const spokeRef = useRef(false);

  // Voice targeting: what your speech is aimed at.
  /** Cards selected when listening started — this session speaks AT them.
   *  One card = full aimed mapping; several = mostly a command target. */
  const focusCardRef = useRef<string[] | null>(null);
  /** Executes a spoken command; assigned after the executors exist (they are
   *  declared far below mapBatch, which needs to call this). */
  const runCommandRef = useRef<(cmd: PendingCommand) => void>(() => {});
  /** A transcript line being re-spoken. `captured` flips on its first final,
   *  so a stray second final can't hijack the replacement. */
  const redictateRef = useRef<{ id: string; captured: boolean } | null>(null);
  /** Mirrors `selection` for the moment the talk key fires. */
  const selectionRef = useRef<string[]>([]);
  const boardApi = useRef<BoardApi | null>(null);

  const markDirty = useCallback(() => {
    setSaveState("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      const id = boardIdRef.current;
      if (!id) return;
      setSaveState("saving");
      try {
        await saveBoard(id, docRef.current);
        setSaveState("saved");
      } catch {
        setSaveState("dirty");
        setError("Couldn't save to Supabase — your changes are still here.");
      }
    }, 800);
  }, []);

  /** The only sanctioned way to mutate the board. */
  const updateDoc = useCallback(
    (fn: (d: BoardDoc) => BoardDoc) => {
      const next = fn(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      setDoc(next);
      markDirty();
    },
    [markDirty],
  );

  /** Load/replace without marking dirty — nothing has changed yet. */
  const resetDoc = useCallback((d: BoardDoc) => {
    docRef.current = d;
    setDoc(d);
    history.current = { past: [], future: [] };
    setCanUndo(false);
    setCanRedo(false);
    setSaveState("saved");
  }, []);

  const pushHistory = useCallback(() => {
    const h = history.current;
    h.past.push(docRef.current);
    if (h.past.length > 60) h.past.shift();
    h.future = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(docRef.current);
    docRef.current = prev;
    setDoc(prev);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
    markDirty();
  }, [markDirty]);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    docRef.current = next;
    setDoc(next);
    setCanUndo(true);
    setCanRedo(h.future.length > 0);
    markDirty();
  }, [markDirty]);

  /**
   * Bank what a call cost. Kept on the board rather than a global counter so
   * the number answers "what did THIS thinking cost", which is the only
   * version of the question worth asking.
   */
  const addSpend = useCallback(
    (usd: number | null | undefined) => {
      if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return;
      updateDoc((d) => ({ ...d, spend: (d.spend ?? 0) + usd }));
    },
    [updateDoc],
  );

  const flashCards = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setFlash(new Set(ids));
    setTimeout(() => setFlash(new Set()), 1500);
  }, []);


  /** Drop a half-built batch — it belongs to the board you just left. */
  const dropBatch = useCallback(() => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    pending.current = [];
    batchStartedAt.current = 0;
  }, []);

  // ── Boards ──────────────────────────────────────────────────────────────

  const openBoard = useCallback(
    async (id: string) => {
      setLoading(true);
      dropBatch();
      try {
        const b = await getBoard(id);
        boardIdRef.current = b.id;
        setBoardId(b.id);
        setTitle(b.title);
        resetDoc(b.doc);
        localStorage.setItem(LAST_BOARD, b.id);
      } catch {
        setError("Couldn't open that board.");
      } finally {
        setLoading(false);
      }
    },
    [resetDoc, dropBatch],
  );

  useEffect(() => {
    (async () => {
      try {
        const list = await listBoards();
        if (list.length === 0) {
          const b = await createBoard("My first board");
          setBoards([b]);
          await openBoard(b.id);
          return;
        }
        setBoards(list);
        const last = localStorage.getItem(LAST_BOARD);
        const target = list.find((b) => b.id === last) ?? list[0];
        await openBoard(target.id);
      } catch {
        setError(
          "Couldn't reach Supabase. Have you run docs/weave-schema.sql yet?",
        );
        setLoading(false);
      }
    })();
    // Mount only — openBoard is stable and re-running this would clobber state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newBoard = async () => {
    try {
      const b = await createBoard(`Board ${boards.length + 1}`);
      setBoards((prev) => [b, ...prev]);
      await openBoard(b.id);
    } catch {
      setError("Couldn't create a board.");
    }
  };

  const removeBoard = async (id: string) => {
    if (!confirm("Delete this board? This can't be undone.")) return;
    try {
      await deleteBoard(id);
      const rest = boards.filter((b) => b.id !== id);
      setBoards(rest);
      if (boardId === id) {
        if (rest.length) await openBoard(rest[0].id);
        else await newBoard();
      }
    } catch {
      setError("Couldn't delete that board.");
    }
  };

  const commitTitle = async () => {
    const id = boardIdRef.current;
    if (!id) return;
    const clean = title.trim() || "Untitled board";
    setTitle(clean);
    setBoards((prev) =>
      prev.map((b) => (b.id === id ? { ...b, title: clean } : b)),
    );
    try {
      await renameBoard(id, clean);
    } catch {
      setError("Couldn't rename that board.");
    }
  };

  // ── The mapping loop ────────────────────────────────────────────────────

  const mapBatch = useCallback(
    async (
      batch: { id: string; text: string }[],
      correcting?: { id: string; title: string; body: string }[],
      focusCardIds?: string[],
    ) => {
      if (!batch.length) return;
      // A response can land after you've switched boards; applying it then
      // would graft cards onto the wrong board.
      const boardAtCall = boardIdRef.current;
      const ids = batch.map((b) => b.id);
      const text = batch.map((b) => b.text).join(" ");
      const d = docRef.current;
      mappingRef.current += 1;
      setMapping((m) => m + 1);
      try {
        const res = await fetch("/api/weave/map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            utterance: text,
            focusCardIds,
            correcting,
            recent: d.utterances
              .filter((u) => !ids.includes(u.id))
              .slice(-4)
              .map((u) => u.text),
            cards: d.cards.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
              pinned: c.pinned,
            })),
            edges: d.edges.map((e) => ({ source: e.source, target: e.target })),
          }),
        });
        const json = (await res.json()) as {
          ops?: Op[];
          commands?: {
            action: PendingCommand["action"];
            ids: string[];
            reason: string;
          }[];
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        if (boardIdRef.current !== boardAtCall) return;
        const ops = json.ops ?? [];

        // Spoken commands. Aimed at the selection → the speaker pointed AND
        // spoke, so it executes directly; naming a card from across the room
        // → it waits in the rail's questions for a confirming hand. Deletes
        // always wait — a misheard "delete that" must never cost a card.
        const commands = (json.commands ?? [])
          .map((c) => {
            const valid = c.ids.filter((id) =>
              docRef.current.cards.some((x) => x.id === id),
            );
            return {
              key: crypto.randomUUID(),
              boardId: boardAtCall,
              action: c.action,
              ids: valid,
              titles: valid.map(
                (id) =>
                  docRef.current.cards.find((x) => x.id === id)?.title ?? "",
              ),
            };
          })
          .filter((c) => c.ids.length > 0);
        if (commands.length) {
          // The rail labels the lines that gave orders.
          const actions = [...new Set(commands.map((c) => c.action))];
          updateDoc((dd) => ({
            ...dd,
            utterances: dd.utterances.map((u) =>
              ids.includes(u.id)
                ? {
                    ...u,
                    commands: [...new Set([...(u.commands ?? []), ...actions])],
                  }
                : u,
            ),
          }));
          for (const cmd of commands) {
            const aimed =
              !!focusCardIds?.length &&
              cmd.ids.every((id) => focusCardIds.includes(id));
            if (aimed && cmd.action !== "delete") runCommandRef.current(cmd);
            else setPendingCommands((prev) => [...prev, cmd]);
          }
        }

        if (!ops.length) return; // Filler. The overwhelmingly common case.

        pushHistory();
        // Speaking AT pinned cards is the user editing their own cards — the
        // pin guards against unaimed rewrites, not this. applyOps would
        // silently refuse the updates otherwise, so lift them first.
        const base = focusCardIds?.length
          ? {
              ...docRef.current,
              cards: docRef.current.cards.map((c) =>
                focusCardIds.includes(c.id) && c.pinned
                  ? { ...c, pinned: false }
                  : c,
              ),
            }
          : docRef.current;
        const { doc: next, touched } = applyOps(base, ops, ids);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mapping failed.");
      } finally {
        mappingRef.current -= 1;
        setMapping((m) => m - 1);
      }
    },
    [addSpend, flashCards, markDirty, pushHistory, updateDoc],
  );

  const flush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const batch = pending.current;
    pending.current = [];
    batchStartedAt.current = 0;
    // Read the focus at flush time, not per-utterance: settles trail the mic
    // stopping, and the target holds until the whole session's speech lands.
    void mapBatch(batch, undefined, focusCardRef.current ?? undefined);
  }, [mapBatch]);

  const queue = useCallback(
    (id: string, text: string) => {
      if (!text.trim()) return; // Silence produced nothing to map.
      pending.current.push({ id, text });
      if (!batchStartedAt.current) batchStartedAt.current = Date.now();

      if (
        pending.current.length >= MAX_BATCH ||
        Date.now() - batchStartedAt.current >= MAX_WAIT_MS
      ) {
        flush();
        return;
      }
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = window.setTimeout(flush, PAUSE_MS);
    },
    [flush],
  );

  /** Typed straight into the rail. Same pipeline as speech, minus the mic. */
  const addTyped = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const id = crypto.randomUUID();
      updateDoc((d) => ({
        ...d,
        utterances: [
          ...d.utterances,
          { id, text: clean, at: Date.now(), status: "final", cardIds: [] },
        ],
      }));
      // Straight to the mapper: you typed it and pressed Enter, so there's no
      // pause to wait for the way there is with speech.
      void mapBatch([{ id, text: clean }]);
    },
    [mapBatch, updateDoc],
  );

  /**
   * You fixed a mis-heard line. Re-map the corrected text, telling the mapper
   * which cards came from the wrong version so it fixes them in place rather
   * than adding a near-duplicate beside them.
   */
  const editUtterance = useCallback(
    (id: string, text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const u = docRef.current.utterances.find((x) => x.id === id);
      if (!u || u.text === clean) return;

      // Rewind, THEN re-map — rather than asking the model to undo its own
      // mistake. If the mishearing got folded into a card that already existed,
      // that card is put back verbatim here, in code. The mapper then sees the
      // board as if this line had never been said and simply maps the corrected
      // text: which lands the point in a NEW card, because the restored card no
      // longer looks like its home. Asking the model to restore-and-split in
      // one step half-worked — it made the new card and left the damage.
      //
      // Cards this line CREATED are left standing: they're the point's home
      // already, so the mapper updates them in place and they keep their id and
      // their position on the board.
      pushHistory();
      const restored = new Set((u.before ?? []).map((b) => b.id));
      updateDoc((d) => ({
        ...d,
        cards: d.cards.map((c) => {
          const was = u.before?.find((b) => b.id === c.id);
          if (!was || c.pinned) return c;
          return {
            ...c,
            type: was.type,
            title: was.title,
            body: was.body,
            sourceUtteranceIds: c.sourceUtteranceIds.filter((x) => x !== id),
          };
        }),
        utterances: d.utterances.map((x) =>
          x.id === id
            ? {
                ...x,
                text: clean,
                status: "final",
                cardIds: x.cardIds.filter((cid) => !restored.has(cid)),
                before: undefined,
              }
            : x,
        ),
      }));

      // Whatever's left linked to this line is a card it created outright.
      const owned = docRef.current.cards
        .filter(
          (c) =>
            !c.pinned &&
            c.sourceUtteranceIds.length === 1 &&
            c.sourceUtteranceIds[0] === id,
        )
        .map((c) => ({ id: c.id, title: c.title, body: c.body }));

      void mapBatch([{ id, text: clean }], owned);
    },
    [mapBatch, pushHistory, updateDoc],
  );


  const speech = useSpeech({
    onInterim: setInterim,
    onFinal: (text) => {
      // Re-dictating one transcript line: the first final IS the replacement.
      // The line keeps its id, so the settle pass flows back to it, and the
      // mic stops itself — you re-say the line, not start a session.
      const redo = redictateRef.current;
      if (redo) {
        setInterim("");
        if (redo.captured) return ""; // a stray extra final; not tracked
        redo.captured = true;
        updateDoc((d) => ({
          ...d,
          utterances: d.utterances.map((u) =>
            u.id === redo.id ? { ...u, status: "refining" } : u,
          ),
        }));
        setTimeout(() => stopRef.current(), 0); // not from inside onresult
        return redo.id;
      }
      spokeRef.current = true;
      const id = crypto.randomUUID();
      updateDoc((d) => ({
        ...d,
        utterances: [
          ...d.utterances,
          { id, text, at: Date.now(), status: "refining", cardIds: [] },
        ],
      }));
      setInterim("");
      return id;
    },
    onSettled: (id, text, improved) => {
      // The replacement for a re-spoken line goes through the correction
      // machinery — rewind what the old text did, then re-map — not through
      // the normal append-and-queue path.
      if (redictateRef.current?.id === id) {
        redictateRef.current = null;
        updateDoc((d) => ({
          ...d,
          utterances: d.utterances.map((u) =>
            u.id === id ? { ...u, status: improved ? "refined" : "final" } : u,
          ),
        }));
        editUtterance(id, text);
        return;
      }
      updateDoc((d) => ({
        ...d,
        utterances: d.utterances.map((u) =>
          u.id === id
            ? { ...u, text, status: improved ? "refined" : "final" }
            : u,
        ),
      }));
      // Buffered, not mapped: the flush fires once you stop for a breath.
      queue(id, text);
    },
    onError: setError,
    onCost: addSpend,
    // Hand the accuracy pass the board's own words — card titles, and any
    // custom type names the model coined — so it spells recurring jargon the
    // way it already appears. Read from the ref so every pass sees the live
    // board, not a snapshot from when listening began.
    getHints: () => {
      const cards = docRef.current.cards;
      return [
        ...cards.map((c) => c.title),
        ...cards.map((c) => c.type),
      ];
    },
  });

  /** Re-say one transcript line: the next thing spoken replaces it, and its
   *  cards get fixed through the same machinery as a typed correction. */
  const startSpeech = speech.start;
  const redictateUtterance = useCallback(
    (id: string) => {
      redictateRef.current = { id, captured: false };
      setNotice("Listening — say that line again.");
      startSpeech();
    },
    [startSpeech],
  );

  // ── Hotkeys ─────────────────────────────────────────────────────────────

  // Latest-ref pattern: the keydown listener binds once and must never see a
  // stale closure, but rebinding it on every render would be wasteful churn.
  const toggleRef = useRef(speech.toggle);
  const stopRef = useRef(speech.stop);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const talkKeyRef = useRef(talkKey);
  useEffect(() => {
    toggleRef.current = speech.toggle;
    stopRef.current = speech.stop;
    undoRef.current = undo;
    redoRef.current = redo;
    talkKeyRef.current = talkKey;
    selectionRef.current = selection;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K opens search from anywhere, including mid-typing — that's the
      // palette convention, and it's chorded so it can't collide with text.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }

      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (typing) return;

      // Holding a key repeats keydown; a toggle must fire on the press only.
      if (e.repeat) return;

      const bound = talkKeyRef.current;
      if (e.code === bound) {
        // A modifier binding is reached by pressing that modifier — so the
        // usual "held with a modifier means it's a chord, not our key" rule
        // can't apply to it, or it could never fire at all.
        const chord =
          !isModifierKey(bound) && (e.metaKey || e.ctrlKey || e.altKey);
        if (!chord) {
          // Space would otherwise scroll the page.
          e.preventDefault();
          toggleRef.current();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoRef.current();
        else undoRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Which transcript lines made the selected card(s) — the rail lights them
   *  up, so clicking a card answers "what did I say to get this". */
  const railHighlight = useMemo(() => {
    if (!selection.length) return null;
    const picked = new Set(selection);
    const ids = doc.utterances
      .filter((u) => u.cardIds.some((c) => picked.has(c)))
      .map((u) => u.id);
    return ids.length ? new Set(ids) : null;
  }, [selection, doc.utterances]);

  /** Sub-tenth-of-a-cent is true but useless; say so rather than show $0.000. */
  const spendLabel = useMemo(() => {
    const s = doc.spend ?? 0;
    if (s <= 0) return null;
    return s < 0.001 ? "<$0.001" : `$${s.toFixed(3)}`;
  }, [doc.spend]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Card actions ────────────────────────────────────────────────────────

  const onCommitCard = useCallback(
    (id: string, patch: { title: string; body: string }) => {
      pushHistory();
      updateDoc((d) => ({
        ...d,
        // pinned: your words now — the mapper is barred from rewriting them.
        cards: d.cards.map((c) =>
          c.id === id ? { ...c, ...patch, pinned: true } : c,
        ),
      }));
    },
    [pushHistory, updateDoc],
  );

  const onCycleType = useCallback(
    (id: string) => {
      pushHistory();
      updateDoc((d) => ({
        ...d,
        cards: d.cards.map((c) =>
          c.id === id
            ? {
                ...c,
                type: CARD_TYPES[(CARD_TYPES.indexOf(c.type) + 1) % CARD_TYPES.length],
              }
            : c,
        ),
      }));
    },
    [pushHistory, updateDoc],
  );

  // Stable, so Board's publish-once effect doesn't re-fire on every render.
  const handleApi = useCallback((api: BoardApi) => {
    boardApi.current = api;
  }, []);

  /** A hand-made card. Born pinned — you wrote it, so the mapper leaves it. */
  const addCard = useCallback(() => {
    const c = boardApi.current?.viewportCenter() ?? { x: 0, y: 0 };
    // Centre of the view, nudged to the nearest gap: dropping it dead-centre
    // lands it on top of whatever you were already looking at.
    const at = freeSpotNear(docRef.current, {
      x: c.x - CARD_W / 2,
      y: c.y - CARD_H / 2,
    });
    const card: Card = {
      id: crypto.randomUUID(),
      type: "idea",
      title: "New card",
      body: "",
      x: at.x,
      y: at.y,
      createdAt: Date.now(),
      sourceUtteranceIds: [],
      pinned: true,
    };
    pushHistory();
    updateDoc((d) => ({ ...d, cards: [...d.cards, card] }));
    flashCards([card.id]);
  }, [flashCards, pushHistory, updateDoc]);

  /** A copy, offset and pinned — it's yours the moment you make it. */
  const duplicateCard = useCallback(
    (id: string) => {
      const src = docRef.current.cards.find((c) => c.id === id);
      if (!src) return;
      const at = freeSpotNear(docRef.current, { x: src.x + 24, y: src.y + 24 });
      const copy: Card = {
        ...src,
        id: crypto.randomUUID(),
        x: at.x,
        y: at.y,
        createdAt: Date.now(),
        pinned: true,
        // Deliberately no edges and no transcript links: a copy is a new
        // thought, not a second face on the original's relationships.
        sourceUtteranceIds: [],
        attachments: src.attachments ? [...src.attachments] : undefined,
      };
      pushHistory();
      updateDoc((d) => ({ ...d, cards: [...d.cards, copy] }));
      flashCards([copy.id]);
    },
    [flashCards, pushHistory, updateDoc],
  );

  /** Colour follows type, so this is the colour picker. */
  const setCardType = useCallback(
    (id: string, type: CardType) => {
      pushHistory();
      updateDoc((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.id === id ? { ...c, type } : c)),
      }));
    },
    [pushHistory, updateDoc],
  );

  /** Open the viewer on the board rather than throwing you into a new tab. */
  const openFile = useCallback((cardId: string, index: number) => {
    const card = docRef.current.cards.find((c) => c.id === cardId);
    if (!card?.attachments?.length) return;
    setLightbox({ cardId, items: card.attachments, at: index });
  }, []);

  /** Remove a file from a card, and from the bucket. */
  const removeAttachment = useCallback(
    (cardId: string, path: string) => {
      void deleteAttachment(path);
      pushHistory();
      updateDoc((d) => ({
        ...d,
        cards: d.cards.map((c) =>
          c.id === cardId
            ? { ...c, attachments: (c.attachments ?? []).filter((a) => a.path !== path) }
            : c,
        ),
      }));
      // Keep the viewer honest about what's left: close on the last one, and
      // don't leave `at` pointing past the end.
      setLightbox((lb) => {
        if (!lb || lb.cardId !== cardId) return lb;
        const items = lb.items.filter((a) => a.path !== path);
        if (!items.length) return null;
        return { ...lb, items, at: Math.min(lb.at, items.length - 1) };
      });
    },
    [pushHistory, updateDoc],
  );

  /**
   * Attach a file. One hidden <input type=file> is reused for every card —
   * `attachTarget` remembers which one asked, because the picker is a system
   * dialog and can't carry the card with it.
   */
  const attachTarget = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const askForFile = useCallback((id: string) => {
    attachTarget.current = id;
    fileInput.current?.click();
  }, []);

  const onFilesPicked = useCallback(
    async (files: FileList | null) => {
      const id = attachTarget.current;
      attachTarget.current = null;
      const boardAtCall = boardIdRef.current;
      if (!id || !files?.length || !boardAtCall) return;

      setUploading((n) => n + 1);
      try {
        const added = await Promise.all(
          [...files].map((f) => uploadAttachment(boardAtCall, f)),
        );
        if (boardIdRef.current !== boardAtCall) return;
        pushHistory();
        updateDoc((d) => ({
          ...d,
          cards: d.cards.map((c) =>
            c.id === id
              ? { ...c, attachments: [...(c.attachments ?? []), ...added] }
              : c,
          ),
        }));
        flashCards([id]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't attach that.");
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [flashCards, pushHistory, updateDoc],
  );

  /** No confirm — undo (⌘Z) is a better answer than a dialog on every card. */
  const deleteCard = useCallback(
    (id: string) => {
      // Take its files with it, or the bucket fills with orphans nothing points
      // at. Fire-and-forget: the card goes now, regardless.
      const card = docRef.current.cards.find((c) => c.id === id);
      card?.attachments?.forEach((a) => void deleteAttachment(a.path));
      pushHistory();
      updateDoc((d) => removeCard(d, id));
    },
    [pushHistory, updateDoc],
  );

  /** Ask the AI what this card implies but nobody has said yet. */
  const expandCard = useCallback(
    async (id: string) => {
      const boardAtCall = boardIdRef.current;
      setExpanding((prev) => new Set(prev).add(id));
      try {
        const d = docRef.current;
        const res = await fetch("/api/weave/expand", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cardId: id,
            cards: d.cards.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
            })),
            edges: d.edges.map((e) => ({ source: e.source, target: e.target })),
          }),
        });
        const json = (await res.json()) as {
          ops?: Op[];
          summary?: string;
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        const ops = json.ops ?? [];
        if (!ops.length) {
          setNotice("Nothing worth adding there.");
          return;
        }
        if (boardIdRef.current !== boardAtCall) return;
        pushHistory();
        const { doc: next, touched } = applyOps(docRef.current, ops);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
        setNotice(json.summary ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Expand failed.");
      } finally {
        setExpanding((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    },
    [addSpend, flashCards, markDirty, pushHistory],
  );

  /** One overloaded card → its distinct points, connected. */
  const splitCard = useCallback(
    async (id: string) => {
      const boardAtCall = boardIdRef.current;
      // Reuses the expand spinner: the card pulses "Thinking…" while the AI
      // works, which is exactly what's happening.
      setExpanding((prev) => new Set(prev).add(id));
      try {
        const d = docRef.current;
        const res = await fetch("/api/weave/split", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cardId: id,
            cards: d.cards.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
            })),
            edges: d.edges.map((e) => ({ source: e.source, target: e.target })),
          }),
        });
        const json = (await res.json()) as {
          ops?: Op[];
          summary?: string;
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        const ops = json.ops ?? [];
        if (!ops.length) {
          setNotice(json.summary ?? "That card is already a single point.");
          return;
        }
        if (boardIdRef.current !== boardAtCall) return;
        pushHistory();
        // Splitting rewrites the original by definition, and the user asked
        // for it by hand — so a pin (which exists to stop the MAPPER rewriting
        // your words) must not block it. Unpin, then apply.
        const unpinned = {
          ...docRef.current,
          cards: docRef.current.cards.map((c) =>
            c.id === id && c.pinned ? { ...c, pinned: false } : c,
          ),
        };
        const { doc: next, touched } = applyOps(unpinned, ops);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
        setNotice(json.summary ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Split failed.");
      } finally {
        setExpanding((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    },
    [addSpend, flashCards, markDirty, pushHistory],
  );

  /**
   * Selected cards → one card. The AI only writes the TEXT (one title/body
   * carrying everything the chosen cards said); which card survives and where
   * the edges go is decided here, deterministically. The earliest-created card
   * is the one that lives on — it's the root of the thought, and keeping its
   * id keeps its transcript links meaningful.
   */
  const mergeCards = useCallback(
    async (ids: string[]) => {
      const boardAtCall = boardIdRef.current;
      const chosen = docRef.current.cards.filter((c) => ids.includes(c.id));
      if (chosen.length < 2 || merging) return;

      setMerging(true);
      // The expand spinner: every chosen card pulses "Thinking…" while the AI
      // writes the combined text.
      setExpanding((prev) => {
        const n = new Set(prev);
        chosen.forEach((c) => n.add(c.id));
        return n;
      });
      try {
        const res = await fetch("/api/weave/merge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cards: chosen.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
            })),
          }),
        });
        const json = (await res.json()) as {
          merged?: { type: string; title: string; body: string };
          summary?: string;
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        const merged = json.merged;
        if (!merged?.title?.trim()) throw new Error("The merge came back empty.");
        if (boardIdRef.current !== boardAtCall) return;

        // Re-read the doc — cards can vanish while the model thinks.
        const live = docRef.current.cards.filter((c) => ids.includes(c.id));
        if (live.length < 2) return;
        const anchor = live.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
        const gone = new Set(
          live.map((c) => c.id).filter((id) => id !== anchor.id),
        );
        const re = (id: string) => (gone.has(id) ? anchor.id : id);

        const survivor: Card = {
          ...anchor,
          type: merged.type,
          title: merged.title.trim(),
          body: merged.body.trim(),
          // Everything the sources owned moves onto the survivor: files,
          // transcript lineage, the first chart among them.
          chart: anchor.chart ?? live.find((c) => c.chart?.length)?.chart,
          attachments: (() => {
            const all = live.flatMap((c) => c.attachments ?? []);
            return all.length ? all : undefined;
          })(),
          sourceUtteranceIds: [
            ...new Set(live.flatMap((c) => c.sourceUtteranceIds)),
          ],
          // A pin guards hand-edited words from the mapper; merging folded
          // those words in, so the guard carries over.
          pinned: live.some((c) => c.pinned) || undefined,
          promptSources: (() => {
            const all = [
              ...new Set(live.flatMap((c) => c.promptSources ?? []).map(re)),
            ].filter((id) => id !== anchor.id);
            return all.length ? all : undefined;
          })(),
        };

        pushHistory();
        updateDoc((d) => {
          // Every edge that touched a merged card now touches the survivor —
          // minus self-loops, and deduped treating A→B and B→A as one.
          const seen = new Set<string>();
          const edges: WeaveEdge[] = [];
          for (const e of d.edges) {
            const s = re(e.source);
            const t = re(e.target);
            if (s === t) continue;
            const key = [s, t].sort().join("|");
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push(
              s === e.source && t === e.target
                ? e
                : { ...e, id: `${s}->${t}`, source: s, target: t },
            );
          }
          return {
            ...d,
            cards: d.cards
              .filter((c) => !gone.has(c.id))
              .map((c) => {
                if (c.id === anchor.id) return survivor;
                // Prompt lineage elsewhere on the board follows the merge too.
                if (c.promptSources?.some((id) => gone.has(id))) {
                  return {
                    ...c,
                    promptSources: [...new Set(c.promptSources.map(re))],
                  };
                }
                return c;
              }),
            edges,
            questions: d.questions.map((q) =>
              q.cardId && gone.has(q.cardId) ? { ...q, cardId: anchor.id } : q,
            ),
            utterances: d.utterances.map((u) =>
              u.cardIds.some((id) => gone.has(id))
                ? { ...u, cardIds: [...new Set(u.cardIds.map(re))] }
                : u,
            ),
          };
        });
        flashCards([anchor.id]);
        setNotice(json.summary ?? `Merged ${live.length} cards.`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Merge failed.");
      } finally {
        setMerging(false);
        setExpanding((prev) => {
          const n = new Set(prev);
          chosen.forEach((c) => n.delete(c.id));
          return n;
        });
      }
    },
    [addSpend, flashCards, merging, pushHistory, updateDoc],
  );

  /**
   * The exit door: selected cards → one paste-ready build prompt, landed as a
   * pinned card (pinned so neither the mapper nor the review pass rewrites a
   * deliverable) and copied to the clipboard.
   */
  const buildPromptFrom = useCallback(
    async (ids: string[], anchorId: string) => {
      const boardAtCall = boardIdRef.current;
      const d = docRef.current;
      const chosen = d.cards.filter((c) => ids.includes(c.id));
      if (!chosen.length) return;

      setExpanding((prev) => new Set(prev).add(anchorId));
      try {
        const res = await fetch("/api/weave/prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cards: chosen.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
            })),
            // Only edges within the selection — context outside it wasn't chosen.
            edges: d.edges
              .filter((e) => ids.includes(e.source) && ids.includes(e.target))
              .map((e) => ({ source: e.source, target: e.target, label: e.label })),
          }),
        });
        const json = (await res.json()) as {
          title?: string;
          prompt?: string;
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        const prompt = (json.prompt ?? "").trim();
        if (!prompt) throw new Error("The prompt came back empty.");
        if (boardIdRef.current !== boardAtCall) return;

        const src = docRef.current.cards.find((c) => c.id === anchorId);
        const at = freeSpotNear(docRef.current, {
          x: (src?.x ?? 0) + CARD_W + 60,
          y: src?.y ?? 0,
        });
        const card: Card = {
          id: crypto.randomUUID(),
          type: "prompt",
          title: json.title?.trim() || "Build prompt",
          body: prompt,
          x: at.x,
          y: at.y,
          createdAt: Date.now(),
          sourceUtteranceIds: [],
          pinned: true,
          // Lineage: so "Regenerate" can re-read these cards as they are then.
          promptSources: ids,
        };
        pushHistory();
        updateDoc((dd) => ({ ...dd, cards: [...dd.cards, card] }));
        flashCards([card.id]);

        let copied = false;
        try {
          await navigator.clipboard.writeText(prompt);
          copied = true;
        } catch {
          // Clipboard needs focus/permission; the card still has the text.
        }
        setNotice(
          copied
            ? "Build prompt card created — and copied to your clipboard."
            : "Build prompt card created. Double-click it to copy the text.",
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Prompt failed.");
      } finally {
        setExpanding((prev) => {
          const n = new Set(prev);
          n.delete(anchorId);
          return n;
        });
      }
    },
    [addSpend, flashCards, pushHistory, updateDoc],
  );

  /** The right-click entry: inside your selection means "from these";
   *  an unselected card means "from this one". */
  const buildPrompt = useCallback(
    (cardId: string) => {
      const sel = selectionRef.current;
      const ids = sel.length > 1 && sel.includes(cardId) ? sel : [cardId];
      return buildPromptFrom(ids, cardId);
    },
    [buildPromptFrom],
  );

  /**
   * A prompt card is a snapshot; the idea keeps moving after it's taken.
   * Regenerate re-reads the SOURCE cards as they are NOW and rewrites the
   * prompt in place — same card, same position, fresh deliverable.
   */
  const regeneratePrompt = useCallback(
    async (id: string) => {
      const boardAtCall = boardIdRef.current;
      const d = docRef.current;
      const promptCard = d.cards.find((c) => c.id === id);
      if (!promptCard) return;
      const wanted = new Set(promptCard.promptSources ?? []);
      const sources = d.cards.filter((c) => wanted.has(c.id));
      if (!sources.length) {
        setError("None of this prompt's source cards are still on the board.");
        return;
      }
      setExpanding((prev) => new Set(prev).add(id));
      try {
        const srcIds = sources.map((c) => c.id);
        const res = await fetch("/api/weave/prompt", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cards: sources.map((c) => ({
              id: c.id,
              type: c.type,
              title: c.title,
              body: c.body,
            })),
            edges: d.edges
              .filter(
                (e) => srcIds.includes(e.source) && srcIds.includes(e.target),
              )
              .map((e) => ({ source: e.source, target: e.target, label: e.label })),
          }),
        });
        const json = (await res.json()) as {
          title?: string;
          prompt?: string;
          cost?: number;
          error?: string;
        };
        if (json.error) throw new Error(json.error);
        addSpend(json.cost);
        const prompt = (json.prompt ?? "").trim();
        if (!prompt) throw new Error("The prompt came back empty.");
        if (boardIdRef.current !== boardAtCall) return;

        pushHistory();
        updateDoc((dd) => ({
          ...dd,
          cards: dd.cards.map((c) =>
            c.id === id
              ? { ...c, title: json.title?.trim() || c.title, body: prompt }
              : c,
          ),
        }));
        flashCards([id]);

        let copied = false;
        try {
          await navigator.clipboard.writeText(prompt);
          copied = true;
        } catch {
          // Clipboard needs focus/permission; the card still has the text.
        }
        setNotice(
          copied
            ? `Prompt regenerated from ${sources.length} card${sources.length > 1 ? "s" : ""} — copied to your clipboard.`
            : `Prompt regenerated from ${sources.length} card${sources.length > 1 ? "s" : ""}.`,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Regenerate failed.");
      } finally {
        setExpanding((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    },
    [addSpend, flashCards, pushHistory, updateDoc],
  );

  /** Prompt card → .md on disk, ready to drop into a repo or a build tool. */
  const downloadCardMd = useCallback((id: string) => {
    const card = docRef.current.cards.find((c) => c.id === id);
    if (!card) return;
    download(
      `${slugify(card.title)}.md`,
      `# ${card.title}\n\n${card.body}\n`,
      "text/markdown",
    );
  }, []);

  const answerQuestion = useCallback(
    (q: OpenQuestion) => {
      pushHistory();
      const ops: Op[] = [
        {
          op: "create_card",
          ref: "q",
          type: "question",
          title: q.text,
          body: "",
          connectTo: q.cardId ? [q.cardId] : undefined,
        },
      ];
      const { doc: next, touched } = applyOps(docRef.current, ops);
      const withPin = {
        ...next,
        cards: next.cards.map((c) =>
          touched.includes(c.id) ? { ...c, pinned: true } : c,
        ),
        questions: next.questions.filter((x) => x.id !== q.id),
      };
      docRef.current = withPin;
      setDoc(withPin);
      markDirty();
      flashCards(touched);
    },
    [flashCards, markDirty, pushHistory],
  );

  // ── Board actions ───────────────────────────────────────────────────────

  const consolidate = async () => {
    if (consolidating) return; // one review at a time — auto + click can race
    if (docRef.current.cards.length < 2) {
      setNotice("Not enough on the board to consolidate yet.");
      return;
    }
    const boardAtCall = boardIdRef.current;
    setConsolidating(true);
    try {
      const d = docRef.current;
      const res = await fetch("/api/weave/consolidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cards: d.cards.map((c) => ({
            id: c.id,
            type: c.type,
            title: c.title,
            body: c.body,
            pinned: c.pinned,
          })),
          edges: d.edges.map((e) => ({ source: e.source, target: e.target })),
        }),
      });
      const json = (await res.json()) as {
        ops?: Op[];
        summary?: string;
        cost?: number;
        error?: string;
      };
      if (json.error) throw new Error(json.error);
      addSpend(json.cost);
      // A slow response can land after a board switch; these ops belong to
      // the board they were computed from, not whatever is open now.
      if (boardIdRef.current !== boardAtCall) return;
      const ops = json.ops ?? [];
      if (ops.length) {
        const before = docRef.current;
        pushHistory();
        const { doc: next, touched } = applyOps(before, ops);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
        // The digest, not a notice: the review edited the board on its own,
        // so it owes you what it did — and a way to say no.
        setReviewDigest({
          summary: json.summary ?? "Board reviewed.",
          before,
        });
      } else {
        setNotice(json.summary ?? "Nothing needed changing.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Consolidate failed.");
    } finally {
      setConsolidating(false);
    }
  };

  /** Executes a spoken command — directly for selection-aimed ones, or from
   *  the rail's confirm question for the rest. */
  const runCommand = useCallback(
    (cmd: PendingCommand) => {
      setPendingCommands((prev) => prev.filter((c) => c.key !== cmd.key));
      // The board may have changed hands since the words were said.
      if (boardIdRef.current !== cmd.boardId) return;
      const alive = cmd.ids.filter((id) =>
        docRef.current.cards.some((c) => c.id === id),
      );
      if (!alive.length) return;
      switch (cmd.action) {
        case "delete": {
          pushHistory();
          const { doc: next } = applyOps(
            docRef.current,
            alive.map((id) => ({ op: "delete_card" as const, id })),
          );
          docRef.current = next;
          setDoc(next);
          markDirty();
          setNotice(`Deleted ${cmd.titles.map((t) => `“${t}”`).join(", ")}.`);
          break;
        }
        case "expand":
          for (const id of alive) void expandCard(id);
          break;
        case "prompt":
          void buildPromptFrom(alive, alive[0]);
          break;
      }
    },
    [buildPromptFrom, expandCard, markDirty, pushHistory],
  );
  useEffect(() => {
    runCommandRef.current = runCommand;
  });

  const skipCommand = useCallback((key: string) => {
    setPendingCommands((prev) => prev.filter((c) => c.key !== key));
  }, []);

  /** The veto: put the board back exactly as it was before the review.
   *  A snapshot restore rather than an undo-stack pop, so edits you made
   *  AFTER the review can't get caught in the blast radius. */
  const vetoReview = useCallback(() => {
    if (!reviewDigest) return;
    pushHistory(); // ⌘⇧Z can bring the review's version back
    docRef.current = reviewDigest.before;
    setDoc(reviewDigest.before);
    markDirty();
    setReviewDigest(null);
    setNotice("Review undone.");
  }, [reviewDigest, markDirty, pushHistory]);

  // A digest that sits forever becomes chrome; one that vanishes in four
  // seconds can't be read. Twenty is long enough to glance and decide.
  useEffect(() => {
    if (!reviewDigest) return;
    const t = setTimeout(() => setReviewDigest(null), 20_000);
    return () => clearTimeout(t);
  }, [reviewDigest]);

  // ── The end-of-session review ───────────────────────────────────────────
  //
  // Stopping the mic is the "I'm done" signal. The per-utterance mapper is
  // deliberately fast and shallow (thinking disabled); this is where the slow
  // brain runs — once the pipeline drains, the consolidate pass reads the
  // whole board with reasoning on and fixes what the fast passes got wrong:
  // duplicates, wrong update-vs-create calls, overloaded cards, missed edges.
  // Same latest-ref pattern as the hotkeys: written in an effect (never during
  // render), no dep array so it resyncs after every render.
  const consolidateRef = useRef(consolidate);
  useEffect(() => {
    consolidateRef.current = consolidate;
    settlingRef.current = speech.settling;
  });
  const prevSpeechState = useRef(speech.state);
  useEffect(() => {
    const was = prevSpeechState.current;
    prevSpeechState.current = speech.state;

    // Session start: aim the session. A single selected card becomes the
    // target every spoken run maps AT; a re-dictation (already aimed at a
    // transcript line) takes precedence over whatever happens to be selected.
    if (speech.state === "listening" && was !== "listening") {
      spokeRef.current = false;
      if (!redictateRef.current && selectionRef.current.length > 0) {
        const targets = [...selectionRef.current];
        focusCardRef.current = targets;
        if (targets.length === 1) {
          const card = docRef.current.cards.find((c) => c.id === targets[0]);
          if (card)
            setNotice(`Speaking to “${card.title}” — say what should change.`);
        } else {
          setNotice(
            `Speaking to ${targets.length} cards — describe them or give a command.`,
          );
        }
      } else {
        focusCardRef.current = null;
      }
      return;
    }

    if (was !== "listening" || speech.state !== "idle") return;
    // Stopping before the replacement was spoken cancels the re-dictation.
    if (redictateRef.current && !redictateRef.current.captured) {
      redictateRef.current = null;
    }
    if (!spokeRef.current) {
      focusCardRef.current = null;
      return; // mic opened and closed without a word
    }
    spokeRef.current = false;
    const boardAtStop = boardIdRef.current;
    void (async () => {
      // Let the tail of the pipeline land first — accuracy passes, the
      // batching debounce, map calls — bounded so one wedged request can't
      // hold the review hostage forever.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (
          !settlingRef.current &&
          mappingRef.current === 0 &&
          pending.current.length === 0 &&
          flushTimer.current === null
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      if (boardIdRef.current !== boardAtStop) return;
      // The target held through the trailing settles/maps; release it before
      // the review so the next session starts unaimed.
      focusCardRef.current = null;
      void consolidateRef.current();
    })();
  }, [speech.state]);

  // ── Cross-board search ──────────────────────────────────────────────────

  const jumpToHit = useCallback(
    async (hit: SearchHit) => {
      setSearchOpen(false);
      if (boardIdRef.current !== hit.boardId) await openBoard(hit.boardId);
      if (hit.cardId) flashCards([hit.cardId]);
    },
    [flashCards, openBoard],
  );

  const doTidy = () => {
    if (!doc.cards.length) return;
    pushHistory();
    updateDoc((d) => ({ ...d, cards: tidy(d) }));
  };

  const clearBoard = () => {
    if (!doc.cards.length && !doc.utterances.length) return;
    if (!confirm("Clear this board? Undo (⌘Z) will bring it back.")) return;
    pushHistory();
    updateDoc(() => emptyDoc());
  };

  const exportAs = async (kind: ExportKind) => {
    const name = slugify(title);
    try {
      switch (kind) {
        case "claude": {
          // Straight to the clipboard, ready to paste into a chat — the same
          // structured markdown the file export writes, minus the download.
          await navigator.clipboard.writeText(toMarkdown(title, doc));
          setNotice("Board copied — paste it into Claude.");
          return;
        }
        case "md":
          download(`${name}.md`, toMarkdown(title, doc), "text/markdown");
          return;
        case "json":
          download(
            `${name}.json`,
            JSON.stringify({ title, ...doc }, null, 2),
            "application/json",
          );
          return;
        case "png":
        case "svg": {
          if (!doc.cards.length) {
            setNotice("Nothing to export yet.");
            return;
          }
          const url = await boardApi.current?.exportImage(kind);
          if (!url) throw new Error("The board couldn't be rendered.");
          downloadDataUrl(`${name}.${kind}`, url);
          return;
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "That export didn't go through.",
      );
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const listening = speech.state === "listening";
  const busy = mapping > 0;

  return (
    // weave-light re-points the shared design tokens at light values for this
    // subtree only — see weave.css. Dark needs no class: the workspace's own
    // :root tokens already are the dark theme.
    <div
      className={[
        "weave-root flex h-full flex-col",
        theme === "light" ? "weave-light" : "weave-dark",
      ].join(" ")}
    >
      {/* Toolbar.
          data-drag marks this as a window drag handle for the desktop app —
          the Mac shell watches for a mousedown on any empty part of it and
          hands the drag to the window. Inert in a browser. */}
      <div
        data-drag
        className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5"
      >
        <button
          onClick={toggleRail}
          title={railOpen ? "Hide transcript" : "Show transcript"}
          className="rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          {railOpen ? "◧" : "▢"}
        </button>

        <BoardMenu
          boards={boards}
          boardId={boardId}
          title={title}
          onTitle={setTitle}
          onCommitTitle={commitTitle}
          onOpen={openBoard}
          onNew={newBoard}
          onDelete={removeBoard}
        />

        <div className="mx-1 h-5 w-px bg-border" />

        <button
          onClick={speech.toggle}
          disabled={speech.state === "unsupported"}
          className={[
            "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
            listening
              ? "bg-accent-2 text-bg"
              : "bg-accent text-bg hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40",
          ].join(" ")}
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full bg-bg",
              listening ? "animate-pulse" : "",
            ].join(" ")}
          />
          {listening ? "Stop" : "Talk"}
        </button>

        {busy && (
          <span className="font-mono text-[10px] text-accent">mapping…</span>
        )}
        {speech.settling && !busy && (
          <span className="font-mono text-[10px] text-subtle">
            sharpening…
          </span>
        )}
        {uploading > 0 && (
          <span className="font-mono text-[10px] text-accent">attaching…</span>
        )}

        <TB onClick={addCard} title="Add a card by hand">
          + Card
        </TB>

        <div className="ml-auto flex items-center gap-1.5">
          {selection.length > 0 && (
            <span className="mr-1 font-mono text-[10px] text-subtle">
              {selection.length} selected · ⌫ deletes
            </span>
          )}
          <span
            className="font-mono text-[10px] text-subtle"
            title={spendLabel ? "What this board has cost you in AI" : undefined}
          >
            {doc.cards.length} card{doc.cards.length === 1 ? "" : "s"}
            {spendLabel && ` · ${spendLabel}`}
          </span>

          <div className="mx-1 h-5 w-px bg-border" />

          {/* Undo/redo carry more weight than the text buttons beside them —
              they're the escape hatch, and you look for them in a hurry. */}
          <button
            onClick={undo}
            disabled={!canUndo}
            title="Undo (⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base font-semibold leading-none text-fg transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:border-border disabled:text-subtle disabled:opacity-40"
          >
            ↺
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            title="Redo (⇧⌘Z)"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-base font-semibold leading-none text-fg transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:border-border disabled:text-subtle disabled:opacity-40"
          >
            ↻
          </button>
          <TB onClick={() => setSearchOpen(true)} title="Search every board (⌘K)">
            ⌕ Search
          </TB>
          <TB onClick={doTidy} disabled={!doc.cards.length} title="Tidy layout">
            Tidy
          </TB>
          <TB
            onClick={consolidate}
            disabled={consolidating || doc.cards.length < 2}
            title="Merge duplicates, tighten titles, add missed links"
          >
            {consolidating ? "Consolidating…" : "✦ Consolidate"}
          </TB>

          <ExportMenu onExport={exportAs} />

          <TB onClick={clearBoard} title="Clear the board">
            Clear
          </TB>
          <TB
            onClick={toggleTheme}
            title={theme === "light" ? "Dark board" : "Light board"}
          >
            {theme === "light" ? "☾" : "☀"}
          </TB>
          <SettingsMenu talkKey={talkKey} onTalkKey={setTalkKey} />

          <span
            className="ml-1 font-mono text-[10px]"
            style={{
              color:
                saveState === "saved" ? "var(--live)" : "var(--fg-subtle)",
            }}
            title={saveState}
          >
            ● {saveState}
          </span>
        </div>
      </div>

      {/* Banners */}
      {speech.state === "unsupported" && (
        <Banner tone="wip">
          This browser has no speech recognition. Weave needs Chrome (or Edge)
          for the live transcript.
        </Banner>
      )}
      {speech.state === "denied" && (
        <Banner tone="accent-2">
          Microphone blocked. Allow mic access in the address bar, then tap
          Space again.
        </Banner>
      )}
      {error && (
        <Banner tone="accent-2" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="live" onDismiss={() => setNotice(null)}>
          {notice}
        </Banner>
      )}
      {reviewDigest && (
        <Banner tone="wip" onDismiss={() => setReviewDigest(null)}>
          ✦ Review: {reviewDigest.summary}{" "}
          <button
            onClick={vetoReview}
            className="ml-2 rounded border border-current px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-opacity hover:opacity-70"
          >
            Undo
          </button>
        </Banner>
      )}

      {/* Rail + canvas */}
      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <TranscriptRail
            utterances={doc.utterances}
            highlight={railHighlight}
            interim={interim}
            questions={doc.questions}
            commandAsks={pendingCommands}
            onCommandConfirm={runCommand}
            onCommandSkip={skipCommand}
            listening={listening}
            level={speech.level}
            talkKeyLabel={keyLabel(talkKey)}
            onSpotlight={(ids) => setSpotlight(ids ? new Set(ids) : null)}
            onSubmitText={addTyped}
            onEditUtterance={editUtterance}
            onRedictate={redictateUtterance}
            onDismissQuestion={(id) =>
              updateDoc((d) => ({
                ...d,
                questions: d.questions.filter((q) => q.id !== id),
              }))
            }
            onAnswerQuestion={answerQuestion}
          />
        )}

        <div className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <span className="font-mono text-xs text-subtle">loading…</span>
            </div>
          ) : boardId ? (
            <>
              <Board
                // Remount per board: resets viewport and selection, and lets
                // React Flow's own `fitView` prop frame each board on open.
                key={boardId}
                boardId={boardId}
                doc={doc}
                flash={flash}
                spotlight={spotlight}
                expanding={expanding}
                onDoc={updateDoc}
                onHistory={pushHistory}
                onSelect={setSelection}
                onCommitCard={onCommitCard}
                onCycleType={onCycleType}
                onExpand={expandCard}
                onDelete={deleteCard}
                onOpenFile={openFile}
                onCardContextMenu={(card, x, y) => setMenu({ card, x, y })}
                onApi={handleApi}
              />
              {/* Selection actions — docked on the left edge of the canvas
                  whenever two or more cards are picked. Multi-card verbs live
                  here; single-card ones stay on the right-click menu. */}
              {selection.length >= 2 && (
                <div className="absolute left-3 top-3 z-10 w-48 overflow-hidden rounded-[10px] border border-border bg-panel py-1 shadow-card">
                  <div className="px-3 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-subtle">
                    {selection.length} cards selected
                  </div>
                  <button
                    onClick={() => void mergeCards(selection)}
                    disabled={merging}
                    className="block w-full px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {merging ? "Merging…" : "⇥ Merge into one card"}
                  </button>
                  <button
                    onClick={() => void buildPrompt(selection[0])}
                    className="block w-full px-3 py-1.5 text-left text-xs text-fg transition-colors hover:bg-hover"
                  >
                    ✦ Build prompt from these…
                  </button>
                </div>
              )}
              {doc.cards.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="max-w-xs text-center">
                    <p className="text-sm text-muted">
                      Nothing here yet.
                    </p>
                    <p className="mt-1.5 text-xs leading-relaxed text-subtle">
                      Tap Space and think out loud. Cards appear as you land on
                      something worth keeping — filler is ignored.
                    </p>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>

      {lightbox && (
        <Lightbox
          state={lightbox}
          onClose={() => setLightbox(null)}
          onMove={(at) => setLightbox((lb) => (lb ? { ...lb, at } : lb))}
          onDelete={removeAttachment}
        />
      )}

      {searchOpen && (
        <BoardSearch
          onClose={() => setSearchOpen(false)}
          onJump={(hit) => void jumpToHit(hit)}
        />
      )}
      {menu && (
        <CardMenu
          state={menu}
          onClose={() => setMenu(null)}
          selectionCount={
            selection.includes(menu.card.id) ? selection.length : 1
          }
          onMerge={() => void mergeCards(selection)}
          onDuplicate={duplicateCard}
          onSplit={splitCard}
          onBuildPrompt={buildPrompt}
          onDownloadMd={downloadCardMd}
          onRegenerate={regeneratePrompt}
          onSetType={setCardType}
          onAttach={askForFile}
          onDelete={deleteCard}
        />
      )}

      {/* One picker for every card — see askForFile. Value is cleared each time
          so attaching the same file twice in a row still fires a change. */}
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void onFilesPicked(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** Toolbar button. */
function TB({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function Banner({
  children,
  tone,
  onDismiss,
}: {
  children: React.ReactNode;
  tone: "wip" | "live" | "accent-2";
  onDismiss?: () => void;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-xs"
      style={{ color: `var(--${tone})` }}
    >
      <span className="flex-1">{children}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="font-mono text-[10px] text-subtle hover:text-fg"
        >
          ✕
        </button>
      )}
    </div>
  );
}

/**
 * A <details> menu stays open until you click its summary again — it doesn't
 * close when you pick something, or when you click away, which is what every
 * other menu on earth does. This gives one back a `close()` and the
 * click-outside behaviour.
 */
function useMenu() {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => {
    if (ref.current) ref.current.open = false;
  }, []);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [close]);
  return { ref, close };
}

function SettingsMenu({
  talkKey,
  onTalkKey,
}: {
  talkKey: string;
  onTalkKey: (code: string) => void;
}) {
  const { ref } = useMenu();
  const [capturing, setCapturing] = useState(false);

  // While capturing, the next key you press becomes the binding — so this
  // listener has to outrank every other hotkey on the page, including the
  // current talk key itself. Capture phase + stopPropagation does that.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return; // still holding the key from opening this
      setCapturing(false);
      // Escape is the way out of capture, so it can't also be a binding.
      if (e.code === "Escape") return;
      // Anything else goes — modifiers included. They fire their own keydown.
      onTalkKey(e.code);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, onTalkKey]);

  return (
    <details ref={ref} className="relative">
      <summary
        title="Settings"
        className="cursor-pointer list-none rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg"
      >
        ⚙
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-[10px] border border-border bg-panel p-3 shadow-card">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
          Settings
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-fg">Talk key</div>
            <div className="mt-0.5 text-[11px] leading-snug text-subtle">
              Tap once to start, again to stop.
            </div>
          </div>
          <button
            onClick={() => setCapturing((c) => !c)}
            className={[
              "shrink-0 rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors",
              capturing
                ? "animate-pulse border-accent text-accent"
                : "border-border-strong text-fg hover:bg-hover",
            ].join(" ")}
          >
            {capturing ? "Press a key…" : keyLabel(talkKey)}
          </button>
        </div>
        {isModifierKey(talkKey) && (
          <p
            className="mt-2.5 text-[11px] leading-snug"
            style={{ color: "var(--accent-2)" }}
          >
            Every shortcut that uses {keyLabel(talkKey)} will toggle the mic too
            — {keyLabel(talkKey)}+C will start listening as it copies.
          </p>
        )}
        {talkKey !== DEFAULT_TALK_KEY && (
          <button
            onClick={() => onTalkKey(DEFAULT_TALK_KEY)}
            className="mt-2.5 font-mono text-[10px] uppercase tracking-wider text-subtle transition-colors hover:text-fg"
          >
            Reset to Space
          </button>
        )}
      </div>
    </details>
  );
}

function ExportMenu({ onExport }: { onExport: (kind: ExportKind) => void }) {
  const { ref, close } = useMenu();
  const pick = (kind: ExportKind) => {
    close();
    void onExport(kind);
  };
  return (
    <details ref={ref} className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg">
        Export
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-[10px] border border-border bg-panel shadow-card">
        <ExportItem onClick={() => pick("claude")}>Copy for Claude</ExportItem>
        <ExportItem onClick={() => pick("md")}>Markdown outline</ExportItem>
        <ExportItem onClick={() => pick("png")}>PNG image</ExportItem>
        <ExportItem onClick={() => pick("svg")}>SVG image</ExportItem>
        <div className="my-1 border-t border-border" />
        <ExportItem onClick={() => pick("json")}>JSON</ExportItem>
      </div>
    </details>
  );
}

function ExportItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}

/** "3m" / "2h" / "5d" — enough to tell which board you were just in. */
function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function BoardMenu({
  boards,
  boardId,
  title,
  onTitle,
  onCommitTitle,
  onOpen,
  onNew,
  onDelete,
}: {
  boards: BoardMeta[];
  boardId: string | null;
  title: string;
  onTitle: (t: string) => void;
  onCommitTitle: () => void;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  const { ref, close } = useMenu();
  return (
    // `relative` lives HERE, not on the <details>: anchored to the control, the
    // menu drops straight down under the name instead of hanging off a chevron.
    <div className="relative">
      <details ref={ref}>
        {/* Name and chevron are one button. The name used to be a bare input
            sitting in the toolbar — which looked like a label, behaved like a
            field, and put renaming somewhere you'd never look for it. */}
        <summary className="flex max-w-[240px] cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-elevated">
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
            {title || "Untitled board"}
          </span>
          {/* Drawn, not typed. The "⌄" glyph carries its font's own metrics —
              it hangs below the text's centre line and no amount of alignment
              fixes it. An SVG sits exactly where it's put, and turns over when
              the menu is open. */}
          <svg
            viewBox="0 0 12 12"
            aria-hidden
            className="chevron h-3 w-3 shrink-0 text-subtle"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.75 L6 7.75 L9 4.75" />
          </svg>
        </summary>
        <div className="absolute left-0 top-full z-20 mt-1.5 w-72 overflow-hidden rounded-[10px] border border-border bg-panel shadow-card">
          {/* Rename lives in here, next to the list of things it could be
              confused with — not in the toolbar pretending to be a heading. */}
          <div className="border-b border-border p-2">
            <div className="mb-1.5 px-1 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
              Name
            </div>
            <input
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              onBlur={onCommitTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCommitTitle();
                  close();
                }
                // Don't let Escape reach the menu's own handler and shut the
                // whole thing while you're mid-word.
                if (e.key === "Escape") e.stopPropagation();
              }}
              placeholder="Untitled board"
              className="w-full rounded-md bg-elevated px-2 py-1.5 text-xs text-fg outline-none ring-1 ring-border transition-shadow focus:ring-border-strong"
            />
          </div>
          <div className="border-b border-border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-subtle">
            Switch to
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {boards.map((b) => {
              const current = b.id === boardId;
              return (
                <div
                  key={b.id}
                  className="group flex items-center gap-2 px-2 transition-colors"
                >
                  <button
                    onClick={() => {
                      close();
                      onOpen(b.id);
                    }}
                    className={[
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      current ? "bg-elevated" : "hover:bg-hover",
                    ].join(" ")}
                  >
                    {/* A dot rather than coloured text: the current board still
                        needs to be readable, not just tinted. */}
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: current ? "var(--accent)" : "transparent",
                      }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-fg">
                      {b.title}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] text-subtle">
                      {ago(b.updated_at)}
                    </span>
                  </button>
                  {/* A real target. This was a 12px glyph at zero opacity until
                      you happened to hover the row — invisible until you found
                      it, then hard to hit once you had. */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                    title={`Delete "${b.title}"`}
                    aria-label={`Delete ${b.title}`}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm text-subtle opacity-40 transition-all hover:bg-hover hover:text-accent-2 hover:opacity-100 group-hover:opacity-100"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => {
              close();
              onNew();
            }}
            className="block w-full border-t border-border px-3 py-2.5 text-left text-xs text-accent transition-colors hover:bg-hover"
          >
            + New board
          </button>
        </div>
      </details>
    </div>
  );
}
