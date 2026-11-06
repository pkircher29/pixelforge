import type { Raster } from "./raster";
import { blurRaster } from "./ops/blur";

/** Render-only mask parameters. The painted red channel remains the source of truth. */
export function renderMask(mask: Raster, density = 1, feather = 0): Raster {
  const d = Number.isFinite(density) ? Math.max(0, Math.min(1, density)) : 1;
  const f = Number.isFinite(feather) ? Math.max(0, Math.min(250, feather)) : 0;
  if (d === 1 && f === 0) return mask;
  const out = mask.clone();
  for (let i = 0; i < out.data.length; i += 4) {
    const v = 255 - (255 - mask.data[i]!) * d;
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  return f > 0 ? blurRaster(out, f) : out;
}
