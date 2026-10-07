/** Ruler tool math (pure). */
import type { Measure } from "$lib/stores/tool.svelte";

/** Measurement between two document points; angle in degrees, 0 = →, counter-clockwise positive (PS). */
export function measureLine(x0: number, y0: number, x1: number, y1: number): Measure {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  let angle = (-Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 180) angle -= 360;
  if (angle <= -180) angle += 360;
  return { x0, y0, x1, y1, length, angle, dx, dy };
}

/**
 * Rotation (degrees, clockwise) that makes the measured line horizontal — PS "Straighten".
 * Lines closer to vertical are straightened to vertical.
 */
export function straightenAngle(m: Measure): number {
  const a = ((m.angle % 180) + 180) % 180; // 0..180 CCW from →
  // Nearest axis: horizontal (0/180) or vertical (90).
  const toH = a <= 90 ? a : a - 180; // signed CCW amount to reach horizontal
  const toV = a - 90;
  const chosen = Math.abs(toH) <= Math.abs(toV) ? toH : toV;
  // Our canvas rotation is clockwise-positive; a CCW line angle needs a CW rotation of the same size.
  return Math.round(chosen * 100) / 100;
}

export function formatMeasure(m: Measure | null): string {
  if (!m) return "";
  return `L: ${m.length.toFixed(1)}  A: ${m.angle.toFixed(1)}°  ΔX: ${Math.round(m.dx)}  ΔY: ${Math.round(m.dy)}`;
}
