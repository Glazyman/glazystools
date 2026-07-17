"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// ── Web Speech API types ──────────────────────────────────────────────────
//
// Not in TypeScript's default DOM lib, and the shipping implementation is
// still vendor-prefixed in most browsers. These are the minimal shapes we
// actually touch — declared locally so they shadow nothing and augment nothing.

interface SpeechAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechAlternative;
  readonly [index: number]: SpeechAlternative;
}

interface SpeechResultList {
  readonly length: number;
  item(index: number): SpeechResult;
  readonly [index: number]: SpeechResult;
}

interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}

interface SpeechErrorEvent {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognizerCtor = new () => SpeechRecognizer;

type SpeechWindow = Window &
  typeof globalThis & {
    SpeechRecognition?: SpeechRecognizerCtor;
    webkitSpeechRecognition?: SpeechRecognizerCtor;
  };

function getRecognizerCtor(): SpeechRecognizerCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as SpeechWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

// ── Public API ────────────────────────────────────────────────────────────

export type SpeechState = "idle" | "listening" | "unsupported" | "denied";

export type UseSpeechOptions = {
  /** Fires as interim text streams in. Replaces the current interim line. */
  onInterim: (text: string) => void;
  /** Rough live text from Web Speech. Return an id for this utterance. */
  onFinal: (text: string) => string;
  /**
   * Fires exactly once per utterance, always, once the accuracy pass resolves.
   * `text` is the best available: Gemini's if it succeeded, otherwise the
   * original live text unchanged. `improved` says which one you got.
   */
  onSettled: (id: string, text: string, improved: boolean) => void;
  /** Non-fatal problems worth surfacing in the UI. */
  onError?: (message: string) => void;
};

export type UseSpeechResult = {
  state: SpeechState;
  /** True while any accuracy pass is in flight. */
  settling: boolean;
  /** Live input level 0..1, for the mic meter. */
  level: number;
  start: () => void;
  stop: () => void;
  toggle: () => void;
};

// ── Tuning ────────────────────────────────────────────────────────────────

/** Timeslice for MediaRecorder. Small enough to bound the audio we lose at an
 *  utterance boundary, large enough not to drown us in Blobs. */
const CHUNK_MS = 250;
/** Restarts closer together than this are suspicious rather than routine. */
const RESTART_WINDOW_MS = 1000;
/** Give up after this many rapid-fire restarts, rather than spinning forever. */
const MAX_RAPID_RESTARTS = 5;
/** Ignore level changes below this — avoids a setState on every rAF tick. */
const LEVEL_EPSILON = 0.01;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  // Undefined = let the browser pick its own default.
  return undefined;
}

/** Narrow the transcribe route's `{ text }` without trusting it. */
function readText(data: unknown): string {
  if (typeof data !== "object" || data === null || !("text" in data)) return "";
  const { text } = data as { text: unknown };
  return typeof text === "string" ? text : "";
}

function extensionFor(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.startsWith("audio/mp4")) return "mp4";
  if (mime.startsWith("audio/ogg")) return "ogg";
  return "webm";
}

