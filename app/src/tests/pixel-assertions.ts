import { expect } from "vitest";

/** Compare every byte without deep-matcher bookkeeping for large image buffers. */
export function expectPixelBytes(actual: Uint8ClampedArray, expected: Uint8ClampedArray): void {
  expect(actual.length).toBe(expected.length);
  const mismatch = actual.findIndex((value, index) => value !== expected[index]);
  expect(mismatch, `First differing pixel byte: ${mismatch}`).toBe(-1);
}
