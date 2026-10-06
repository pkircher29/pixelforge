/**
 * Worker twin of `affineResample` for large rasters. Message in:
 * `{ data, sw, sh, m, rect, method }`; message out: `{ data }` (transferred).
 */

import { Mat, resampleInto, type AffineMethod } from "./affine";

interface Req {
  data: Uint8ClampedArray<ArrayBuffer>;
  sw: number;
  sh: number;
  m: Mat;
  rect: { x: number; y: number; w: number; h: number };
  method: AffineMethod;
}

self.onmessage = (ev: MessageEvent<Req>): void => {
  const { data, sw, sh, m, rect, method } = ev.data;
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  resampleInto(data, sw, sh, out, rect.w, rect.h, Mat.invert(m), rect.x, rect.y, method);
  (self as unknown as Worker).postMessage({ data: out }, [out.buffer]);
};
