/** Ruler math (pure): unit scale, tick spacing that adapts to zoom, and the canvas painter. */
import type { RulerUnit } from "$lib/stores/settings.svelte";

/** Document pixels per ruler unit along one axis. `%` depends on the document size. */
export function pxPerUnit(unit: RulerUnit, dpi: number, axisPx: number): number {
  switch (unit) {
    case "in":
      return dpi;
    case "cm":
      return dpi / 2.54;
    case "mm":
      return dpi / 25.4;
    case "%":
      return axisPx / 100;
    default:
      return 1;
  }
}

const NICE = [1, 2, 5];

/**
 * Major tick spacing in *units* so that majors sit ≥ `minPx` screen px apart. Uses the
 * 1-2-5 series (PS labels 0 10 20… / 0 50 100… / 0 1 2 in…).
 */
export function majorStep(zoomPxPerUnit: number, minPx = 60): number {
  if (!(zoomPxPerUnit > 0)) return 1;
  let exp = Math.floor(Math.log10(minPx / zoomPxPerUnit));
  for (let i = 0; i < 40; i++) {
    for (const n of NICE) {
      const step = n * Math.pow(10, exp);
      if (step * zoomPxPerUnit >= minPx) return step;
    }
    exp++;
  }
  return 1;
}

/** Minor subdivisions per major (PS: halves and tenths when there's room). */
export function minorDivisions(majorPx: number): number {
  if (majorPx >= 120) return 10;
  if (majorPx >= 50) return 5;
  if (majorPx >= 24) return 2;
  return 1;
}

export function formatTick(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return String(r);
}

export interface RulerPaint {
  /** "h" (top) or "v" (left). */
  axis: "h" | "v";
  /** Ruler length in CSS px. */
  length: number;
  /** Screen position (CSS px, along the ruler) of document origin. */
  origin: number;
  /** Screen px per document px. */
  zoom: number;
  unit: RulerUnit;
  dpi: number;
  /** Document size along this axis (for %). */
  docAxisPx: number;
  /** Cursor position along the ruler (CSS px) or null. */
  cursor: number | null;
  dpr: number;
  colors: { bg: string; tick: string; text: string; border: string; cursor: string };
}

/** Paint one ruler into a 2D context sized `length × 16` CSS px (scaled by dpr). */
export function paintRuler(g: CanvasRenderingContext2D, p: RulerPaint, size = 16): void {
  const { axis, length, origin, zoom, dpr } = p;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = p.colors.bg;
  if (axis === "h") g.fillRect(0, 0, length, size);
  else g.fillRect(0, 0, size, length);
  // Inner edge line.
  g.fillStyle = p.colors.border;
  if (axis === "h") g.fillRect(0, size - 1, length, 1);
  else g.fillRect(size - 1, 0, 1, length);

  const ppu = pxPerUnit(p.unit, p.dpi, p.docAxisPx);
  const zpu = zoom * ppu;
  const step = majorStep(zpu);
  const majorPx = step * zpu;
  const divs = minorDivisions(majorPx);
  g.fillStyle = p.colors.tick;
  g.font = "9px 'Segoe UI', Arial, sans-serif";
  g.textBaseline = "top";

  const first = Math.floor((0 - origin) / majorPx) - 1;
  const last = Math.ceil((length - origin) / majorPx) + 1;
  for (let i = first; i <= last; i++) {
    const pos = origin + i * majorPx;
    const label = formatTick(i * step);
    if (axis === "h") {
      const x = Math.round(pos) + 0.5;
      g.fillRect(x - 0.5, 0, 1, size - 1);
      g.save();
      g.fillStyle = p.colors.text;
      g.fillText(label, x + 2, 1);
      g.restore();
      for (let m = 1; m < divs; m++) {
        const mx = Math.round(pos + (m * majorPx) / divs);
        const h = divs === 10 ? (m === 5 ? 6 : 3) : divs === 5 ? 4 : 6;
        g.fillRect(mx, size - 1 - h, 1, h);
      }
    } else {
      const y = Math.round(pos) + 0.5;
      g.fillRect(0, y - 0.5, size - 1, 1);
      g.save();
      g.fillStyle = p.colors.text;
      g.translate(1, y + 2);
      g.rotate(-Math.PI / 2);
      g.textAlign = "right";
      g.fillText(label, -1, 0);
      g.restore();
      for (let m = 1; m < divs; m++) {
        const my = Math.round(pos + (m * majorPx) / divs);
        const w = divs === 10 ? (m === 5 ? 6 : 3) : divs === 5 ? 4 : 6;
        g.fillRect(size - 1 - w, my, w, 1);
      }
    }
  }
  if (p.cursor !== null) {
    g.fillStyle = p.colors.cursor;
    if (axis === "h") g.fillRect(Math.round(p.cursor), 0, 1, size - 1);
    else g.fillRect(0, Math.round(p.cursor), size - 1, 1);
  }
}
