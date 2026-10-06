/**
 * Pixelate (Mosaic): every `cell x cell` block becomes its average colour. Cells are
 * anchored at the raster origin. GPU: two separable averaging passes.
 */

import { Raster } from "../raster";
import { fromPremul, toPremul } from "./cpu";
import { num, type OpDef } from "./types";

const PASS = (axis: "x" | "y", first: boolean): string => `
uniform int u_cell;
vec4 pf_op(ivec2 p) {
  int start = (p.${axis} / u_cell) * u_cell;
  int lim = u_size.${axis};
  vec4 acc = vec4(0.0);
  int n = 0;
  for (int i = 0; i < u_cell; i++) {
    int q = start + i;
    if (q >= lim) break;
    ivec2 s = ${axis === "x" ? "ivec2(q, p.y)" : "ivec2(p.x, q)"};
    acc += ${first ? "pf_premul(pf_fetch(s))" : "pf_fetch(s)"};
    n++;
  }
  acc /= float(max(n, 1));
  return ${first ? "acc" : "pf_unpremul(acc)"};
}`;

export const pixelate: OpDef = {
  id: "pixelate",
  label: "Mosaic",
  menu: "Filter/Pixelate",
  keywords: ["pixelate", "mosaic", "blocks", "censor"],
  params: [{ kind: "number", id: "cell", label: "Cell size", min: 2, max: 200, step: 1, default: 8, unit: "px" }],
  margin: (p) => Math.round(num(p, "cell", 8)),
  glsl: (p) => {
    const cell = Int32Array.of(Math.max(1, Math.round(num(p, "cell", 8))));
    return [
      { source: PASS("x", true), uniforms: { u_cell: cell } },
      { source: PASS("y", false), uniforms: { u_cell: cell } },
    ];
  },
  cpu: (src, p) => {
    const cell = Math.max(1, Math.round(num(p, "cell", 8)));
    const w = src.width;
    const h = src.height;
    const f = toPremul(src);
    const out = new Float32Array(f.length);
    for (let cy = 0; cy < h; cy += cell) {
      const y1 = Math.min(h, cy + cell);
      for (let cx = 0; cx < w; cx += cell) {
        const x1 = Math.min(w, cx + cell);
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let y = cy; y < y1; y++) {
          for (let x = cx; x < x1; x++) {
            const i = (y * w + x) * 4;
            r += f[i]!;
            g += f[i + 1]!;
            b += f[i + 2]!;
            a += f[i + 3]!;
          }
        }
        const inv = 1 / ((y1 - cy) * (x1 - cx));
        r *= inv;
        g *= inv;
        b *= inv;
        a *= inv;
        for (let y = cy; y < y1; y++) {
          for (let x = cx; x < x1; x++) {
            const i = (y * w + x) * 4;
            out[i] = r;
            out[i + 1] = g;
            out[i + 2] = b;
            out[i + 3] = a;
          }
        }
      }
    }
    return fromPremul(out, w, h);
  },
};

/** Convenience for tests: average colour of a block of a raster (straight alpha, rounded). */
export function blockAverage(src: Raster, x0: number, y0: number, size: number): [number, number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  let n = 0;
  for (let y = y0; y < Math.min(src.height, y0 + size); y++) {
    for (let x = x0; x < Math.min(src.width, x0 + size); x++) {
      const px = src.getPixel(x, y);
      r += px.r;
      g += px.g;
      b += px.b;
      a += px.a;
      n++;
    }
  }
  return [r / n, g / n, b / n, a / n];
}
