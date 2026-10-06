/**
 * Scrubby-number math (Photoshop's drag-the-label fields): pure helpers so the widget
 * is testable without a DOM.
 */

export interface ScrubSpec {
  min: number;
  max: number;
  step?: number;
  /** Logarithmic feel (brush sizes): the same drag distance scales proportionally. */
  log?: boolean;
}

export interface ScrubMods {
  /** Shift ×10. */
  shift?: boolean;
  /** Alt ÷10 (fine). */
  alt?: boolean;
}

export function clampStep(v: number, spec: ScrubSpec): number {
  const step = spec.step ?? 1;
  const snapped = Math.round(v / step) * step;
  const c = Math.max(spec.min, Math.min(spec.max, snapped));
  // Avoid 0.30000000000000004 in the field.
  const decimals = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(c.toFixed(decimals));
}

/**
 * Value after dragging `dx` CSS px from `start`. Linear: 1 px = 1 step (Shift 10×, Alt
 * 0.1×). Log: 1 px = 1 % of the current value, compounding, so a 100 px drag doubles-ish.
 */
export function scrubValue(start: number, dx: number, spec: ScrubSpec, mods: ScrubMods = {}): number {
  const step = spec.step ?? 1;
  const gain = mods.shift ? 10 : mods.alt ? 0.1 : 1;
  if (spec.log) {
    const base = Math.max(start, spec.min, step);
    return clampStep(base * Math.exp(dx * 0.01 * gain), spec);
  }
  return clampStep(start + dx * step * gain, spec);
}

/** Parse what the user typed: "50", "50%", "12px", "+5", "-5", "1.5e1"; `rel` adds to `current`. */
export function parseTyped(text: string, current: number, spec: ScrubSpec): number | null {
  const t = text.trim().replace(/[%a-z]+$/i, "").trim();
  if (!t) return null;
  const rel = /^[+-]\s*\d/.test(t) && /^\+/.test(t);
  const n = Number(t.replace(/\s+/g, ""));
  if (!Number.isFinite(n)) return null;
  return clampStep(rel ? current + n : n, spec);
}

/** Slider position 0..1000 ↔ value, honouring `log`. */
export function toSlider(v: number, spec: ScrubSpec): number {
  if (!spec.log) return Math.round(((v - spec.min) / Math.max(1e-9, spec.max - spec.min)) * 1000);
  const lo = Math.log(Math.max(1e-6, spec.min));
  const hi = Math.log(Math.max(spec.max, spec.min + 1e-6));
  return Math.round(((Math.log(Math.max(1e-6, v)) - lo) / (hi - lo)) * 1000);
}

export function fromSlider(s: number, spec: ScrubSpec): number {
  if (!spec.log) return clampStep(spec.min + (s / 1000) * (spec.max - spec.min), spec);
  const lo = Math.log(Math.max(1e-6, spec.min));
  const hi = Math.log(Math.max(spec.max, spec.min + 1e-6));
  return clampStep(Math.exp(lo + (s / 1000) * (hi - lo)), spec);
}

/** Arrow keys: ↑/↓ ±step, Shift ±10 steps. */
export function nudge(v: number, dir: 1 | -1, spec: ScrubSpec, shift = false): number {
  return clampStep(v + dir * (spec.step ?? 1) * (shift ? 10 : 1), spec);
}

/** "100" / "66.7" style display (strip trailing zeros, max 2 decimals). */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "";
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return v.toFixed(0);
  return v.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
