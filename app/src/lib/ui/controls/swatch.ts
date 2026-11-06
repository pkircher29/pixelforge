export type SwatchColor = string | { r: number; g: number; b: number; a?: number };

export function swatchCss(color: SwatchColor): string {
  if (typeof color === "string") return color;
  const byte = (v: number) => Number.isFinite(v) ? Math.max(0, Math.min(255, v)) : 0;
  return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${byte(color.a ?? 255) / 255})`;
}
