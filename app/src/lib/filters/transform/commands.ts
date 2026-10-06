/**
 * History commands owned by the filters/transform module:
 * - `CompositeCommand`: several commands as one undo step.
 * - `RotateCanvasCommand`: arbitrary-angle canvas rotation (expands the canvas).
 * - `FlipImageCommand` / `RotateImageCommand`: whole-image flip and 90/180 rotation.
 */

import { Raster, Rect, Selection, StructuralCommand, type Command, type Document, type LayerDirtyRegion } from "$lib/engine";
import { Mat, affineResample, transformedBounds } from "./affine";

export class CompositeCommand implements Command {
  readonly label: string;
  private readonly cmds: Command[];

  constructor(label: string, cmds: Command[]) {
    this.label = label;
    this.cmds = cmds;
  }

  do(doc: Document): void {
    for (const c of this.cmds) c.do(doc);
  }

  undo(doc: Document): void {
    for (let i = this.cmds.length - 1; i >= 0; i--) this.cmds[i]!.undo(doc);
  }

  byteSize(): number {
    let n = 0;
    for (const c of this.cmds) n += c.byteSize?.() ?? 0;
    return n;
  }

  affected(): readonly LayerDirtyRegion[] {
    const out: LayerDirtyRegion[] = [];
    for (const c of this.cmds) out.push(...(c.affected?.() ?? []));
    return out;
  }
}

function selectionFromLuminance(lum: Raster): Selection {
  const s = new Selection(lum.width, lum.height);
  const d = lum.data;
  for (let i = 0, p = 0; i < s.mask.length; i++, p += 4) s.mask[i] = d[p]!;
  return s;
}

/** Size of the canvas after rotating a `w x h` canvas by `deg` (clockwise) about its centre. */
export function rotateCanvasBounds(w: number, h: number, deg: number): Rect {
  return transformedBounds(w, h, rotationAboutCenter(w, h, deg));
}

/** Matrix rotating `w x h` doc space by `deg` about its centre (result not yet re-origined). */
export function rotationAboutCenter(w: number, h: number, deg: number): Mat {
  const rad = (deg * Math.PI) / 180;
  return Mat.chain(Mat.translate(-w / 2, -h / 2), Mat.rotate(rad), Mat.translate(w / 2, h / 2));
}

/**
 * Rotate the whole canvas by an arbitrary angle (degrees, clockwise). The canvas grows to
 * contain the rotated image; uncovered areas are transparent. Multiples of 90 use the
 * exact raster helpers.
 */
export class RotateCanvasCommand extends StructuralCommand {
  readonly label: string;
  private readonly deg: number;

  constructor(deg: number) {
    super();
    this.deg = ((deg % 360) + 360) % 360;
    this.label = `Rotate Canvas ${deg}°`;
  }

  protected apply(doc: Document): void {
    const w = doc.width;
    const h = doc.height;
    const deg = this.deg;
    if (deg === 0) return;
    if (deg % 90 === 0) {
      rotateImageExact(doc, deg === 90 ? "90cw" : deg === 270 ? "90ccw" : "180");
      return;
    }
    const m = rotationAboutCenter(w, h, deg);
    const bounds = rotateCanvasBounds(w, h, deg);
    // Shift so the rotated bounds start at the origin.
    const toDoc = Mat.mul(Mat.translate(-bounds.x, -bounds.y), m);
    const outRect = Rect.ofSize(bounds.w, bounds.h);
    for (const layer of doc.layers) {
      if (layer.kind !== "raster") continue;
      const lm = Mat.mul(toDoc, Mat.translate(layer.offset.x, layer.offset.y));
      layer.raster = affineResample(layer.raster, lm, outRect);
      if (layer.mask) {
        const mask = affineResample(layer.mask, lm, outRect);
        // Uncovered mask area must be white (= fully shown) so the layer isn't hidden.
        const d = mask.data;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) {
            d[i] = d[i + 1] = d[i + 2] = 255;
          }
          d[i + 3] = 255;
        }
        layer.mask = mask;
      }
      layer.offset = { x: 0, y: 0 };
    }
    if (!doc.selection.isEmpty) {
      const lum = affineResample(doc.selection.toLuminanceMask(), toDoc, outRect);
      doc.selection = selectionFromLuminance(lum);
    } else {
      doc.selection = Selection.none(bounds.w, bounds.h);
    }
    doc.width = bounds.w;
    doc.height = bounds.h;
  }
}

export type ExactRotation = "90cw" | "90ccw" | "180";

/** In-place exact rotation of every layer + selection + canvas size. */
function rotateImageExact(doc: Document, how: ExactRotation): void {
  const w = doc.width;
  const h = doc.height;
  for (const layer of doc.layers) {
    if (layer.kind !== "raster") continue;
    const r = layer.raster;
    const ox = layer.offset.x;
    const oy = layer.offset.y;
    switch (how) {
      case "90cw":
        layer.raster = r.rotate90(true);
        if (layer.mask) layer.mask = layer.mask.rotate90(true);
        // (x, y) -> (h - 1 - y, x): the layer's top-left maps from its bottom-left corner.
        layer.offset = { x: h - (oy + r.height), y: ox };
        break;
      case "90ccw":
        layer.raster = r.rotate90(false);
        if (layer.mask) layer.mask = layer.mask.rotate90(false);
        layer.offset = { x: oy, y: w - (ox + r.width) };
        break;
      case "180":
        layer.raster = r.flipH().flipV();
        if (layer.mask) layer.mask = layer.mask.flipH().flipV();
        layer.offset = { x: w - (ox + r.width), y: h - (oy + r.height) };
        break;
    }
  }
  const lum = doc.selection.toLuminanceMask();
  const rotated = how === "90cw" ? lum.rotate90(true) : how === "90ccw" ? lum.rotate90(false) : lum.flipH().flipV();
  doc.selection = selectionFromLuminance(rotated);
  if (how !== "180") {
    doc.width = h;
    doc.height = w;
  }
}

export class RotateImageCommand extends StructuralCommand {
  readonly label: string;
  private readonly how: ExactRotation;

  constructor(how: ExactRotation) {
    super();
    this.how = how;
    this.label = how === "90cw" ? "Rotate Canvas 90° CW" : how === "90ccw" ? "Rotate Canvas 90° CCW" : "Rotate Canvas 180°";
  }

  protected apply(doc: Document): void {
    rotateImageExact(doc, this.how);
  }
}

export class FlipImageCommand extends StructuralCommand {
  readonly label: string;
  private readonly axis: "h" | "v";

  constructor(axis: "h" | "v") {
    super();
    this.axis = axis;
    this.label = axis === "h" ? "Flip Canvas Horizontal" : "Flip Canvas Vertical";
  }

  protected apply(doc: Document): void {
    for (const layer of doc.layers) {
      if (layer.kind !== "raster") continue;
      const r = layer.raster;
      if (this.axis === "h") {
        layer.raster = r.flipH();
        if (layer.mask) layer.mask = layer.mask.flipH();
        layer.offset = { x: doc.width - (layer.offset.x + r.width), y: layer.offset.y };
      } else {
        layer.raster = r.flipV();
        if (layer.mask) layer.mask = layer.mask.flipV();
        layer.offset = { x: layer.offset.x, y: doc.height - (layer.offset.y + r.height) };
      }
    }
    const lum = doc.selection.toLuminanceMask();
    doc.selection = selectionFromLuminance(this.axis === "h" ? lum.flipH() : lum.flipV());
  }
}
