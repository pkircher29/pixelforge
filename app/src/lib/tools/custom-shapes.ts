/**
 * Custom Shape library: ~30 PS-like shapes as unit-square path data (0..100 coords,
 * see `parseShapeData`). Arrows, hearts, stars, speech bubbles, checks, symbols…
 */
import type { Path } from "$lib/engine";
import { parseShapeData } from "./shape-geom";

export interface CustomShapeDef {
  id: string;
  name: string;
  group: string;
  data: string;
}

const K = 55.2; // cubic circle constant × 100

export const CUSTOM_SHAPES: readonly CustomShapeDef[] = [
  // Arrows
  { id: "arrow-right", name: "Arrow Right", group: "Arrows", data: "M 0 30 L 60 30 L 60 5 L 100 50 L 60 95 L 60 70 L 0 70 Z" },
  { id: "arrow-left", name: "Arrow Left", group: "Arrows", data: "M 100 30 L 40 30 L 40 5 L 0 50 L 40 95 L 40 70 L 100 70 Z" },
  { id: "arrow-up", name: "Arrow Up", group: "Arrows", data: "M 30 100 L 30 40 L 5 40 L 50 0 L 95 40 L 70 40 L 70 100 Z" },
  { id: "arrow-down", name: "Arrow Down", group: "Arrows", data: "M 30 0 L 30 60 L 5 60 L 50 100 L 95 60 L 70 60 L 70 0 Z" },
  { id: "arrow-double", name: "Double Arrow", group: "Arrows", data: "M 0 50 L 25 20 L 25 38 L 75 38 L 75 20 L 100 50 L 75 80 L 75 62 L 25 62 L 25 80 Z" },
  { id: "arrow-curved", name: "Curved Arrow", group: "Arrows", data: "M 10 100 C 10 40 40 15 80 15 L 80 0 L 100 25 L 80 50 L 80 35 C 50 35 30 55 30 100 Z" },
  { id: "chevron", name: "Chevron", group: "Arrows", data: "M 0 0 L 60 0 L 100 50 L 60 100 L 0 100 L 40 50 Z" },
  // Symbols
  { id: "heart", name: "Heart", group: "Symbols", data: `M 50 95 C 20 70 0 55 0 30 C 0 12 13 0 28 0 C 38 0 46 6 50 14 C 54 6 62 0 72 0 C 87 0 100 12 100 30 C 100 55 80 70 50 95 Z` },
  { id: "star-5", name: "5 Point Star", group: "Symbols", data: "M 50 0 L 61 35 L 98 35 L 68 57 L 79 91 L 50 70 L 21 91 L 32 57 L 2 35 L 39 35 Z" },
  { id: "star-6", name: "6 Point Star", group: "Symbols", data: "M 50 0 L 62 28 L 93 25 L 75 50 L 93 75 L 62 72 L 50 100 L 38 72 L 7 75 L 25 50 L 7 25 L 38 28 Z" },
  { id: "star-8", name: "8 Point Star", group: "Symbols", data: "M 50 0 L 60 24 L 85 15 L 76 40 L 100 50 L 76 60 L 85 85 L 60 76 L 50 100 L 40 76 L 15 85 L 24 60 L 0 50 L 24 40 L 15 15 L 40 24 Z" },
  { id: "check", name: "Check Mark", group: "Symbols", data: "M 0 55 L 18 37 L 38 57 L 82 10 L 100 28 L 38 92 Z" },
  { id: "cross", name: "Cross", group: "Symbols", data: "M 0 18 L 18 0 L 50 32 L 82 0 L 100 18 L 68 50 L 100 82 L 82 100 L 50 68 L 18 100 L 0 82 L 32 50 Z" },
  { id: "plus", name: "Plus", group: "Symbols", data: "M 35 0 L 65 0 L 65 35 L 100 35 L 100 65 L 65 65 L 65 100 L 35 100 L 35 65 L 0 65 L 0 35 L 35 35 Z" },
  { id: "minus", name: "Minus", group: "Symbols", data: "M 0 35 L 100 35 L 100 65 L 0 65 Z" },
  { id: "lightning", name: "Lightning", group: "Symbols", data: "M 45 0 L 90 0 L 60 38 L 85 38 L 25 100 L 42 55 L 15 55 Z" },
  { id: "moon", name: "Crescent Moon", group: "Symbols", data: `M 65 0 C 29 0 0 22 0 50 C 0 78 29 100 65 100 C 78 100 90 97 100 92 C 70 85 50 70 50 50 C 50 30 70 15 100 8 C 90 3 78 0 65 0 Z` },
  { id: "sun", name: "Sun", group: "Symbols", data: `M 50 25 C 64 25 75 36 75 50 C 75 64 64 75 50 75 C 36 75 25 64 25 50 C 25 36 36 25 50 25 Z M 46 0 L 54 0 L 54 15 L 46 15 Z M 46 85 L 54 85 L 54 100 L 46 100 Z M 0 46 L 15 46 L 15 54 L 0 54 Z M 85 46 L 100 46 L 100 54 L 85 54 Z M 14 20 L 20 14 L 30 24 L 24 30 Z M 70 76 L 76 70 L 86 80 L 80 86 Z M 76 30 L 70 24 L 80 14 L 86 20 Z M 24 70 L 30 76 L 20 86 L 14 80 Z` },
  { id: "cloud", name: "Cloud", group: "Symbols", data: `M 25 85 C 10 85 0 75 0 63 C 0 52 8 43 20 42 C 22 25 35 12 52 12 C 66 12 78 21 82 34 C 92 35 100 44 100 56 C 100 72 88 85 72 85 Z` },
  { id: "music-note", name: "Music Note", group: "Symbols", data: `M 40 0 L 100 15 L 100 35 L 55 24 L 55 78 C 55 90 45 100 32 100 C 20 100 12 92 12 83 C 12 73 22 65 35 65 C 37 65 39 65 40 66 Z` },
  { id: "envelope", name: "Envelope", group: "Symbols", data: "M 0 15 L 100 15 L 100 85 L 0 85 Z M 0 15 L 50 55 L 100 15 L 100 28 L 50 68 L 0 28 Z" },
  { id: "home", name: "Home", group: "Symbols", data: "M 50 0 L 100 45 L 85 45 L 85 100 L 60 100 L 60 70 L 40 70 L 40 100 L 15 100 L 15 45 L 0 45 Z" },
  { id: "flower", name: "Flower", group: "Symbols", data: "M 50 50 Q 15 0 50 0 Q 85 0 50 50 Q 100 15 100 50 Q 100 85 50 50 Q 85 100 50 100 Q 15 100 50 50 Q 0 85 0 50 Q 0 15 50 50 Z" },
  // Talk bubbles
  { id: "bubble-round", name: "Talk Bubble (Round)", group: "Talk Bubbles", data: `M 50 0 C 78 0 100 17 100 38 C 100 59 78 76 50 76 C 44 76 38 75 33 74 L 10 90 L 17 70 C 7 63 0 51 0 38 C 0 17 22 0 50 0 Z` },
  { id: "bubble-square", name: "Talk Bubble (Square)", group: "Talk Bubbles", data: "M 0 0 L 100 0 L 100 75 L 35 75 L 15 100 L 18 75 L 0 75 Z" },
  { id: "thought-bubble", name: "Thought Bubble", group: "Talk Bubbles", data: `M 50 0 C 78 0 100 15 100 36 C 100 57 78 72 50 72 C 22 72 0 57 0 36 C 0 15 22 0 50 0 Z M 22 78 C 27 78 31 81 31 85 C 31 89 27 92 22 92 C 17 92 13 89 13 85 C 13 81 17 78 22 78 Z M 10 94 C 12 94 14 95 14 97 C 14 99 12 100 10 100 C 8 100 6 99 6 97 C 6 95 8 94 10 94 Z` },
  { id: "banner", name: "Banner", group: "Talk Bubbles", data: "M 0 20 L 100 20 L 88 50 L 100 80 L 0 80 L 12 50 Z" },
  // Basic
  { id: "ring", name: "Ring", group: "Basic", data: `M 50 0 C 77.6 0 100 22.4 100 50 C 100 77.6 77.6 100 50 100 C 22.4 100 0 77.6 0 50 C 0 22.4 22.4 0 50 0 Z M 50 25 C 36 25 25 36 25 50 C 25 64 36 75 50 75 C 64 75 75 64 75 50 C 75 36 64 25 50 25 Z` },
  { id: "diamond", name: "Diamond", group: "Basic", data: "M 50 0 L 100 50 L 50 100 L 0 50 Z" },
  { id: "triangle", name: "Triangle", group: "Basic", data: "M 50 0 L 100 100 L 0 100 Z" },
  { id: "pentagon", name: "Pentagon", group: "Basic", data: "M 50 0 L 100 38 L 81 100 L 19 100 L 0 38 Z" },
  { id: "hexagon", name: "Hexagon", group: "Basic", data: "M 25 0 L 75 0 L 100 50 L 75 100 L 25 100 L 0 50 Z" },
  { id: "octagon", name: "Octagon", group: "Basic", data: "M 29 0 L 71 0 L 100 29 L 100 71 L 71 100 L 29 100 L 0 71 L 0 29 Z" },
  { id: "circle", name: "Circle", group: "Basic", data: `M 50 0 C ${50 + K / 2} 0 100 ${50 - K / 2} 100 50 C 100 ${50 + K / 2} ${50 + K / 2} 100 50 100 C ${50 - K / 2} 100 0 ${50 + K / 2} 0 50 C 0 ${50 - K / 2} ${50 - K / 2} 0 50 0 Z` },
  { id: "puzzle", name: "Puzzle Piece", group: "Basic", data: `M 0 30 L 35 30 C 30 22 30 5 45 5 C 60 5 60 22 55 30 L 100 30 L 100 65 C 92 60 75 60 75 75 C 75 90 92 90 100 85 L 100 100 L 0 100 Z` },
];

export const CUSTOM_SHAPE_GROUPS: readonly string[] = [...new Set(CUSTOM_SHAPES.map((s) => s.group))];

const cache = new Map<string, Path>();

/** Unit-square path of a custom shape (cached). */
export function customShapePath(id: string): Path {
  let p = cache.get(id);
  if (!p) {
    const def = CUSTOM_SHAPES.find((s) => s.id === id) ?? CUSTOM_SHAPES[0]!;
    p = parseShapeData(def.data, def.name);
    cache.set(id, p);
  }
  return p;
}
