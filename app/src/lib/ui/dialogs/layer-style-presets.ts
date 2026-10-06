/**
 * Styles tab presets — a dozen PS-flavoured defaults ("Basic Drop Shadow", "Chiseled
 * Sky", ...). Each is a full `LayerEffects`; `applyPreset` installs it.
 */
import { BlendMode, defaultBevelEmboss, defaultColorOverlay, defaultDropShadow, defaultGradientOverlay, defaultInnerGlow, defaultInnerShadow, defaultOuterGlow, defaultStroke, type LayerEffects, type RGBA } from "$lib/engine";
import type { StylePreset } from "./layer-style-model";

const c = (r: number, g: number, b: number, a = 255): RGBA => ({ r, g, b, a });

const grad = (stops: [number, RGBA][]) => ({ stops: stops.map(([pos, color]) => ({ pos, color })) });

export const STYLE_PRESETS: readonly StylePreset[] = [
  { id: "none", name: "Default Style (None)", effects: {} },
  { id: "drop-shadow", name: "Basic Drop Shadow", effects: { dropShadow: defaultDropShadow() } },
  { id: "soft-shadow", name: "Soft Shadow", effects: { dropShadow: defaultDropShadow({ distance: 8, size: 14, opacity: 0.55 }) } },
  { id: "white-stroke", name: "White Stroke", effects: { stroke: defaultStroke({ color: c(255, 255, 255), size: 4 }) } },
  { id: "sunspots", name: "Sun Faded Photo", effects: { stroke: defaultStroke({ color: c(255, 255, 255), size: 6, position: "inside" }), dropShadow: defaultDropShadow({ distance: 4, size: 8, opacity: 0.6 }), innerGlow: defaultInnerGlow({ color: c(255, 240, 200), size: 18, opacity: 0.5 }) } },
  { id: "chrome", name: "Chrome", effects: { bevelEmboss: defaultBevelEmboss({ size: 8, depth: 250, technique: "chiselHard", highlightOpacity: 0.95, shadowOpacity: 0.6 }), gradientOverlay: defaultGradientOverlay({ gradient: grad([[0, c(60, 60, 70)], [0.45, c(230, 230, 240)], [0.5, c(120, 120, 130)], [1, c(240, 240, 250)]]) }), dropShadow: defaultDropShadow({ distance: 3, size: 4 }) } },
  { id: "chiseled-sky", name: "Chiseled Sky", effects: { bevelEmboss: defaultBevelEmboss({ style: "innerBevel", technique: "chiselHard", size: 10, depth: 300 }), gradientOverlay: defaultGradientOverlay({ gradient: grad([[0, c(18, 60, 140)], [1, c(140, 200, 255)]]) }), stroke: defaultStroke({ color: c(20, 40, 90), size: 2, position: "inside" }) } },
  { id: "puffy", name: "Puffy", effects: { bevelEmboss: defaultBevelEmboss({ style: "innerBevel", technique: "smooth", size: 18, soften: 6, depth: 150 }), innerShadow: defaultInnerShadow({ distance: 2, size: 6, opacity: 0.4 }), dropShadow: defaultDropShadow({ distance: 6, size: 10 }) } },
  { id: "neon", name: "Neon Glow", effects: { colorOverlay: defaultColorOverlay({ color: c(255, 255, 255) }), outerGlow: defaultOuterGlow({ color: c(0, 220, 255), size: 18, spread: 10, opacity: 0.9 }), innerGlow: defaultInnerGlow({ color: c(0, 180, 255), size: 8, opacity: 0.8 }) } },
  { id: "fire", name: "Fire Glow", effects: { gradientOverlay: defaultGradientOverlay({ gradient: grad([[0, c(255, 30, 0)], [0.6, c(255, 180, 0)], [1, c(255, 255, 160)]]) }), outerGlow: defaultOuterGlow({ color: c(255, 90, 0), size: 20, spread: 15, opacity: 0.85 }), innerShadow: defaultInnerShadow({ color: c(120, 0, 0), distance: 3, size: 6 }) } },
  { id: "gold", name: "Gold Bevel", effects: { bevelEmboss: defaultBevelEmboss({ size: 7, depth: 200, highlightColor: c(255, 250, 200), shadowColor: c(90, 60, 0) }), gradientOverlay: defaultGradientOverlay({ gradient: grad([[0, c(150, 100, 10)], [0.5, c(255, 220, 90)], [1, c(170, 120, 20)]]) }), dropShadow: defaultDropShadow({ distance: 4, size: 5 }) } },
  { id: "emboss", name: "Embossed", effects: { bevelEmboss: defaultBevelEmboss({ style: "emboss", size: 5, depth: 120 }) } },
  { id: "outline", name: "Red Outline", effects: { stroke: defaultStroke({ color: c(220, 30, 30), size: 3, position: "center" }), colorOverlay: defaultColorOverlay({ color: c(255, 255, 255), blendMode: BlendMode.Normal }) } },
  { id: "sticker", name: "Sticker", effects: { stroke: defaultStroke({ color: c(255, 255, 255), size: 8, position: "outside" }), dropShadow: defaultDropShadow({ distance: 5, size: 6, opacity: 0.5 }) } },
];

export function presetById(id: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.id === id);
}

export type { LayerEffects };
