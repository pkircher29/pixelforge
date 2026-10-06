/**
 * Pure brush math: dab coverage with hardness falloff, spacing interpolation between
 * pointer samples, pressure scaling. No DOM, fully unit-testable.
 */
import type { Point } from "$lib/engine";

/**
 * Coverage (0..1) of a round dab at distance `dist` from its centre. `hardness` 0..1:
 * 1 = hard edge (anti-aliased over ~1px), 0 = linear fade from the centre.
 */
export function dabCoverage(dist: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  const h = Math.max(0, Math.min(1, hardness));
  // Inner fully-covered radius; always leave >= ~0.75px of edge for anti-aliasing.
  const inner = Math.max(0, Math.min(radius - 0.75, radius * h));
  if (dist <= inner) return 1;
  if (dist >= radius) return 0;
  const t = (dist - inner) / Math.max(1e-6, radius - inner);
  // Smooth (cosine) falloff reads closer to Photoshop than linear.
  return 0.5 + 0.5 * Math.cos(t * Math.PI);
}

/** Spacing in px from a percentage of the brush diameter (Photoshop default 25 %). */
export function spacingPx(diameter: number, spacingPct: number): number {
  return Math.max(0.5, (diameter * spacingPct) / 100);
}

/**
 * Positions to stamp when the pointer moves `from -> to` with `spacing` px between
 * dabs. `carry` is the distance already travelled since the last dab (returned so the
 * next segment continues the rhythm). `from` itself is never re-stamped.
 */
export function interpolateDabs(
  from: Point,
  to: Point,
  spacing: number,
  carry = 0,
): { points: Point[]; carry: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const points: Point[] = [];
  if (len === 0) return { points, carry };
  const step = Math.max(0.01, spacing);
  let d = step - carry;
  while (d <= len) {
    const t = d / len;
    points.push({ x: from.x + dx * t, y: from.y + dy * t });
    d += step;
  }
  // Distance travelled since the last dab (the loop exits with `d - step` at the last one).
  return { points, carry: points.length === 0 ? carry + len : len - (d - step) };
}

/** Effective diameter for a pointer sample. */
export function pressureSize(diameter: number, pressure: number, pointerType: string, enabled: boolean): number {
  if (!enabled || pointerType !== "pen") return diameter;
  const p = Math.max(0.05, Math.min(1, pressure));
  return Math.max(1, diameter * p);
}

/** Snap a point to the line from `anchor` constrained to 0/45/90 degree angles (Shift). */
export function constrainAngle(anchor: Point, p: Point): Point {
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  const ang = Math.atan2(dy, dx);
  const snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(dx, dy);
  return { x: anchor.x + Math.cos(snapped) * len, y: anchor.y + Math.sin(snapped) * len };
}
