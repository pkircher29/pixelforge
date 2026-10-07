/**
 * Gradient editor model (PS semantics): color stops with midpoints below the bar,
 * opacity stops with midpoints above it. Pure; converted to the engine `Gradient`
 * (flat RGBA stops) for rendering.
 */
import type { Gradient, RGBA } from "$lib/engine";

export interface ColorStop {
  /** 0..1 */
  pos: number;
  /** RGB; alpha ignored. `null` = foreground / "bg" = background (resolved at paint time). */
  color: RGBA | "fg" | "bg";
  /** Midpoint towards the NEXT stop, 0..1 (PS default 0.5). */
  mid: number;
}

export interface OpacityStop {
  pos: number;
  /** 0..1 */
  alpha: number;
  mid: number;
}

export interface GradientDef {
  id: string;
  name: string;
  colorStops: ColorStop[];
  opacityStops: OpacityStop[];
  /** 0..100 */
  smoothness: number;
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 255 };
const WHITE: RGBA = { r: 255, g: 255, b: 255, a: 255 };

export function gradientDef(id: string, name: string, colors: (RGBA | "fg" | "bg")[], opacities?: number[], positions?: number[]): GradientDef {
  const n = colors.length;
  const colorStops = colors.map((c, i) => ({ pos: positions ? positions[i]! : n === 1 ? 0 : i / (n - 1), color: c, mid: 0.5 }));
  const ops = opacities ?? [1, 1];
  const opacityStops = ops.map((a, i) => ({ pos: ops.length === 1 ? 0 : i / (ops.length - 1), alpha: a, mid: 0.5 }));
  return { id, name, colorStops, opacityStops, smoothness: 100 };
}

export function cloneGradientDef(g: GradientDef): GradientDef {
  return {
    ...g,
    colorStops: g.colorStops.map((s) => ({ ...s, color: typeof s.color === "string" ? s.color : { ...s.color } })),
    opacityStops: g.opacityStops.map((s) => ({ ...s })),
  };
}

function sortedColor(g: GradientDef): ColorStop[] {
  return g.colorStops.slice().sort((a, b) => a.pos - b.pos);
}
function sortedOpacity(g: GradientDef): OpacityStop[] {
  return g.opacityStops.slice().sort((a, b) => a.pos - b.pos);
}

/** PS midpoint remap: at `u` (0..1 within a segment) with midpoint `m`, the 50 % blend sits at `m`. */
export function midpointCurve(u: number, m: number): number {
  const mm = Math.max(0.01, Math.min(0.99, m));
  return u <= mm ? (0.5 * u) / mm : 0.5 + (0.5 * (u - mm)) / (1 - mm);
}

export function resolveColor(c: RGBA | "fg" | "bg", fg: RGBA, bg: RGBA): RGBA {
  return c === "fg" ? fg : c === "bg" ? bg : c;
}

/** Color at `t` (0..1), alpha not applied. */
export function evalColor(g: GradientDef, t: number, fg: RGBA = BLACK, bg: RGBA = WHITE): RGBA {
  const stops = sortedColor(g);
  if (stops.length === 0) return { r: 0, g: 0, b: 0, a: 255 };
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= stops[0]!.pos) return { ...resolveColor(stops[0]!.color, fg, bg), a: 255 };
  const last = stops[stops.length - 1]!;
  if (tt >= last.pos) return { ...resolveColor(last.color, fg, bg), a: 255 };
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (tt >= a.pos && tt <= b.pos) {
      const u = b.pos === a.pos ? 0 : (tt - a.pos) / (b.pos - a.pos);
      const k = midpointCurve(u, a.mid);
      const ca = resolveColor(a.color, fg, bg);
      const cb = resolveColor(b.color, fg, bg);
      return { r: ca.r + (cb.r - ca.r) * k, g: ca.g + (cb.g - ca.g) * k, b: ca.b + (cb.b - ca.b) * k, a: 255 };
    }
  }
  return { ...resolveColor(last.color, fg, bg), a: 255 };
}

/** Opacity at `t` (0..1). */
export function evalAlpha(g: GradientDef, t: number): number {
  const stops = sortedOpacity(g);
  if (stops.length === 0) return 1;
  const tt = Math.max(0, Math.min(1, t));
  if (tt <= stops[0]!.pos) return stops[0]!.alpha;
  const last = stops[stops.length - 1]!;
  if (tt >= last.pos) return last.alpha;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (tt >= a.pos && tt <= b.pos) {
      const u = b.pos === a.pos ? 0 : (tt - a.pos) / (b.pos - a.pos);
      return a.alpha + (b.alpha - a.alpha) * midpointCurve(u, a.mid);
    }
  }
  return last.alpha;
}

/** Full RGBA at `t`. */
export function evalGradient(g: GradientDef, t: number, fg?: RGBA, bg?: RGBA): RGBA {
  const c = evalColor(g, t, fg, bg);
  return { ...c, a: Math.round(evalAlpha(g, t) * 255) };
}

