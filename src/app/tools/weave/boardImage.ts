// Weave — render the whole board to an image.
//
// We draw the SVG ourselves from the cards' real on-canvas geometry rather than
// screenshotting the DOM. html-to-image (the obvious route) hangs indefinitely
// against this app's stylesheet — it tries to fetch and inline every web font
// and never resolves — and even when it works it rasterizes text. Hand-drawing
// gives crisp vector output, a tiny file, and a render that cannot wedge: no
// network, no foreignObject, just shapes and <text>.

import { Position, getBezierPath } from "@xyflow/react";
import type { Card } from "@/lib/weave/types";
import { typeColor } from "./CardNode";

/** One card as the exporter needs it: canvas position, measured size, content. */
export type ImageNode = {
  x: number;
  y: number;
  w: number;
  h: number;
  card: Card;
};

export type ImageEdge = { source: string; target: string };

const PAD = 56; // margin around the board in the image
const CARD_PAD_X = 16;
const CARD_PAD_Y = 13;
const RADIUS = 12;

/** The colours the SVG needs, pulled off the live board so light and dark both
 *  come out right. Passed in because only the DOM knows what the tokens resolve
 *  to right now. */
export type Palette = {
  bg: string;
  panel: string;
  border: string;
  fg: string;
  muted: string;
  subtle: string;
  fontFamily: string;
  /** Resolve a `var(--x)` (what typeColor returns) to a real colour. */
  resolveVar: (v: string) => string;
};

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );
}

/** Break text into lines that fit `maxW`, measured in the real font. */
function wrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (ctx.measureText(trial).width > maxW && line) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Build the board's SVG. Returns the markup and the pixel size so a caller can
 * rasterize it to PNG at a chosen scale.
 */
export function boardToSvg(
  nodes: ImageNode[],
  edges: ImageEdge[],
  pal: Palette,
): { svg: string; width: number; height: number } {
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x + n.w));
  const maxY = Math.max(...nodes.map((n) => n.y + n.h));
  const width = Math.round(maxX - minX + PAD * 2);
  const height = Math.round(maxY - minY + PAD * 2);
  // Shift everything so the top-left card sits at (PAD, PAD).
  const ox = PAD - minX;
  const oy = PAD - minY;

  // A canvas 2D context is the honest way to measure text before we commit it
  // to lines — same wrapping the eye will see.
  const meas = document.createElement("canvas").getContext("2d")!;
  const byId = new Map(nodes.map((n) => [n.card.id, n]));

  const parts: string[] = [];

  // Edges first, so cards sit on top of their connectors.
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) continue;
    const [path] = getBezierPath({
      sourceX: s.x + s.w + ox,
      sourceY: s.y + s.h / 2 + oy,
      sourcePosition: Position.Right,
      targetX: t.x + ox,
      targetY: t.y + t.h / 2 + oy,
      targetPosition: Position.Left,
    });
    parts.push(
      `<path d="${path}" fill="none" stroke="${pal.subtle}" stroke-width="1.5" marker-end="url(#arrow)" opacity="0.7"/>`,
    );
  }

  for (const n of nodes) {
    const { card } = n;
    const color = pal.resolveVar(typeColor(card.type));
    const x = n.x + ox;
    const y = n.y + oy;
    const innerW = n.w - CARD_PAD_X * 2;

    parts.push(
      `<rect x="${x}" y="${y}" width="${n.w}" height="${n.h}" rx="${RADIUS}" fill="${pal.panel}" stroke="${pal.border}" stroke-width="1"/>`,
    );

    let cy = y + CARD_PAD_Y + 9;
    // Type label — small, upper, in the card's colour.
    parts.push(
      `<text x="${x + CARD_PAD_X}" y="${cy}" fill="${color}" font-family="${esc(pal.fontFamily)}" font-size="10" font-weight="600" letter-spacing="1.2" style="text-transform:uppercase">${esc(card.type)}</text>`,
    );
    if (card.pinned) {
      parts.push(
        `<text x="${x + n.w - CARD_PAD_X}" y="${cy}" text-anchor="end" fill="${pal.subtle}" font-family="${esc(pal.fontFamily)}" font-size="9" letter-spacing="0.8" style="text-transform:uppercase">pinned</text>`,
      );
    }
    cy += 18;

    // Title — measured and wrapped at 14px/600.
    meas.font = `600 14px ${pal.fontFamily}`;
    for (const line of wrap(meas, card.title, innerW)) {
      parts.push(
        `<text x="${x + CARD_PAD_X}" y="${cy}" fill="${pal.fg}" font-family="${esc(pal.fontFamily)}" font-size="14" font-weight="600">${esc(line)}</text>`,
      );
      cy += 19;
    }

    // Body — 12px/400, muted. Clip to the card's real height so an unusually
    // long body can't spill past the rounded rectangle.
    if (card.body) {
      cy += 3;
      meas.font = `400 12px ${pal.fontFamily}`;
      const maxY2 = y + n.h - CARD_PAD_Y;
      for (const line of wrap(meas, card.body, innerW)) {
        if (cy > maxY2) break;
        parts.push(
          `<text x="${x + CARD_PAD_X}" y="${cy}" fill="${pal.muted}" font-family="${esc(pal.fontFamily)}" font-size="12">${esc(line)}</text>`,
        );
        cy += 17;
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${pal.subtle}" opacity="0.7"/></marker></defs>
<rect x="0" y="0" width="${width}" height="${height}" fill="${pal.bg}"/>
${parts.join("\n")}
</svg>`;

  return { svg, width, height };
}

/** SVG string → a `data:` URL of the chosen kind. PNG rasterizes via canvas. */
export function svgToDataUrl(
  svg: string,
  width: number,
  height: number,
  kind: "png" | "svg",
): Promise<string> {
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (kind === "svg") return Promise.resolve(svgUrl);

  return new Promise((resolve, reject) => {
    const scale = 2; // retina-crisp PNG
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unavailable."));
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("Couldn't rasterize the board."));
    img.src = svgUrl;
  });
}