export function useSpeech(opts: UseSpeechOptions): UseSpeechResult {
  // Only the states we can actually be in once we know we're supported. The
  // public `state` folds "unsupported" in below.
  const [internalState, setInternalState] = useState<
    "idle" | "listening" | "denied"
  >("idle");
  const [level, setLevel] = useState(0);
  const [settling, setSettling] = useState(false);

  // The capability itself never changes, so subscribe is a no-op; this is just
  // the sanctioned way to read a browser API without a hydration mismatch. The
  // server snapshot assumes support so SSR doesn't flash an "unsupported"
  // banner at everyone before the client has had a chance to say otherwise.
  const supported = useSyncExternalStore(
    () => () => {},
    () => Boolean(getRecognizerCtor()),
    () => true,
  );

  // Callbacks live in a ref so the recognition handlers always read the latest
  // closures. Rebuilding the recognition object on every render would drop
  // audio mid-sentence. The write happens in an effect (never during render)
  // and deliberately has no dep array — it must resync after every render.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  /** Source of truth for "are we meant to be listening". React state lags
   *  behind the event handlers that need to consult it (notably `onend`,
   *  which fires spontaneously whenever Chrome decides the silence was long
   *  enough), so the ref decides and state merely reflects. */
  const shouldListenRef = useRef(false);
  const startingRef = useRef(false);

  const recognizerRef = useRef<SpeechRecognizer | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const levelRef = useRef(0);

  // Audio buffered since the last utterance finalised. See `sliceUtterance`.
  const chunksRef = useRef<Blob[]>([]);
  /** The recorder's first chunk carries the container's initialisation segment
   *  (the WebM/EBML header). Every later chunk is a bare cluster and won't
   *  decode on its own, so we hold onto the header and re-prepend it to each
   *  slice we ship. */
  const headerChunkRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string | undefined>(undefined);

  const inFlightRef = useRef(0);
  /** Live refinement requests. Aborted only on unmount — a `stop()` must leave
   *  them running, since the caller still needs their `onSettled`. */
  const abortersRef = useRef(new Set<AbortController>());
  const restartCountRef = useRef(0);
  const lastRestartAtRef = useRef(0);
  const mountedRef = useRef(true);

  const setSettlingFromCounter = useCallback(() => {
    if (mountedRef.current) setSettling(inFlightRef.current > 0);
  }, []);

  // ── Accuracy pass ───────────────────────────────────────────────────────

  /**
   * Runs the Gemini pass and settles the utterance — exactly once, on every
   * path. The caller downstream keys its AI mapping step off `onSettled`, so an
   * utterance that never settles is an utterance that silently never becomes a
   * card. That makes "always fires" the load-bearing property here: the fetch
   * lives inside a try whose finally does the settling, and `best` only ever
   * moves off the live text when we hold something strictly better.
   */
  const settle = useCallback(
    async (id: string, live: string, blob: Blob | null) => {
      // Nothing to transcribe (no recorder, or no audio buffered yet) — settle
      // straight away rather than making the caller wait on a no-op.
      if (!blob || blob.size === 0) {
        if (mountedRef.current) optsRef.current.onSettled(id, live, false);
        return;
      }

      let best = live;
      let improved = false;

      inFlightRef.current += 1;
      setSettlingFromCounter();

      const aborter = new AbortController();
      abortersRef.current.add(aborter);

      try {
        const form = new FormData();
        form.append("audio", blob, `utterance.${extensionFor(mimeRef.current)}`);
        const res = await fetch("/api/weave/transcribe", {
          method: "POST",
          body: form,
          signal: aborter.signal,
        });
        if (res.ok) {
          const text = readText(await res.json()).trim();
          // Empty text isn't an improvement, it's a regression — an utterance
          // must never be blanked out by a pass that was meant to sharpen it.
          if (text) {
            best = text;
            improved = true;
          }
        }
      } catch {
        // Network failure, abort, malformed JSON — all non-fatal. The live text
        // is still a perfectly good answer, and `best` already holds it.
      } finally {
        abortersRef.current.delete(aborter);
        inFlightRef.current -= 1;
        setSettlingFromCounter();
        // Unmount is the one case where we stay quiet: there's no React left to
        // call into. Every other path settles.
        if (mountedRef.current) optsRef.current.onSettled(id, best, improved);
      }
    },
    [setSettlingFromCounter],
  );

  /**
   * MediaRecorder gives us one unbroken stream while Web Speech carves that
   * same audio into many utterances, and there's no shared clock between them.
   * So we approximate: everything recorded since the previous finalisation is
   * assumed to be this utterance. We keep the trailing chunk as overlap into
   * the next slice, because a boundary almost always lands mid-word and
   * dropping it clips the next utterance's first syllable.
   */
  const sliceUtterance = useCallback((): Blob | null => {
    const buffered = chunksRef.current;
    if (buffered.length === 0) return null;

    const header = headerChunkRef.current;
    const parts =
      header && buffered[0] !== header ? [header, ...buffered] : [...buffered];

    // Retain the last chunk so the next utterance starts slightly early.
    chunksRef.current = [buffered[buffered.length - 1]];

    return new Blob(parts, { type: mimeRef.current ?? "audio/webm" });
  }, []);

  // ── Teardown ────────────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    shouldListenRef.current = false;

    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    const recognizer = recognizerRef.current;
    if (recognizer) {
      // Handlers stay attached: `stop()` makes the recogniser flush whatever it
      // was still holding, and shouldListenRef is already false so `onend`
      // won't restart it.
      try {
        recognizer.stop();
      } catch {
        // Already stopped.
      }
    }

    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Already stopped.
      }
    }
    recorderRef.current = null;

    // Stopping every track is what actually releases the mic. Dropping the
    // MediaStream reference alone leaves the browser's recording indicator lit
    // for the life of the tab.
    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    streamRef.current = null;

    const ctx = audioCtxRef.current;
    if (ctx && ctx.state !== "closed") void ctx.close();
    audioCtxRef.current = null;
    analyserRef.current = null;

    levelRef.current = 0;
    if (mountedRef.current) setLevel(0);
  }, []);

  const stop = useCallback(() => {
    if (!shouldListenRef.current && !startingRef.current) return;
    startingRef.current = false;
    teardown();
    // A denial is sticky — stopping doesn't win the permission back.
    if (mountedRef.current) {
      setInternalState((prev) => (prev === "denied" ? prev : "idle"));
    }
  }, [teardown]);

  // ── Level meter ─────────────────────────────────────────────────────────

  const startMeter = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyserRef.current = analyser;
    ctx.createMediaStreamSource(stream).connect(analyser);

    const buffer = new Float32Array(analyser.fftSize);
    const tick = () => {
      const node = analyserRef.current;
      if (!node || !shouldListenRef.current) return;
      node.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const sample of buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / buffer.length);
      // Speech RMS rarely exceeds ~0.3, so scale it to make the meter readable.
      const next = Math.min(1, rms * 3);
      if (Math.abs(next - levelRef.current) > LEVEL_EPSILON) {
        levelRef.current = next;
        if (mountedRef.current) setLevel(next);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // ── Start ───────────────────────────────────────────────────────────────

  const start = useCallback(() => {
    // No-op when unsupported: the derived `state` already says so, and there's
    // nothing to construct.
    const Ctor = getRecognizerCtor();
    if (!supported || !Ctor) return;
    if (shouldListenRef.current || startingRef.current) return;
    startingRef.current = true;

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        startingRef.current = false;
        if (mountedRef.current) setInternalState("denied");
        return;
      }

      // A stop() while getUserMedia was still resolving must not leave a live
      // mic behind.
      if (!startingRef.current || !mountedRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      streamRef.current = stream;
      shouldListenRef.current = true;
      startingRef.current = false;
      restartCountRef.current = 0;

      // Recorder — the accuracy tier.
      chunksRef.current = [];
      headerChunkRef.current = null;
      const mime = pickMimeType();
      mimeRef.current = mime;
      try {
        const recorder = new MediaRecorder(
          stream,
          mime ? { mimeType: mime } : undefined,
        );
        // The recorder reports its resolved type when we didn't pin one.
        mimeRef.current = recorder.mimeType || mime;
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size === 0) return;
          if (!headerChunkRef.current) headerChunkRef.current = event.data;
          chunksRef.current.push(event.data);
        };
        recorder.start(CHUNK_MS);
        recorderRef.current = recorder;
      } catch {
        // No recorder means no refinement pass, but live dictation still works.
        recorderRef.current = null;
        optsRef.current.onError?.("Audio recording unavailable — using live transcription only.");
      }

      startMeter(stream);

      // Recogniser — the live tier.
      const recognizer = new Ctor();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = "en-US";

      recognizer.onresult = (event) => {
        restartCountRef.current = 0; // Real results mean it isn't wedged.
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          const transcript = result[0]?.transcript ?? "";
          if (result.isFinal) {
            const text = transcript.trim();
            if (!text) continue;
            const id = optsRef.current.onFinal(text);
            if (!id) continue; // No id means the caller isn't tracking it.
            // sliceUtterance() may return null (no recorder / nothing buffered);
            // settle() handles that itself rather than us dropping the utterance.
            void settle(id, text, sliceUtterance());
          } else {
            interim += transcript;
          }
        }
        if (interim) optsRef.current.onInterim(interim);
      };

      recognizer.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          if (mountedRef.current) setInternalState("denied");
          teardown();
          return;
        }
        // Both are routine: Chrome emits `no-speech` on any quiet stretch and
        // `aborted` whenever we stop it ourselves.
        if (event.error === "no-speech" || event.error === "aborted") return;
        optsRef.current.onError?.(event.message || `Speech error: ${event.error}`);
      };

      recognizer.onend = () => {
        if (!shouldListenRef.current) return;
        // Chrome ends the session on its own after silence, so an `onend` we
        // didn't ask for just means "restart". But if it's ending immediately
        // and repeatedly it's broken, and restarting forever would pin the CPU.
        const now = Date.now();
        restartCountRef.current =
          now - lastRestartAtRef.current < RESTART_WINDOW_MS
            ? restartCountRef.current + 1
            : 1;
        lastRestartAtRef.current = now;
        if (restartCountRef.current > MAX_RAPID_RESTARTS) {
          optsRef.current.onError?.("Speech recognition kept dropping out — stopped listening.");
          teardown();
          if (mountedRef.current) setInternalState("idle");
          return;
        }
        try {
          recognizer.start();
        } catch {
          // Racing an in-flight stop; nothing useful to do.
        }
      };

      try {
        recognizer.start();
      } catch {
        // Some builds throw if a previous session hasn't finished unwinding.
      }
      recognizerRef.current = recognizer;

      if (mountedRef.current) setInternalState("listening");
    })();
  }, [supported, settle, sliceUtterance, startMeter, teardown]);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (shouldListenRef.current || startingRef.current) stop();
    else start();
  }, [supported, start, stop]);

  useEffect(() => {
    mountedRef.current = true;
    // The Set is created once and never reassigned, so capturing it here is the
    // same object the cleanup would have read — it just satisfies the lint rule
    // that can't know that.
    const aborters = abortersRef.current;
    return () => {
      // Order matters: clearing this first means any refinement that resolves
      // during teardown settles into a void rather than a dead component.
      mountedRef.current = false;
      startingRef.current = false;
      teardown();
      // Unmount is the only place we abandon in-flight refinements — nobody is
      // left to receive them, so cancel the network work too.
      for (const aborter of aborters) aborter.abort();
      aborters.clear();
    };
  }, [teardown]);

  // "unsupported" outranks everything internal — without a recogniser we can
  // never have reached any of those states anyway.
  const state: SpeechState = supported ? internalState : "unsupported";

  return { state, settling, level, start, stop, toggle };
}
