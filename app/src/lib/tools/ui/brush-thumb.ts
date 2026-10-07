/**
 * Canvas helpers for brush previews: a stroke thumbnail (Brushes panel / picker), the
 * live stroke strip (Brush Settings panel) and a tip-shape thumbnail. Rendering goes
 * through the real engine so previews match what the tool paints.
 */
import { Raster } from "$lib/engine";
import { BrushStroke, normalizeBrushSettings, type BrushSettings } from "../brush-engine";
import { tipById } from "../brush-tips";
import { renderDabMask } from "../brush-engine";

/** Paint an S-curve stroke with `settings` into a `w × h` raster (black on transparent). */
export function strokePreviewRaster(settings: BrushSettings, w: number, h: number, seed = 7): Raster {
  const r = new Raster(w, h);
  const s = normalizeBrushSettings(settings);
  // Scale the brush so the stroke fits the thumbnail; keep the character (spacing %, jitter).
  const maxSize = Math.max(4, h * 0.45);
  // Clamp scatter so previews stay inside the strip (the real stroke is unaffected).
  const scaled: BrushSettings = { ...s, size: Math.min(s.size, maxSize), smoothing: 0, scatter: Math.min(s.scatter, 80) };
  const stroke = new BrushStroke(r, {
    settings: scaled,
    blend: { mode: "color", color: { r: 0, g: 0, b: 0, a: 255 } },
    opacity: 1,
    flow: 1,
    selection: null,
    offset: { x: 0, y: 0 },
    seed,
  });
  const steps = Math.max(24, Math.round(w / 2));
  const amp = h * 0.22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 6 + (w - 12) * t;
    const y = h / 2 + Math.sin(t * Math.PI * 2) * amp;
    // Pressure ramps up then down so pressure-driven presets show their taper.
    const pressure = Math.sin(t * Math.PI);
    stroke.moveTo({ x, y }, { pressure: Math.max(0.05, pressure), pointerType: "pen" });
  }
  return r;
}

/** Draw a stroke preview into a canvas element (sized to its CSS box × dpr). */
export function drawStrokePreview(canvas: HTMLCanvasElement, settings: BrushSettings, opts: { color?: string; seed?: number } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const r = strokePreviewRaster({ ...settings, size: settings.size * dpr }, w, h, opts.seed);
  const img = r.toImageData();
  // Tint: the raster is black; recolour with the requested CSS color.
  const c = parseCss(opts.color ?? "#e6e6e6");
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
  g.clearRect(0, 0, w, h);
  g.putImageData(img, 0, 0);
}

/** Draw a tip's shape (angle / roundness / hardness applied) into a canvas. */
export function drawTipPreview(canvas: HTMLCanvasElement, settings: BrushSettings, opts: { color?: string } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const size = Math.min(w, h) * 0.8;
  const m = renderDabMask(tipById(settings.tip), size, settings.angle, settings.roundness / 100, settings.hardness / 100, { flipX: settings.flipX, flipY: settings.flipY });
  const img = g.createImageData(w, h);
  const c = parseCss(opts.color ?? "#e6e6e6");
  const ox = Math.round(w / 2 - m.half);
  const oy = Math.round(h / 2 - m.half);
  for (let y = 0; y < m.n; y++) {
    for (let x = 0; x < m.n; x++) {
      const px = ox + x;
      const py = oy + y;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const a = m.cov[y * m.n + x]!;
      const i = (py * w + px) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.clearRect(0, 0, w, h);
  g.putImageData(img, 0, 0);
}

function parseCss(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [230, 230, 230];
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
