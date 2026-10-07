/** Draw engine paths on the overlay canvas in Photoshop's 1 px blue with anchors and handles. */
import type { Anchor, Path, Viewport } from "$lib/engine";
import type { AnchorRef } from "./path-edit";

export const PATH_BLUE = "#1473e6";

export interface PathDrawOptions {
  /** Anchors drawn filled (selected). */
  selected?: readonly AnchorRef[];
  /** Show handles of these anchors (default: selected ones + their neighbours). */
  showHandles?: boolean;
  /** Draw anchors at all (Path Selection: no). */
  anchors?: boolean;
  /** Rubber band: a preview anchor appended to the last open subpath. */
  rubber?: { x: number; y: number; anchor?: Anchor } | null;
}

function bez(g: CanvasRenderingContext2D, vp: Viewport, a: Anchor, b: Anchor): void {
  const c1 = vp.docToScreen({ x: a.outX, y: a.outY });
  const c2 = vp.docToScreen({ x: b.inX, y: b.inY });
  const p = vp.docToScreen({ x: b.x, y: b.y });
  g.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p.x, p.y);
}

export function tracePath(g: CanvasRenderingContext2D, vp: Viewport, path: Path, rubber?: PathDrawOptions["rubber"]): void {
  path.subpaths.forEach((sp, si) => {
    const n = sp.anchors.length;
    if (n === 0) return;
    const first = vp.docToScreen({ x: sp.anchors[0]!.x, y: sp.anchors[0]!.y });
    g.moveTo(first.x, first.y);
    for (let i = 1; i < n; i++) bez(g, vp, sp.anchors[i - 1]!, sp.anchors[i]!);
    if (sp.closed && n > 1) {
      bez(g, vp, sp.anchors[n - 1]!, sp.anchors[0]!);
      g.closePath();
    } else if (rubber && si === path.subpaths.length - 1 && !sp.closed) {
      const last = sp.anchors[n - 1]!;
      const r = rubber.anchor ?? { x: rubber.x, y: rubber.y, inX: rubber.x, inY: rubber.y, outX: rubber.x, outY: rubber.y, type: "corner" as const };
      bez(g, vp, last, r);
    }
  });
}

export function drawPath(g: CanvasRenderingContext2D, vp: Viewport, path: Path, opts: PathDrawOptions = {}): void {
  g.save();
  g.lineWidth = 1;
  g.beginPath();
  tracePath(g, vp, path, opts.rubber);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.lineWidth = 2.5;
  g.globalAlpha = 0.5;
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = 1;
  g.strokeStyle = PATH_BLUE;
  g.stroke();
  if (opts.anchors !== false) {
    const selected = opts.selected ?? [];
    const isSel = (si: number, ai: number): boolean => selected.some((r) => r.subpath === si && r.index === ai);
    path.subpaths.forEach((sp, si) => {
      sp.anchors.forEach((a, ai) => {
        const sel = isSel(si, ai);
        const show = opts.showHandles ?? (sel || selected.some((r) => r.subpath === si && Math.abs(r.index - ai) <= 1));
        if (show) drawHandles(g, vp, a);
        drawAnchor(g, vp, a, sel);
      });
    });
  }
  g.restore();
}

export function drawAnchor(g: CanvasRenderingContext2D, vp: Viewport, a: Anchor, selected: boolean): void {
  const p = vp.docToScreen({ x: a.x, y: a.y });
  const x = Math.round(p.x);
  const y = Math.round(p.y);
  g.beginPath();
  g.rect(x - 2.5, y - 2.5, 5, 5);
  g.fillStyle = selected ? PATH_BLUE : "#ffffff";
  g.fill();
  g.strokeStyle = selected ? "#ffffff" : PATH_BLUE;
  g.lineWidth = 1;
  g.stroke();
}

export function drawHandles(g: CanvasRenderingContext2D, vp: Viewport, a: Anchor): void {
  const p = vp.docToScreen({ x: a.x, y: a.y });
  for (const h of [
    { x: a.inX, y: a.inY },
    { x: a.outX, y: a.outY },
  ]) {
    if (Math.abs(h.x - a.x) < 1e-6 && Math.abs(h.y - a.y) < 1e-6) continue;
    const s = vp.docToScreen(h);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(s.x, s.y);
    g.strokeStyle = PATH_BLUE;
    g.lineWidth = 1;
    g.stroke();
    g.beginPath();
    g.arc(s.x, s.y, 2.5, 0, Math.PI * 2);
    g.fillStyle = "#ffffff";
    g.fill();
    g.stroke();
  }
}
