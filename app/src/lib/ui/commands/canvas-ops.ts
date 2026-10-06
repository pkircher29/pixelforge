/**
 * Whole-canvas flip / rotate as undoable structural commands (built on the engine's
 * `StructuralCommand`, which snapshots layer rasters and offsets).
 */
import { Raster, Selection, StructuralCommand, type Document } from "$lib/engine";

function selectionFromLum(lum: Raster): Selection {
  const s = new Selection(lum.width, lum.height);
  const d = lum.data;
  for (let i = 0, p = 0; i < s.mask.length; i++, p += 4) s.mask[i] = d[p]!;
  return s;
}

export class FlipCanvasCommand extends StructuralCommand {
  readonly label: string;
  private readonly axis: "h" | "v";

  constructor(axis: "h" | "v") {
    super();
    this.axis = axis;
    this.label = axis === "h" ? "Flip Canvas Horizontal" : "Flip Canvas Vertical";
  }

  protected apply(doc: Document): void {
    for (const l of doc.layers) {
      if (l.kind !== "raster") continue;
      if (this.axis === "h") {
        l.raster = l.raster.flipH();
        if (l.mask) l.mask = l.mask.flipH();
        l.offset = { x: doc.width - (l.offset.x + l.raster.width), y: l.offset.y };
      } else {
        l.raster = l.raster.flipV();
        if (l.mask) l.mask = l.mask.flipV();
        l.offset = { x: l.offset.x, y: doc.height - (l.offset.y + l.raster.height) };
      }
    }
    const lum = doc.selection.toLuminanceMask();
    doc.selection = selectionFromLum(this.axis === "h" ? lum.flipH() : lum.flipV());
  }
}

export class RotateCanvasCommand extends StructuralCommand {
  readonly label: string;
  private readonly turns: 1 | 2 | 3;

  /** `turns` quarter turns clockwise. */
  constructor(turns: 1 | 2 | 3) {
    super();
    this.turns = turns;
    this.label = turns === 1 ? "Rotate Canvas 90° CW" : turns === 2 ? "Rotate Canvas 180°" : "Rotate Canvas 90° CCW";
  }

  protected apply(doc: Document): void {
    const W = doc.width;
    const H = doc.height;
    for (const l of doc.layers) {
      if (l.kind !== "raster") continue;
      const w = l.raster.width;
      const h = l.raster.height;
      const { x, y } = l.offset;
      if (this.turns === 2) {
        l.raster = l.raster.flipH().flipV();
        if (l.mask) l.mask = l.mask.flipH().flipV();
        l.offset = { x: W - (x + w), y: H - (y + h) };
      } else if (this.turns === 1) {
        l.raster = l.raster.rotate90(true);
        if (l.mask) l.mask = l.mask.rotate90(true);
        // (x, y) top-left → new x = H - (y + h), new y = x
        l.offset = { x: H - (y + h), y: x };
      } else {
        l.raster = l.raster.rotate90(false);
        if (l.mask) l.mask = l.mask.rotate90(false);
        // new x = y, new y = W - (x + w)
        l.offset = { x: y, y: W - (x + w) };
      }
    }
    let lum = doc.selection.toLuminanceMask();
    if (this.turns === 2) lum = lum.flipH().flipV();
    else lum = lum.rotate90(this.turns === 1);
    doc.selection = selectionFromLum(lum);
    if (this.turns !== 2) {
      doc.width = H;
      doc.height = W;
    }
  }
}
