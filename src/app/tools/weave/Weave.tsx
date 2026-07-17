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
  type OpenQuestion,
  type Op,
} from "@/lib/weave/types";
import { Board, type BoardApi } from "./Board";
import { TranscriptRail } from "./TranscriptRail";
import { useSpeech } from "./useSpeech";
import { download, slugify, toMarkdown } from "./export";
import "./weave.css";

const LAST_BOARD = "weave:lastBoard";
const RAIL_OPEN = "weave:railOpen";
const THEME = "weave:theme";

// ── Batching ──────────────────────────────────────────────────────────────
//
// One model call per sentence is both wasteful and worse: the mapper would see
// "I need a patent app" / "actually the backlog is the problem" / "so ship
// without the API" as three unrelated fragments rather than one argument.
// Buffering until you pause hands it the whole thought at once — and cuts calls
// by 3-5x, which is the difference between working and rate-limited.

/** Silence that ends a run of speech. Long enough to survive a breath. */
const PAUSE_MS = 1500;
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
  const [selection, setSelection] = useState<string[]>([]);
  const [mapping, setMapping] = useState(0);
  const [consolidating, setConsolidating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    async (batch: { id: string; text: string }[]) => {
      if (!batch.length) return;
      // A response can land after you've switched boards; applying it then
      // would graft cards onto the wrong board.
      const boardAtCall = boardIdRef.current;
      const ids = batch.map((b) => b.id);
      const text = batch.map((b) => b.text).join(" ");
      const d = docRef.current;
      setMapping((m) => m + 1);
      try {
        const res = await fetch("/api/weave/map", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            utterance: text,
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
        const json = (await res.json()) as { ops?: Op[]; error?: string };
        if (json.error) throw new Error(json.error);
        const ops = json.ops ?? [];
        if (!ops.length) return; // Filler. The overwhelmingly common case.
        if (boardIdRef.current !== boardAtCall) return;

        pushHistory();
        const { doc: next, touched } = applyOps(docRef.current, ops, ids);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Mapping failed.");
      } finally {
        setMapping((m) => m - 1);
      }
    },
    [flashCards, markDirty, pushHistory],
  );

  const flush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const batch = pending.current;
    pending.current = [];
    batchStartedAt.current = 0;
    void mapBatch(batch);
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


  const speech = useSpeech({
    onInterim: setInterim,
    onFinal: (text) => {
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
  });

  // ── Hotkeys ─────────────────────────────────────────────────────────────

  // Latest-ref pattern: the keydown listener binds once and must never see a
  // stale closure, but rebinding it on every render would be wasteful churn.
  const toggleRef = useRef(speech.toggle);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => {
    toggleRef.current = speech.toggle;
    undoRef.current = undo;
    redoRef.current = redo;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable);
      if (typing) return;

      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // Space also scrolls the page — always ours here.
        e.preventDefault();
        toggleRef.current();
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

  // Session length, from the first thing you said.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  const minutes = useMemo(() => {
    const first = doc.utterances[0]?.at;
    if (!first) return 0;
    return Math.max(0, Math.round((now - first) / 60000));
  }, [doc.utterances, now]);

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

  /** No confirm — undo (⌘Z) is a better answer than a dialog on every card. */
  const deleteCard = useCallback(
    (id: string) => {
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
          error?: string;
        };
        if (json.error) throw new Error(json.error);
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
    [flashCards, markDirty, pushHistory],
  );

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
    if (doc.cards.length < 2) {
      setNotice("Not enough on the board to consolidate yet.");
      return;
    }
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
        error?: string;
      };
      if (json.error) throw new Error(json.error);
      const ops = json.ops ?? [];
      if (ops.length) {
        pushHistory();
        const { doc: next, touched } = applyOps(docRef.current, ops);
        docRef.current = next;
        setDoc(next);
        markDirty();
        flashCards(touched);
      }
      setNotice(json.summary ?? "Nothing needed changing.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Consolidate failed.");
    } finally {
      setConsolidating(false);
    }
  };

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

  const exportAs = (kind: "md" | "json") => {
    const name = slugify(title);
    if (kind === "md") {
      download(`${name}.md`, toMarkdown(title, doc), "text/markdown");
    } else {
      download(
        `${name}.json`,
        JSON.stringify({ title, ...doc }, null, 2),
        "application/json",
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
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
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

        <span className="font-mono text-[10px] text-subtle">
          tap{" "}
          <kbd className="rounded border border-border bg-elevated px-1 py-0.5 text-[10px] text-muted">
            Space
          </kbd>
        </span>

        {busy && (
          <span className="font-mono text-[10px] text-accent">mapping…</span>
        )}
        {speech.settling && !busy && (
          <span className="font-mono text-[10px] text-subtle">
            sharpening…
          </span>
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
          <span className="font-mono text-[10px] text-subtle">
            {doc.cards.length} card{doc.cards.length === 1 ? "" : "s"}
            {minutes > 0 && ` · ${minutes} min`}
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

      {/* Rail + canvas */}
      <div className="flex min-h-0 flex-1">
        {railOpen && (
          <TranscriptRail
            utterances={doc.utterances}
            interim={interim}
            questions={doc.questions}
            listening={listening}
            level={speech.level}
            onSpotlight={(ids) => setSpotlight(ids ? new Set(ids) : null)}
            onClose={toggleRail}
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
                onApi={handleApi}
              />
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

function ExportMenu({ onExport }: { onExport: (kind: "md" | "json") => void }) {
  const { ref, close } = useMenu();
  const pick = (kind: "md" | "json") => {
    close();
    onExport(kind);
  };
  return (
    <details ref={ref} className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-border px-2.5 py-1 text-[11px] text-muted transition-colors hover:bg-hover hover:text-fg">
        Export
      </summary>
      <div className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[10px] border border-border bg-panel shadow-card">
        <button
          onClick={() => pick("md")}
          className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-hover hover:text-fg"
        >
          Markdown
        </button>
        <button
          onClick={() => pick("json")}
          className="block w-full px-3 py-2 text-left text-xs text-muted hover:bg-hover hover:text-fg"
        >
          JSON
        </button>
      </div>
    </details>
  );
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
    <div className="flex items-center gap-1">
      <input
        value={title}
        onChange={(e) => onTitle(e.target.value)}
        onBlur={onCommitTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Untitled board"
        className="w-40 rounded-md bg-transparent px-2 py-1 text-sm font-medium outline-none transition-colors hover:bg-elevated focus:bg-elevated"
      />
      <details ref={ref} className="relative">
        <summary className="cursor-pointer list-none rounded-md px-1.5 py-1 text-xs text-subtle transition-colors hover:bg-hover hover:text-fg">
          ⌄
        </summary>
        <div className="absolute left-0 z-20 mt-1 w-60 overflow-hidden rounded-[10px] border border-border bg-panel shadow-card">
          <div className="max-h-64 overflow-y-auto">
            {boards.map((b) => (
              <div
                key={b.id}
                className={[
                  "group flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-hover",
                  b.id === boardId ? "text-accent" : "text-muted",
                ].join(" ")}
              >
                <button
                  onClick={() => {
                    close();
                    onOpen(b.id);
                  }}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {b.title}
                </button>
                <button
                  onClick={() => onDelete(b.id)}
                  title="Delete board"
                  className="opacity-0 transition-opacity hover:text-accent-2 group-hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              close();
              onNew();
            }}
            className="block w-full border-t border-border px-3 py-2 text-left text-xs text-accent hover:bg-hover"
          >
            + New board
          </button>
        </div>
      </details>
    </div>
  );
}
