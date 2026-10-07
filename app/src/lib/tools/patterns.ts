/** Pattern library (Pattern Stamp): 6 procedural 64×64 tiles, generated once. */
import { Raster } from "$lib/engine";
import { Rng } from "./rng";

export interface PatternDef {
  id: string;
  name: string;
  raster: Raster;
}

const N = 64;

function tile(id: string, name: string, fn: (x: number, y: number, rng: Rng) => [number, number, number] | number): PatternDef {
  const r = new Raster(N, N);
  const rng = new Rng(id.length * 977 + 13);
  const d = r.data;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v = fn(x, y, rng);
      const [cr, cg, cb] = typeof v === "number" ? [v, v, v] : v;
      const i = (y * N + x) * 4;
      d[i] = cr;
      d[i + 1] = cg;
      d[i + 2] = cb;
      d[i + 3] = 255;
    }
  }
  return { id, name, raster: r };
}

let cache: PatternDef[] | null = null;

export function builtinPatterns(): PatternDef[] {
  if (cache) return cache;
  cache = [
    tile("checker", "Checkerboard", (x, y) => (((x >> 3) + (y >> 3)) & 1 ? 230 : 120)),
    tile("diagonal", "Diagonal Lines", (x, y) => ((x + y) % 8 < 2 ? 70 : 220)),
    tile("dots", "Polka Dots", (x, y) => {
      const cx = (x % 16) - 8;
      const cy = (y % 16) - 8;
      return cx * cx + cy * cy < 16 ? [40, 90, 200] : [235, 235, 245];
    }),
    tile("bricks", "Bricks", (x, y) => {
      const row = Math.floor(y / 16);
      const xx = (x + (row & 1 ? 16 : 0)) % 32;
      const mortar = y % 16 < 2 || xx < 2;
      return mortar ? [200, 190, 180] : [160, 70, 55];
    }),
    tile("grain", "Grain", (_x, _y, rng) => 110 + rng.int(90)),
    tile("wood", "Wood", (x, y, rng) => {
      const v = 0.5 + 0.5 * Math.sin(x * 0.35 + Math.sin(y * 0.08) * 3 + rng.next() * 0.3);
      return [150 + v * 60, 95 + v * 45, 45 + v * 25];
    }),
  ];
  return cache;
}

export function patternById(id: string): PatternDef {
  return builtinPatterns().find((p) => p.id === id) ?? builtinPatterns()[0]!;
}
