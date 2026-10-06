/**
 * Deterministic per-pixel noise shared by the CPU and GPU paths.
 *
 * Both implement the same 32-bit integer hash of `(x, y, seed, channel)` so a seeded
 * Add Noise produces identical pixels on either path (up to float rounding in Box-Muller).
 */

/** Integer hash -> uniform float in [0, 1). Mirrors `PF_HASH_GLSL`. */
export function hash01(x: number, y: number, seed: number, channel: number): number {
  let h = (Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(seed, 0xc2b2ae3d) ^ Math.imul(channel + 1, 0x27d4eb2f)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39) >>> 0;
  h ^= h >>> 15;
  // 24-bit mantissa worth of bits, same as the GLSL version.
  return (h >>> 8) / 16777216;
}

/** Standard normal sample from two uniforms (Box-Muller, cosine branch). */
export function gaussianFromUniforms(u1: number, u2: number): number {
  const r = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-7)));
  return r * Math.cos(2 * Math.PI * u2);
}

/** GLSL twins of the functions above. */
export const PF_HASH_GLSL = `
float pf_hash01(ivec2 p, int seed, int channel) {
  uint h = uint(p.x) * 0x9E3779B1u ^ uint(p.y) * 0x85EBCA77u ^ uint(seed) * 0xC2B2AE3Du ^ uint(channel + 1) * 0x27D4EB2Fu;
  h ^= h >> 15u;
  h *= 0x2C1B3C6Du;
  h ^= h >> 12u;
  h *= 0x297A2D39u;
  h ^= h >> 15u;
  return float(h >> 8u) / 16777216.0;
}
float pf_gauss(float u1, float u2) {
  float r = sqrt(-2.0 * log(max(u1, 1e-7)));
  return r * cos(6.283185307179586 * u2);
}
`;

/** Small seeded PRNG for tests and defaults (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
