/** PS default gradient presets (~16) + the user library (persisted). */
import type { RGBA } from "$lib/engine";
import { gradientDef, type GradientDef } from "./gradient-model";

const c = (r: number, g: number, b: number): RGBA => ({ r, g, b, a: 255 });

export const DEFAULT_GRADIENTS: readonly GradientDef[] = [
  gradientDef("fg-bg", "Foreground to Background", ["fg", "bg"]),
  gradientDef("fg-transparent", "Foreground to Transparent", ["fg", "fg"], [1, 0]),
  gradientDef("black-white", "Black, White", [c(0, 0, 0), c(255, 255, 255)]),
  gradientDef("red-green", "Red, Green", [c(255, 0, 0), c(0, 255, 0)]),
  gradientDef("violet-orange", "Violet, Orange", [c(120, 0, 200), c(255, 140, 0)]),
  gradientDef("blue-red-yellow", "Blue, Red, Yellow", [c(0, 60, 255), c(255, 0, 0), c(255, 255, 0)]),
  gradientDef("blue-yellow-blue", "Blue, Yellow, Blue", [c(0, 100, 255), c(255, 240, 0), c(0, 100, 255)]),
  gradientDef("orange-yellow-orange", "Orange, Yellow, Orange", [c(255, 120, 0), c(255, 240, 0), c(255, 120, 0)]),
  gradientDef("violet-green-orange", "Violet, Green, Orange", [c(140, 0, 200), c(0, 200, 80), c(255, 140, 0)]),
  gradientDef("yellow-violet-orange-blue", "Yellow, Violet, Orange, Blue", [c(255, 240, 0), c(140, 0, 200), c(255, 140, 0), c(0, 80, 255)]),
  gradientDef("copper", "Copper", [c(150, 70, 30), c(250, 200, 150), c(100, 40, 20), c(240, 170, 120)], undefined, [0, 0.4, 0.7, 1]),
  gradientDef("chrome", "Chrome", [c(255, 255, 255), c(190, 200, 210), c(30, 40, 60), c(140, 170, 200), c(255, 255, 255)], undefined, [0, 0.45, 0.5, 0.75, 1]),
  gradientDef("spectrum", "Spectrum", [c(255, 0, 0), c(255, 255, 0), c(0, 255, 0), c(0, 255, 255), c(0, 0, 255), c(255, 0, 255), c(255, 0, 0)]),
  gradientDef("transparent-rainbow", "Transparent Rainbow", [c(255, 0, 0), c(255, 255, 0), c(0, 255, 0), c(0, 255, 255), c(0, 0, 255), c(255, 0, 255)], [0, 1, 1, 1, 1, 0]),
  gradientDef("transparent-stripes", "Transparent Stripes", [c(0, 0, 0), c(0, 0, 0)], [1, 0, 1, 0, 1, 0, 1, 0, 1]),
  gradientDef("neutral-density", "Neutral Density", [c(0, 0, 0), c(0, 0, 0)], [1, 0]),
];

const LS_KEY = "pixelforge.gradients.v1";

export function loadUserGradients(): GradientDef[] {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    const arr = raw ? (JSON.parse(raw) as GradientDef[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveUserGradients(list: GradientDef[]): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function gradientById(id: string, user: readonly GradientDef[] = []): GradientDef | null {
  return DEFAULT_GRADIENTS.find((g) => g.id === id) ?? user.find((g) => g.id === id) ?? null;
}
