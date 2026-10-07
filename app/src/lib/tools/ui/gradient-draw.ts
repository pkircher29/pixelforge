/** Draw a gradient definition as a horizontal bar on a canvas (checkerboard behind transparency). */
import type { RGBA } from "$lib/engine";
import { evalGradient, type GradientDef } from "../gradient-model";

export function drawGradientBar(canvas: HTMLCanvasElement, def: GradientDef, fg: RGBA, bg: RGBA, opts: { checker?: boolean; reverse?: boolean } = {}): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const g = canvas.getContext("2d");
  if (!g) return;
  const img = g.createImageData(w, h);
  const d = img.data;
  const cell = Math.max(4, Math.round(6 * dpr));
  const row: RGBA[] = [];
  for (let x = 0; x < w; x++) {
    let t = x / Math.max(1, w - 1);
    if (opts.reverse) t = 1 - t;
    row.push(evalGradient(def, t, fg, bg));
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = row[x]!;
      const a = c.a / 255;
      const check = opts.checker === false ? 255 : ((x / cell) | 0) + ((y / cell) | 0) ? (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0 ? 255 : 204 : 255;
      const i = (y * w + x) * 4;
      d[i] = c.r * a + check * (1 - a);
      d[i + 1] = c.g * a + check * (1 - a);
      d[i + 2] = c.b * a + check * (1 - a);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}
