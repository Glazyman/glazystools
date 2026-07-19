// Weave — the accuracy pass. Recorded audio in, better text out.
//
// The browser's Web Speech API gives us text fast enough to map while someone
// is still talking, but it mangles names, jargon, and anything said quickly.
// This route re-transcribes the same audio properly, so the live text is a
// draft and this is the version that sticks.
//
// Speed matters here: the card pipeline waits on this pass, so every ms shows
// up on screen. A dedicated speech-to-text model is roughly twice as fast as
// routing the audio through a chat model, so that's the primary path; the old
// Gemini route survives as the fallback for any clip the STT model rejects.

import { experimental_transcribe as transcribe, generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL =
  process.env.WEAVE_TRANSCRIBE_MODEL ?? "openai/gpt-4o-transcribe";
const FALLBACK_MODEL =
  process.env.WEAVE_TRANSCRIBE_FALLBACK_MODEL ?? "google/gemini-2.5-flash";

const SYSTEM = `You transcribe short clips of someone thinking out loud.

Transcribe the audio verbatim. Punctuate and capitalise naturally, but do not
clean up, summarise, paraphrase, or complete the speaker's thoughts — false
starts and half-sentences are meaningful here and must survive.

Return ONLY the transcript text. No preamble, no quotes around it, no
commentary, no speaker labels, no timestamps. If the audio contains no
intelligible speech, return an empty string.`;

/** The gateway reports the exact billed USD alongside every transcription. */
function gatewayCost(meta: unknown): number | null {
  if (typeof meta !== "object" || meta === null) return null;
  const g = (meta as { gateway?: { cost?: unknown } }).gateway;
  const cost = Number(g?.cost);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");

    if (!(audio instanceof File)) {
      return Response.json(
        { error: "No audio file was uploaded." },
        { status: 400 },
      );
    }

    const data = new Uint8Array(await audio.arrayBuffer());

    // Optional vocabulary hint: the board's own card titles, so the model
    // spells recurring names and jargon the way they already appear. Bounded
    // client-side; clamped again here so a crafted request can't send a novel.
    const hintsRaw = form.get("hints");
    const hints =
      typeof hintsRaw === "string" ? hintsRaw.slice(0, 2000).trim() : "";

    try {
      const { text, providerMetadata } = await transcribe({
        model: gateway.transcription(MODEL),
        audio: data,
        // OpenAI transcription's `prompt` biases spelling toward the terms it
        // contains — the documented way to lock in names and jargon. No
        // `language`: the speaker mixes languages, and pinning one hurts that.
        ...(hints
          ? { providerOptions: { openai: { prompt: hints } } }
          : null),
      });
      return Response.json({
        text: text.trim(),
        cost: gatewayCost(providerMetadata),
      });
    } catch {
      // STT model choked on the clip (odd container slice, unsupported codec).
      // The chat-model path decodes almost anything, so the pass still lands —
      // just slower, on the rare clip that needs it.
    }

    const { text, usage } = await generateText({
      model: FALLBACK_MODEL,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: hints
                ? `Transcribe this audio. These names and terms may appear — spell them this way if you hear them:\n${hints}`
                : "Transcribe this audio.",
            },
            {
              type: "file",
              // MediaRecorder's exact type carries the codec (e.g.
              // 'audio/webm;codecs=opus'), which the model needs to decode it.
              mediaType: audio.type || "audio/webm",
              data,
            },
          ],
        },
      ],
    });

    return Response.json({
      text: text.trim(),
      cost: await costOf(FALLBACK_MODEL, usage),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
