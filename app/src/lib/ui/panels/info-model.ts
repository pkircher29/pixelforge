/**
 * Info panel readouts (pure): colour modes for the two eyedropper readouts, cursor
 * coordinates in the ruler unit, selection / transform sizes, document size line.
 * Tested in `tests/panels/info.test.ts`.
 */
import type { RGBA } from "$lib/engine";
import type { RulerUnit } from "$lib/stores/settings.svelte";
import { pxPerUnit } from "../rulers";
import { rgbToCmyk, rgbToGrayK, rgbToHex, rgbToHsb } from "./color-model";

export type InfoColorMode = "rgb" | "cmyk" | "hsb" | "gray" | "web";

export const INFO_COLOR_MODES: readonly { id: InfoColorMode; label: string }[] = [
  { id: "rgb", label: "RGB Color" },
  { id: "cmyk", label: "CMYK Color" },
  { id: "hsb", label: "HSB Color" },
  { id: "gray", label: "Grayscale" },
  { id: "web", label: "Web Color" },
];

export interface ReadoutLine {
  k: string;
  v: string;
}

/** The lines of one colour readout; `null` colour → blank values (cursor off-canvas). */
export function colorReadout(mode: InfoColorMode, c: RGBA | null): ReadoutLine[] {
  const blank = (keys: string[]): ReadoutLine[] => keys.map((k) => ({ k, v: "" }));
  switch (mode) {
    case "rgb":
      return c ? [{ k: "R", v: String(c.r) }, { k: "G", v: String(c.g) }, { k: "B", v: String(c.b) }] : blank(["R", "G", "B"]);
    case "cmyk": {
      if (!c) return blank(["C", "M", "Y", "K"]);
      const k = rgbToCmyk(c);
      return [{ k: "C", v: `${k.c}%` }, { k: "M", v: `${k.m}%` }, { k: "Y", v: `${k.y}%` }, { k: "K", v: `${k.k}%` }];
    }
    case "hsb": {
      if (!c) return blank(["H", "S", "B"]);
      const h = rgbToHsb(c);
      return [{ k: "H", v: `${Math.round(h.h)}°` }, { k: "S", v: `${Math.round(h.s)}%` }, { k: "B", v: `${Math.round(h.b)}%` }];
    }
    case "gray":
      return c ? [{ k: "K", v: `${rgbToGrayK(c)}%` }] : blank(["K"]);
    case "web":
      return c ? [{ k: "#", v: rgbToHex(c).slice(1).toUpperCase() }] : blank(["#"]);
  }
}

/** Document px → ruler unit value. */
export function pxToUnit(px: number, unit: RulerUnit, dpi: number, axisPx: number): number {
  return px / pxPerUnit(unit, dpi || 72, axisPx);
}

/** Format a unit value the way PS does (px integer, in/cm 2 dp, mm 1 dp, % 1 dp). */
export function formatUnitValue(v: number, unit: RulerUnit): string {
  switch (unit) {
    case "px":
      return String(Math.round(v));
    case "in":
    case "cm":
      return v.toFixed(2);
    case "mm":
      return v.toFixed(1);
    case "%":
      return v.toFixed(1);
  }
}

export function unitSuffix(unit: RulerUnit): string {
  return unit === "%" ? "%" : ` ${unit}`;
}

/** Cursor X/Y readout in the current unit. */
export function cursorReadout(cur: { x: number; y: number } | null, unit: RulerUnit, dpi: number, docW: number, docH: number): ReadoutLine[] {
  if (!cur) return [{ k: "X", v: "" }, { k: "Y", v: "" }];
  return [
    { k: "X", v: formatUnitValue(pxToUnit(cur.x, unit, dpi, docW), unit) },
    { k: "Y", v: formatUnitValue(pxToUnit(cur.y, unit, dpi, docH), unit) },
  ];
}

/** Selection W/H (or transform W/H/angle while transforming). */
export function sizeReadout(
  src: { kind: "selection"; w: number; h: number } | { kind: "transform"; w: number; h: number; angle: number } | null,
  unit: RulerUnit,
  dpi: number,
  docW: number,
  docH: number,
): ReadoutLine[] {
  if (!src) return [{ k: "W", v: "" }, { k: "H", v: "" }];
  const lines: ReadoutLine[] = [
    { k: "W", v: formatUnitValue(pxToUnit(src.w, unit, dpi, docW), unit) },
    { k: "H", v: formatUnitValue(pxToUnit(src.h, unit, dpi, docH), unit) },
  ];
  if (src.kind === "transform") lines.push({ k: "A", v: `${(Math.round(src.angle * 10) / 10).toFixed(1)}°` });
  return lines;
}

/** Ruler tool readout lines (PS: A angle, L1 length, ΔX ΔY). */
export function measureReadout(m: { length: number; angle: number; dx: number; dy: number } | null, unit: RulerUnit, dpi: number, docW: number, docH: number): ReadoutLine[] {
  if (!m) return [];
  return [
    { k: "A", v: `${(Math.round(m.angle * 10) / 10).toFixed(1)}°` },
    { k: "L", v: formatUnitValue(pxToUnit(m.length, unit, dpi, Math.max(docW, docH)), unit) },
    { k: "ΔX", v: formatUnitValue(pxToUnit(m.dx, unit, dpi, docW), unit) },
    { k: "ΔY", v: formatUnitValue(pxToUnit(m.dy, unit, dpi, docH), unit) },
  ];
}

/** PS "Doc: 5.93M/5.93M" (flat size / size with layers). */
export function docSizeLine(flatBytes: number, layerBytes: number): string {
  return `Doc: ${formatSize(flatBytes)}/${formatSize(layerBytes)}`;
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)}M`;
  return `${Math.max(1, Math.round(bytes / 1024))}K`;
}
