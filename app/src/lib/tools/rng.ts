/** Small seeded PRNG (mulberry32) so brush jitter / scatter / tips are deterministic in tests. */
export class Rng {
  private s: number;

  constructor(seed = 1) {
    this.s = seed >>> 0 || 1;
  }

  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [a, b). */
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** Uniform in [-1, 1). */
  signed(): number {
    return this.next() * 2 - 1;
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }
}

/** Non-deterministic seed for interactive strokes. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