/**
 * Flatten to the engine's piecewise-linear `Gradient`: sample at every stop position,
 * every midpoint and `extra` evenly spaced points so midpoint curves survive.
 */
export function toEngineGradient(g: GradientDef, fg?: RGBA, bg?: RGBA, extra = 32): Gradient {
  const pos = new Set<number>([0, 1]);
  for (const s of g.colorStops) pos.add(s.pos);
  for (const s of g.opacityStops) pos.add(s.pos);
  const cs = sortedColor(g);
  for (let i = 0; i < cs.length - 1; i++) pos.add(cs[i]!.pos + (cs[i + 1]!.pos - cs[i]!.pos) * cs[i]!.mid);
  const os = sortedOpacity(g);
  for (let i = 0; i < os.length - 1; i++) pos.add(os[i]!.pos + (os[i + 1]!.pos - os[i]!.pos) * os[i]!.mid);
  for (let i = 1; i < extra; i++) pos.add(i / extra);
  const sorted = [...pos].map((p) => Math.max(0, Math.min(1, p))).sort((a, b) => a - b);
  return { stops: sorted.map((p) => ({ pos: p, color: evalGradient(g, p, fg, bg) })) };
}

// ---- editing ops (return new defs) -------------------------------------------------

export function addColorStop(g: GradientDef, pos: number, color?: RGBA | "fg" | "bg"): { def: GradientDef; index: number } {
  const def = cloneGradientDef(g);
  const c = color ?? evalColor(g, pos);
  def.colorStops.push({ pos: Math.max(0, Math.min(1, pos)), color: c, mid: 0.5 });
  def.colorStops.sort((a, b) => a.pos - b.pos);
  return { def, index: def.colorStops.findIndex((s) => s.pos === Math.max(0, Math.min(1, pos)) && s.color === c) };
}

export function removeColorStop(g: GradientDef, index: number): GradientDef {
  if (g.colorStops.length <= 2) return g;
  const def = cloneGradientDef(g);
  def.colorStops.splice(index, 1);
  return def;
}

export function moveColorStop(g: GradientDef, index: number, pos: number): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.colorStops[index];
  if (s) s.pos = Math.max(0, Math.min(1, pos));
  return def;
}

export function setColorStop(g: GradientDef, index: number, color: RGBA | "fg" | "bg"): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.colorStops[index];
  if (s) s.color = typeof color === "string" ? color : { ...color, a: 255 };
  return def;
}

export function setColorMidpoint(g: GradientDef, index: number, mid: number): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.colorStops[index];
  if (s) s.mid = Math.max(0.05, Math.min(0.95, mid));
  return def;
}

export function addOpacityStop(g: GradientDef, pos: number, alpha?: number): { def: GradientDef; index: number } {
  const def = cloneGradientDef(g);
  const p = Math.max(0, Math.min(1, pos));
  def.opacityStops.push({ pos: p, alpha: alpha ?? evalAlpha(g, pos), mid: 0.5 });
  def.opacityStops.sort((a, b) => a.pos - b.pos);
  return { def, index: def.opacityStops.findIndex((s) => s.pos === p) };
}

export function removeOpacityStop(g: GradientDef, index: number): GradientDef {
  if (g.opacityStops.length <= 2) return g;
  const def = cloneGradientDef(g);
  def.opacityStops.splice(index, 1);
  return def;
}

export function moveOpacityStop(g: GradientDef, index: number, pos: number): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.opacityStops[index];
  if (s) s.pos = Math.max(0, Math.min(1, pos));
  return def;
}

export function setOpacityStop(g: GradientDef, index: number, alpha: number): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.opacityStops[index];
  if (s) s.alpha = Math.max(0, Math.min(1, alpha));
  return def;
}

export function setOpacityMidpoint(g: GradientDef, index: number, mid: number): GradientDef {
  const def = cloneGradientDef(g);
  const s = def.opacityStops[index];
  if (s) s.mid = Math.max(0.05, Math.min(0.95, mid));
  return def;
}

/** Index order of color stops after sorting (stable ids for the editor UI). */
export function sortStops(g: GradientDef): GradientDef {
  const def = cloneGradientDef(g);
  def.colorStops.sort((a, b) => a.pos - b.pos);
  def.opacityStops.sort((a, b) => a.pos - b.pos);
  return def;
}

/** Serialize / parse for tool options and files. */
export function serializeGradient(g: GradientDef): string {
  return JSON.stringify(g);
}

export function parseGradient(s: string | null | undefined): GradientDef | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s) as GradientDef;
    if (!o || !Array.isArray(o.colorStops) || !Array.isArray(o.opacityStops)) return null;
    return { id: o.id ?? "custom", name: o.name ?? "Custom", colorStops: o.colorStops, opacityStops: o.opacityStops, smoothness: o.smoothness ?? 100 };
  } catch {
    return null;
  }
}
