/** Pure layout helper: where does a document of `docW` x `docH` sit in the viewport? */

export interface FitRect {
  /** Left edge in viewport px. */
  x: number;
  /** Top edge in viewport px. */
  y: number;
  /** Width in viewport px. */
  w: number;
  /** Height in viewport px. */
  h: number;
  /** Scale factor applied to the document (1 = 100%). */
  zoom: number;
}

/**
 * Fit the document inside the viewport with `padding` px on every side, centred.
 * Scales up as well as down (Photoshop "Fit on Screen" semantics).
 */
export function fitRect(
  docW: number,
  docH: number,
  viewW: number,
  viewH: number,
  padding = 0,
): FitRect {
  const availW = Math.max(1, viewW - padding * 2);
  const availH = Math.max(1, viewH - padding * 2);
  const safeDocW = Math.max(1, docW);
  const safeDocH = Math.max(1, docH);
  const zoom = Math.min(availW / safeDocW, availH / safeDocH);
  const w = Math.max(1, Math.round(safeDocW * zoom));
  const h = Math.max(1, Math.round(safeDocH * zoom));
  const x = Math.round((viewW - w) / 2);
  const y = Math.round((viewH - h) / 2);
  return { x, y, w, h, zoom };
}
