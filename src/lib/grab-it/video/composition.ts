import type { SceneAsset, VideoPlan } from "./types";

// 9:16 — the source posts are reels/shorts.
const WIDTH = 1080;
const HEIGHT = 1920;
const COMP_ID = "main";
const AUDIO_FILE = "assets/source.mp4";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Ken Burns start/end transforms. Scale stays above 1 throughout so the image
// never reveals an edge as it moves.
function motionTween(motion: SceneAsset["motion"]): {
  from: string;
  to: string;
} {
  switch (motion) {
    case "zoom-in":
      return { from: "scale: 1.0, xPercent: 0", to: "scale: 1.14, xPercent: 0" };
    case "zoom-out":
      return { from: "scale: 1.14, xPercent: 0", to: "scale: 1.0, xPercent: 0" };
    case "pan-left":
      return {
        from: "scale: 1.14, xPercent: 4",
        to: "scale: 1.14, xPercent: -4",
      };
    case "pan-right":
      return {
        from: "scale: 1.14, xPercent: -4",
        to: "scale: 1.14, xPercent: 4",
      };
  }
}

// Builds a standalone HyperFrames composition:
//  - sized root, no <template> wrapper (standalone form)
//  - the scene fill lives on a full-bleed child, never on the root itself
//  - <audio> is a DIRECT child of the root, pointing at the source MP4 (the
//    framework extracts the audio track, so nothing needs demuxing)
//  - exactly one paused GSAP timeline registered on window.__timelines
export function buildComposition(
  plan: VideoPlan,
  scenes: SceneAsset[],
  meta: { author: string },
): string {
  const duration = plan.duration;

  const sceneMarkup = scenes
    .map((s, i) => {
      const id = `scene-${i + 1}`;
      const caption = s.caption
        ? `<div class="cap"><p id="${id}-cap">${escapeHtml(s.caption)}</p></div>`
        : "";
      // The Ken Burns scale deliberately pushes the image past its frame so the
      // crop can move; data-layout-allow-overflow declares that to the checker.
      return `      <section id="${id}" class="clip" data-start="${s.start.toFixed(
        2,
      )}" data-duration="${s.duration.toFixed(2)}" data-track-index="1">
        <div class="fill"><img id="${id}-img" class="kb" src="${s.file}" alt="" data-layout-allow-overflow /></div>
        ${caption}
      </section>`;
    })
    .join("\n");

  // Every tween is authored on the main timeline at GLOBAL time.
  // Scenes hard-cut rather than cross-fade: the framework owns .clip
  // visibility, so animating a clip's own opacity fights it. Continuous Ken
  // Burns carries the motion across the cut instead.
  const tweens = scenes
    .map((s, i) => {
      const id = `scene-${i + 1}`;
      const { from, to } = motionTween(s.motion);
      const lines = [
        `        tl.fromTo("#${id}-img", { ${from} }, { ${to}, duration: ${s.duration.toFixed(
          2,
        )}, ease: "none" }, ${s.start.toFixed(2)});`,
      ];
      if (s.caption) {
        lines.push(
          `        tl.fromTo("#${id}-cap", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, ${(
            s.start + 0.15
          ).toFixed(2)});`,
        );
      }
      return lines.join("\n");
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <title>${escapeHtml(meta.author)} — b-roll cut</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body { margin: 0; background: #000; }
      #root {
        position: relative;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        overflow: hidden;
        font-family: Inter, system-ui, -apple-system, sans-serif;
      }
      /* Full-bleed backdrop child — a fill on #root itself can render black. */
      #backdrop { position: absolute; inset: 0; background: #05070a; }
      .clip { position: absolute; inset: 0; overflow: hidden; }
      .fill { position: absolute; inset: 0; overflow: hidden; }
      .kb {
        display: block;
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        object-fit: cover;
        transform-origin: 50% 50%;
        will-change: transform;
      }
      .cap {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 210px;
        display: flex;
        justify-content: center;
        padding: 0 84px;
      }
      /* Transformed elements must be block-level and sized. */
      .cap p {
        display: block;
        margin: 0;
        width: 100%;
        max-width: 912px;
        text-align: center;
        font-size: 74px;
        font-weight: 800;
        line-height: 1.16;
        letter-spacing: -0.02em;
        color: #fff;
        text-shadow: 0 4px 28px rgba(0, 0, 0, 0.62);
      }
      /* Keeps captions legible over bright images. */
      #scrim {
        position: absolute;
        inset: 0;
        background: linear-gradient(
          to bottom,
          rgba(0, 0, 0, 0.28) 0%,
          rgba(0, 0, 0, 0) 34%,
          rgba(0, 0, 0, 0) 52%,
          rgba(0, 0, 0, 0.6) 100%
        );
        pointer-events: none;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="${COMP_ID}"
      data-start="0"
      data-width="${WIDTH}"
      data-height="${HEIGHT}"
      data-duration="${duration.toFixed(2)}"
    >
      <div id="backdrop"></div>
${sceneMarkup}
      <div id="scrim"></div>
      <audio
        id="source-audio"
        src="${AUDIO_FILE}"
        data-start="0"
        data-duration="${duration.toFixed(2)}"
        data-media-start="${plan.audioStart.toFixed(2)}"
        data-track-index="10"
        data-volume="1"
      ></audio>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${tweens}
      window.__timelines["${COMP_ID}"] = tl;
    </script>
  </body>
</html>
`;
}
