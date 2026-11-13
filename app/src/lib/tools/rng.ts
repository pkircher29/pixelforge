import { mulberry32 } from "$lib/engine";

/** Small seeded PRNG (mulberry32) so brush jitter / scatter / tips are deterministic in tests. */
export class Rng {
  readonly next: () => number;

  constructor(seed = 1) {
    this.next = mulberry32(seed >>> 0 || 1);
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
