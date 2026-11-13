import type { Rect, Viewport } from "$lib/engine";

/** Place the selection toolbar below the rotated selection, keeping it in view. */
export function contextualPosition(rect: Rect, viewport: Viewport, width: number, height: number, barWidth: number, barHeight: number): { x: number; y: number } | null {
  if (width < 80 || height < barHeight + 16) return null;
  const points = [
    { x: rect.x, y: rect.y }, { x: rect.x + rect.w, y: rect.y },
    { x: rect.x, y: rect.y + rect.h }, { x: rect.x + rect.w, y: rect.y + rect.h },
  ].map((p) => viewport.docToScreen(p));
  const left = Math.min(...points.map((p) => p.x)), right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y)), bottom = Math.max(...points.map((p) => p.y));
  if (right < 0 || left > width || bottom < 0 || top > height) return null;
  const x = Math.max(8, Math.min(width - barWidth - 8, (left + right - barWidth) / 2));
  const preferredY = bottom + barHeight + 16 <= height ? bottom + 8 : top - barHeight - 8;
  return { x, y: Math.max(8, Math.min(height - barHeight - 8, preferredY)) };
}
