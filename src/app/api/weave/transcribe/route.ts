// Weave — the accuracy pass. Recorded audio in, better text out.
//
// The browser's Web Speech API gives us text fast enough to map while someone
// is still talking, but it mangles names, jargon, and anything said quickly.
// This route re-transcribes the same audio properly, so the live text is a
// draft and this is the version that sticks.

import { generateText } from "ai";
import { costOf } from "@/lib/weave/cost";

export const maxDuration = 60;

const MODEL = process.env.WEAVE_TRANSCRIBE_MODEL ?? "google/gemini-2.5-flash";

const SYSTEM = `You transcribe short clips of someone thinking out loud.

Transcribe the audio verbatim. Punctuate and capitalise naturally, but do not
clean up, summarise, paraphrase, or complete the speaker's thoughts — false
starts and half-sentences are meaningful here and must survive.

Return ONLY the transcript text. No preamble, no quotes around it, no
commentary, no speaker labels, no timestamps. If the audio contains no
intelligible speech, return an empty string.`;

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

    const { text, usage } = await generateText({
      model: MODEL,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Transcribe this audio." },
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

    return Response.json({ text: text.trim(), cost: await costOf(MODEL, usage) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed.";
    return Response.json({ error: message }, { status: 500 });
  }
}
