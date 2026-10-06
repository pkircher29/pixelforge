/**
 * Rasterise a single line of text through a 2D canvas. Returns a raster plus the
 * offset so that `(x, y)` is the text's left baseline.
 */
import { Raster, type RGBA } from "$lib/engine";

export interface TextStyle {
  family: string;
  size: number;
  bold: boolean;
  italic: boolean;
  color: RGBA;
}

export function cssFont(s: TextStyle): string {
  return `${s.italic ? "italic " : ""}${s.bold ? "700 " : "400 "}${Math.max(1, Math.round(s.size))}px ${quoteFamily(s.family)}`;
}

function quoteFamily(f: string): string {
  return f
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/\s/.test(p) && !/^["']/.test(p) ? `"${p}"` : p))
    .join(", ");
}

/** Render; `null` when the environment has no 2D canvas (tests) or the text is empty. */
export function rasterizeText(text: string, style: TextStyle): { raster: Raster; dx: number; dy: number } | null {
  if (!text.trim() || typeof document === "undefined") return null;
  const probe = document.createElement("canvas");
  const pg = probe.getContext("2d");
  if (!pg) return null;
  pg.font = cssFont(style);
  const m = pg.measureText(text);
  const ascent = Math.ceil(m.actualBoundingBoxAscent || style.size * 0.8);
  const descent = Math.ceil(m.actualBoundingBoxDescent || style.size * 0.25);
  const left = Math.ceil(m.actualBoundingBoxLeft || 0);
  const right = Math.ceil(m.actualBoundingBoxRight || m.width);
  const pad = 2;
  const w = Math.max(1, left + right + pad * 2);
  const h = Math.max(1, ascent + descent + pad * 2);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  g.font = cssFont(style);
  g.textBaseline = "alphabetic";
  g.fillStyle = `rgba(${style.color.r}, ${style.color.g}, ${style.color.b}, ${style.color.a / 255})`;
  g.fillText(text, left + pad, ascent + pad);
  const img = g.getImageData(0, 0, w, h);
  return { raster: Raster.fromImageData(img), dx: -(left + pad), dy: -(ascent + pad) };
}

export const TEXT_FAMILIES = [
  "Segoe UI",
  "Arial",
  "Helvetica",
  "Georgia",
  "Times New Roman",
  "Impact",
  "Cascadia Code",
  "Consolas",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Comic Sans MS",
];
