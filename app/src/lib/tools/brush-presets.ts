/**
 * Brush presets (Brushes panel). ~30 PS-like defaults in groups; user presets are
 * appended and persisted by `brush-store`.
 */
import { DEFAULT_BRUSH_SETTINGS, type BrushSettings } from "./brush-engine";

export interface BrushPreset {
  id: string;
  name: string;
  group: string;
  settings: BrushSettings;
  /** True for shipped presets (cannot be deleted). */
  builtin?: boolean;
}

function preset(id: string, name: string, group: string, over: Partial<BrushSettings>): BrushPreset {
  return { id, name, group, builtin: true, settings: { ...DEFAULT_BRUSH_SETTINGS, ...over } };
}

export const BUILTIN_PRESETS: readonly BrushPreset[] = [
  // General
  preset("soft-round-30", "Soft Round 30", "General Brushes", { tip: "round", size: 30, hardness: 0 }),
  preset("hard-round-20", "Hard Round 20", "General Brushes", { tip: "round", size: 20, hardness: 100 }),
  preset("soft-round-pressure", "Soft Round Pressure Size", "General Brushes", { tip: "round", size: 50, hardness: 0, pressureSize: true }),
  preset("hard-round-pressure-opacity", "Hard Round Pressure Opacity", "General Brushes", { tip: "round", size: 25, hardness: 100, transfer: true, pressureOpacity: true }),
  preset("soft-round-pressure-opacity", "Soft Round Pressure Opacity and Flow", "General Brushes", { tip: "round", size: 35, hardness: 0, transfer: true, pressureOpacity: true, flowJitter: 20 }),
  preset("hard-round-smooth", "Hard Round Smoothed", "General Brushes", { tip: "round", size: 12, hardness: 100, smoothing: 50 }),
  preset("airbrush-soft", "Airbrush Soft Low Flow", "General Brushes", { tip: "round", size: 80, hardness: 0, spacing: 10, buildUp: true }),
  preset("pencil-1", "Pencil 1 px", "General Brushes", { tip: "round", size: 1, hardness: 100, spacing: 1 }),
  // Dry media
  preset("chalk-36", "Chalk 36", "Dry Media Brushes", { tip: "chalk", size: 36, spacing: 10, shapeDynamics: true, angleJitter: 15 }),
  preset("charcoal-flat", "Charcoal Flat", "Dry Media Brushes", { tip: "charcoal", size: 40, spacing: 8, angle: 25 }),
  preset("charcoal-pencil", "Charcoal Pencil", "Dry Media Brushes", { tip: "charcoal", size: 14, spacing: 6, roundness: 60, transfer: true, pressureOpacity: true }),
  preset("pastel-rough", "Pastel Rough", "Dry Media Brushes", { tip: "texture", size: 45, spacing: 12, shapeDynamics: true, angleJitter: 100, sizeJitter: 10 }),
  preset("dry-brush-tip", "Dry Brush Tip Light Flow", "Dry Media Brushes", { tip: "dry-brush", size: 60, spacing: 5, angle: 0, transfer: true, flowJitter: 30 }),
  preset("crayon", "Crayon", "Dry Media Brushes", { tip: "texture", size: 20, spacing: 8, roundness: 70, shapeDynamics: true, roundnessJitter: 20 }),
  // Wet media
  preset("wet-sponge", "Wet Sponge", "Wet Media Brushes", { tip: "texture", size: 70, spacing: 25, scattering: true, scatter: 40, count: 2 }),
  preset("rough-ink", "Rough Ink", "Wet Media Brushes", { tip: "round", size: 18, hardness: 90, shapeDynamics: true, sizeJitter: 40, minDiameter: 50, transfer: true, pressureOpacity: true }),
  preset("watercolor-loaded", "Watercolor Loaded Wet Flat Tip", "Wet Media Brushes", { tip: "charcoal", size: 90, spacing: 4, roundness: 40, angle: 15, transfer: true, opacityJitter: 30, flowJitter: 50 }),
  preset("oil-medium", "Oil Medium Brush Wet Edges", "Wet Media Brushes", { tip: "dry-brush", size: 50, spacing: 4, roundness: 55, angle: -10, buildUp: true }),
  // Special effect
  preset("spatter-39", "Spatter 39", "Special Effect Brushes", { tip: "spatter", size: 39, spacing: 20, shapeDynamics: true, angleJitter: 100 }),
  preset("spatter-59", "Spatter 59", "Special Effect Brushes", { tip: "fine-spatter", size: 59, spacing: 15, scattering: true, scatter: 120, count: 3, countJitter: 50 }),
  preset("grass", "Grass", "Special Effect Brushes", { tip: "grass", size: 60, spacing: 30, shapeDynamics: true, sizeJitter: 50, angleJitter: 8, scattering: true, scatter: 60, count: 2 }),
  preset("star-confetti", "Star Confetti", "Special Effect Brushes", { tip: "star", size: 16, spacing: 120, scattering: true, scatter: 400, scatterBoth: true, count: 3, shapeDynamics: true, sizeJitter: 60, angleJitter: 100 }),
  preset("scattered-leaves", "Scattered Leaves", "Special Effect Brushes", { tip: "diamond", size: 22, spacing: 80, roundness: 50, scattering: true, scatter: 300, scatterBoth: true, count: 2, shapeDynamics: true, angleJitter: 100, sizeJitter: 40 }),
  preset("dune-grass", "Dune Grass", "Special Effect Brushes", { tip: "grass", size: 100, spacing: 25, shapeDynamics: true, angleJitter: 5, transfer: true, opacityJitter: 40 }),
  preset("stipple", "Stipple", "Special Effect Brushes", { tip: "round", size: 6, hardness: 100, spacing: 100, scattering: true, scatter: 500, scatterBoth: true, count: 6, countJitter: 50 }),
  // Legacy / calligraphy
  preset("flat-15", "Flat 15", "Legacy Brushes", { tip: "square", size: 15, roundness: 20, angle: 45, spacing: 5 }),
  preset("calligraphic-oval", "Calligraphic Oval", "Legacy Brushes", { tip: "round", size: 20, hardness: 100, roundness: 25, angle: 45, spacing: 3 }),
  preset("triangle-brush", "Triangle 30", "Legacy Brushes", { tip: "triangle", size: 30, spacing: 30, shapeDynamics: true, angleJitter: 20 }),
  preset("square-30", "Square 30", "Legacy Brushes", { tip: "square", size: 30, spacing: 60, shapeDynamics: true, angleJitter: 100 }),
  preset("soft-round-mask", "Soft Round Mask 100", "Legacy Brushes", { tip: "round", size: 100, hardness: 0, spacing: 15 }),
];

export const PRESET_GROUPS: readonly string[] = [...new Set(BUILTIN_PRESETS.map((p) => p.group))];
