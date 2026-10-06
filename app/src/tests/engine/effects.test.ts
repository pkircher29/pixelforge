import { describe, expect, it } from "vitest";
import {
  BlendMode,
  CanvasCompositor,
  Raster,
  Rect,
  addLayer,
  compositeToRaster,
  createDocument,
  createRasterLayer,
  defaultBevelEmboss,
  defaultColorOverlay,
  defaultDropShadow,
  defaultGradientOverlay,
  defaultInnerGlow,
  defaultInnerShadow,
  defaultOuterGlow,
  defaultStroke,
  effectExtent,
  hasEnabledEffects,
  layerVisualRect,
  renderLayerStyle,
  rgba,
  type LayerEffects,
} from "../../lib/engine";

/** 20x20 raster with an opaque blue 8x8 square at (6,6). */
function square(): Raster {
  const r = new Raster(20, 20);
  r.fill(rgba(0, 0, 255), Rect.make(6, 6, 8, 8));
  return r;
}

function at(r: Raster, x: number, y: number, dx: number): [number, number, number, number] {
  // `dx` = extent so callers can address in source coordinates.
  const p = r.getPixel(x + dx, y + dx);
  return [p.r, p.g, p.b, p.a];
}

describe("effectExtent / hasEnabledEffects", () => {
  it("computes the padding from the enabled effects only", () => {
    expect(effectExtent(null)).toBe(0);
    expect(hasEnabledEffects(null)).toBe(false);
    const fx: LayerEffects = { dropShadow: defaultDropShadow({ distance: 5, size: 3 }), stroke: defaultStroke({ size: 2, position: "inside" }) };
    expect(effectExtent(fx)).toBe(9);
    fx.dropShadow!.enabled = false;
    expect(effectExtent(fx)).toBe(0);
    expect(hasEnabledEffects(fx)).toBe(true);
    fx.stroke!.position = "outside";
    expect(effectExtent(fx)).toBe(3);
    fx.outerGlow = defaultOuterGlow({ size: 10 });
    expect(effectExtent(fx)).toBe(11);
  });
});

describe("drop shadow", () => {
  it("uses the global light angle by default (120°) unless useGlobalLight is off", () => {
    const explicit = renderLayerStyle(square(), { dropShadow: defaultDropShadow({ angle: 180, distance: 5, size: 0, opacity: 1 }) });
    // Global light wins: shadow goes down-right, so nothing lands straight right at y = 10.
    expect(at(explicit.raster, 17, 10, explicit.extent)[3]).toBe(0);
    const global = renderLayerStyle(square(), { globalLightAngle: 180, dropShadow: defaultDropShadow({ distance: 5, size: 0, opacity: 1 }) });
    expect(at(global.raster, 17, 10, global.extent)[3]).toBe(255);
  });

  it("offsets opposite to the light angle (PS: 180° casts to the right) and is knocked out under the shape", () => {
    const fx: LayerEffects = { dropShadow: defaultDropShadow({ angle: 180, useGlobalLight: false, distance: 5, size: 0, opacity: 1, blendMode: BlendMode.Normal }) };
    const { raster, extent, dx } = renderLayerStyle(square(), fx);
    expect(dx).toBe(-extent);
    // Right of the square (x = 14..18) at y = 10: shadow.
    expect(at(raster, 15, 10, extent)).toEqual([0, 0, 0, 255]);
    expect(at(raster, 18, 10, extent)).toEqual([0, 0, 0, 255]);
    expect(at(raster, 19, 10, extent)[3]).toBe(0);
    // Left of the square: nothing.
    expect(at(raster, 4, 10, extent)[3]).toBe(0);
    // Under the square: the blue fill (shadow knocked out, fill opaque anyway).
    expect(at(raster, 10, 10, extent)).toEqual([0, 0, 255, 255]);
  });

  it("angle 120 (default) casts down-right; blur softens the edge; opacity scales", () => {
    const fx: LayerEffects = { dropShadow: defaultDropShadow({ distance: 4, size: 2, opacity: 0.5, blendMode: BlendMode.Normal }) };
    const { raster, extent } = renderLayerStyle(square(), fx);
    // dx = -cos(120)*4 = +2, dy = sin(120)*4 ≈ 3.46 → 3
    const inside = at(raster, 10, 16, extent); // below the square, inside the shadow core
    expect(inside[3]).toBeGreaterThan(60);
    expect(inside[3]).toBeLessThanOrEqual(128);
    const edge = at(raster, 10, 18, extent);
    expect(edge[3]).toBeLessThan(inside[3]);
    expect(at(raster, 3, 3, extent)[3]).toBe(0);
  });

  it("spread hardens the shadow edge", () => {
    const soft = renderLayerStyle(square(), { dropShadow: defaultDropShadow({ angle: 180, useGlobalLight: false, distance: 0, size: 4, spread: 0, opacity: 1 }) });
    const hard = renderLayerStyle(square(), { dropShadow: defaultDropShadow({ angle: 180, useGlobalLight: false, distance: 0, size: 4, spread: 100, opacity: 1 }) });
    const e = soft.extent;
    // 2px outside the square edge (x = 15): hard spread → fully opaque, soft → partial.
    expect(at(hard.raster, 15, 10, e)[3]).toBe(255);
    expect(at(soft.raster, 15, 10, e)[3]).toBeGreaterThan(0);
    expect(at(soft.raster, 15, 10, e)[3]).toBeLessThan(255);
  });
});

describe("stroke", () => {
  it("outside adds an N px ring, inside eats into the shape, center straddles", () => {
    const outside = renderLayerStyle(square(), { stroke: defaultStroke({ size: 2, position: "outside", color: rgba(255, 0, 0) }) });
    const e = outside.extent;
    expect(at(outside.raster, 5, 10, e)).toEqual([255, 0, 0, 255]);
    expect(at(outside.raster, 4, 10, e)).toEqual([255, 0, 0, 255]);
    expect(at(outside.raster, 3, 10, e)[3]).toBe(0);
    expect(at(outside.raster, 6, 10, e)).toEqual([0, 0, 255, 255]);

    const inside = renderLayerStyle(square(), { stroke: defaultStroke({ size: 2, position: "inside", color: rgba(255, 0, 0) }) });
    expect(inside.extent).toBe(0);
    expect(at(inside.raster, 6, 10, 0)).toEqual([255, 0, 0, 255]);
    expect(at(inside.raster, 7, 10, 0)).toEqual([255, 0, 0, 255]);
    expect(at(inside.raster, 8, 10, 0)).toEqual([0, 0, 255, 255]);
    expect(at(inside.raster, 5, 10, 0)[3]).toBe(0);

    const center = renderLayerStyle(square(), { stroke: defaultStroke({ size: 2, position: "center", color: rgba(255, 0, 0) }) });
    const c = center.extent;
    expect(at(center.raster, 5, 10, c)).toEqual([255, 0, 0, 255]);
    expect(at(center.raster, 6, 10, c)).toEqual([255, 0, 0, 255]);
    expect(at(center.raster, 7, 10, c)).toEqual([0, 0, 255, 255]);
    expect(at(center.raster, 4, 10, c)[3]).toBe(0);
  });

  it("gradient stroke uses the gradient colours", () => {
    const fx: LayerEffects = {
      stroke: defaultStroke({
        size: 2,
        position: "outside",
        fillType: "gradient",
        gradient: { stops: [{ pos: 0, color: rgba(255, 0, 0) }, { pos: 1, color: rgba(0, 255, 0) }] },
        gradientAngle: 90,
      }),
    };
    const { raster, extent } = renderLayerStyle(square(), fx);
    const top = at(raster, 10, 4, extent);
    const bottom = at(raster, 10, 15, extent);
    expect(top[3]).toBe(255);
    expect(bottom[3]).toBe(255);
    expect(top[1]).toBeGreaterThan(bottom[1]); // green at the top (angle 90 = bottom→top)
    expect(bottom[0]).toBeGreaterThan(top[0]);
  });
});

describe("glows", () => {
  it("outer glow is outside the shape only and fades with distance", () => {
    const { raster, extent } = renderLayerStyle(square(), { outerGlow: defaultOuterGlow({ size: 4, opacity: 1, color: rgba(255, 255, 0), blendMode: BlendMode.Normal }) });
    const near = at(raster, 14, 10, extent);
    const far = at(raster, 17, 10, extent);
    expect(near[3]).toBeGreaterThan(far[3]);
    expect(far[3]).toBeGreaterThanOrEqual(0);
    expect(near[0]).toBe(255);
    expect(near[2]).toBe(0);
    expect(at(raster, 10, 10, extent)).toEqual([0, 0, 255, 255]); // fill intact
  });

  it("inner glow (edge) lights the inside edge, (center) the middle", () => {
    const edge = renderLayerStyle(square(), { innerGlow: defaultInnerGlow({ size: 3, opacity: 1, color: rgba(255, 255, 0), blendMode: BlendMode.Normal, source: "edge" }) });
    const e1 = at(edge.raster, 6, 10, 0);
    const mid1 = at(edge.raster, 10, 10, 0);
    expect(e1[0]).toBeGreaterThan(mid1[0]);
    expect(e1[3]).toBe(255);
    expect(at(edge.raster, 5, 10, 0)[3]).toBe(0);
    const center = renderLayerStyle(square(), { innerGlow: defaultInnerGlow({ size: 4, opacity: 1, color: rgba(255, 255, 0), blendMode: BlendMode.Normal, source: "center" }) });
    const e2 = at(center.raster, 6, 10, 0);
    const mid2 = at(center.raster, 10, 10, 0);
    expect(mid2[0]).toBeGreaterThan(e2[0]);
  });
});

describe("inner shadow", () => {
  it("shades the inside edge on the light side", () => {
    const { raster } = renderLayerStyle(square(), { innerShadow: defaultInnerShadow({ angle: 180, useGlobalLight: false, distance: 3, size: 0, opacity: 1, blendMode: BlendMode.Normal }) });
    // Light from the left (180°): shadow is cast rightwards → the left inner strip is dark.
    expect(at(raster, 6, 10, 0)).toEqual([0, 0, 0, 255]);
    expect(at(raster, 8, 10, 0)).toEqual([0, 0, 0, 255]);
    expect(at(raster, 10, 10, 0)).toEqual([0, 0, 255, 255]);
    expect(at(raster, 13, 10, 0)).toEqual([0, 0, 255, 255]);
    expect(at(raster, 5, 10, 0)[3]).toBe(0);
  });
});

describe("overlays", () => {
  it("colour overlay replaces the colour inside the shape at its opacity", () => {
    const full = renderLayerStyle(square(), { colorOverlay: defaultColorOverlay({ color: rgba(255, 0, 0), opacity: 1 }) });
    expect(at(full.raster, 10, 10, 0)).toEqual([255, 0, 0, 255]);
    expect(at(full.raster, 2, 2, 0)[3]).toBe(0);
    const half = renderLayerStyle(square(), { colorOverlay: defaultColorOverlay({ color: rgba(255, 0, 0), opacity: 0.5 }) });
    const p = at(half.raster, 10, 10, 0);
    expect(Math.abs(p[0] - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs(p[2] - 128)).toBeLessThanOrEqual(1);
  });

  it("gradient overlay ramps over the layer bounds with Multiply blending", () => {
    const fx: LayerEffects = { gradientOverlay: defaultGradientOverlay({ angle: 90, blendMode: BlendMode.Normal, gradient: { stops: [{ pos: 0, color: rgba(0, 0, 0) }, { pos: 1, color: rgba(255, 255, 255) }] } }) };
    const { raster } = renderLayerStyle(square(), fx);
    const top = at(raster, 10, 6, 0);
    const bottom = at(raster, 10, 13, 0);
    expect(top[0]).toBeGreaterThan(bottom[0]);
    expect(top[0]).toBeGreaterThan(200);
    expect(bottom[0]).toBeLessThan(60);
    // Multiply with the blue fill keeps blue only.
    const mul = renderLayerStyle(square(), { gradientOverlay: { ...fx.gradientOverlay!, blendMode: BlendMode.Multiply } });
    expect(at(mul.raster, 10, 6, 0)[0]).toBe(0);
    expect(at(mul.raster, 10, 6, 0)[2]).toBeGreaterThan(200);
  });
});

describe("bevel & emboss", () => {
  it("inner bevel highlights the edge facing the light and shadows the opposite edge", () => {
    const { raster } = renderLayerStyle(square(), { bevelEmboss: defaultBevelEmboss({ size: 3, technique: "chiselHard", angle: 180, altitude: 30, useGlobalLight: false, highlightOpacity: 1, shadowOpacity: 1 }) });
    // Light from the left: left edge brighter than the centre, right edge darker.
    const left = at(raster, 6, 10, 0);
    const mid = at(raster, 10, 10, 0);
    const right = at(raster, 13, 10, 0);
    expect(left[0]).toBeGreaterThan(mid[0]);
    expect(right[2]).toBeLessThan(mid[2]);
    expect(mid).toEqual([0, 0, 255, 255]);
  });

  it("direction down swaps highlight and shadow; outer bevel draws outside the shape", () => {
    const up = renderLayerStyle(square(), { bevelEmboss: defaultBevelEmboss({ size: 3, technique: "chiselHard", angle: 180, useGlobalLight: false, direction: "up", highlightOpacity: 1, shadowOpacity: 1 }) });
    const down = renderLayerStyle(square(), { bevelEmboss: defaultBevelEmboss({ size: 3, technique: "chiselHard", angle: 180, useGlobalLight: false, direction: "down", highlightOpacity: 1, shadowOpacity: 1 }) });
    expect(at(up.raster, 6, 10, 0)[0]).toBeGreaterThan(at(down.raster, 6, 10, 0)[0]);
    const outer = renderLayerStyle(square(), { bevelEmboss: defaultBevelEmboss({ style: "outerBevel", size: 3, technique: "chiselHard", angle: 180, useGlobalLight: false, highlightOpacity: 1, shadowOpacity: 1 }) });
    expect(outer.extent).toBeGreaterThan(0);
    const outsideLeft = at(outer.raster, 4, 10, outer.extent);
    expect(outsideLeft[3]).toBeGreaterThan(0);
    expect(at(outer.raster, 10, 10, outer.extent)).toEqual([0, 0, 255, 255]);
  });
});

describe("effects in the compositor", () => {
  it("render order: stroke over overlay over fill, shadow beneath; fill opacity 0 keeps the stroke", () => {
    const doc = createDocument({ width: 20, height: 20, background: "white" });
    const l = createRasterLayer(doc, { name: "sq", raster: square() });
    l.effects = {
      dropShadow: defaultDropShadow({ angle: 180, useGlobalLight: false, distance: 5, size: 0, opacity: 1, blendMode: BlendMode.Normal }),
      colorOverlay: defaultColorOverlay({ color: rgba(0, 255, 0) }),
      stroke: defaultStroke({ size: 1, position: "inside", color: rgba(255, 0, 0) }),
    };
    addLayer(doc, l);
    const out = compositeToRaster(doc);
    expect(out.getPixel(10, 10)).toEqual(rgba(0, 255, 0)); // overlay over fill
    expect(out.getPixel(6, 10)).toEqual(rgba(255, 0, 0)); // stroke on top
    expect(out.getPixel(16, 10)).toEqual(rgba(0, 0, 0)); // shadow outside on white
    l.fillOpacity = 0;
    const out2 = compositeToRaster(doc);
    expect(out2.getPixel(10, 10)).toEqual(rgba(0, 255, 0)); // overlay stays (PS)
    expect(out2.getPixel(6, 10)).toEqual(rgba(255, 0, 0));
  });

  it("layer opacity scales the whole styled result and the mask shapes the effects", () => {
    const doc = createDocument({ width: 20, height: 20, background: "white" });
    const l = createRasterLayer(doc, { name: "sq", raster: square(), opacity: 0.5 });
    l.effects = { dropShadow: defaultDropShadow({ angle: 180, useGlobalLight: false, distance: 5, size: 0, opacity: 1, blendMode: BlendMode.Normal }) };
    addLayer(doc, l);
    const half = compositeToRaster(doc).getPixel(16, 10);
    expect(Math.abs(half.r - 127)).toBeLessThanOrEqual(1);
    // Mask hides the right half of the square → its shadow moves with the masked edge.
    const m = new Raster(20, 20);
    m.fill(rgba(255, 255, 255), Rect.make(0, 0, 10, 20));
    l.mask = m;
    l.opacity = 1;
    const out = compositeToRaster(doc);
    expect(out.getPixel(16, 10)).toEqual(rgba(255, 255, 255)); // no shadow from the hidden part
    expect(out.getPixel(12, 10)).toEqual(rgba(0, 0, 0)); // shadow of the visible half (x 6..9 → 11..14)
  });

  it("layerVisualRect grows by the effect extent and the Canvas compositor recomposites it", () => {
    const doc = createDocument({ width: 20, height: 20, background: "white" });
    const l = createRasterLayer(doc, { name: "sq", raster: new Raster(8, 8), offset: { x: 6, y: 6 } });
    l.raster.fill(rgba(0, 0, 255));
    l.effects = { outerGlow: defaultOuterGlow({ size: 3 }) };
    addLayer(doc, l);
    expect(layerVisualRect(doc, l)).toEqual(Rect.make(2, 2, 16, 16));
    const put: number[][] = [];
    const ctx = {
      setTransform: () => undefined,
      fillRect: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      drawImage: () => undefined,
      createPattern: () => null,
      putImageData: (_img: unknown, ...rest: number[]) => put.push(rest),
      stroke: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
    };
    const canvas = { width: 40, height: 40, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const origCreate = document.createElement.bind(document);
    (document as unknown as { createElement: (t: string) => unknown }).createElement = (t: string) => (t === "canvas" ? { width: 0, height: 0, getContext: () => ctx } : origCreate(t));
    try {
      const comp = new CanvasCompositor(canvas);
      const vp = new (class {
        zoom = 1;
        matrix(m: Float32Array): Float32Array {
          m.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
          return m;
        }
        screenToDoc(p: { x: number; y: number }): { x: number; y: number } {
          return p;
        }
        docToScreen(p: { x: number; y: number }, out: { x: number; y: number }): { x: number; y: number } {
          out.x = p.x;
          out.y = p.y;
          return out;
        }
      })();
      const s1 = comp.render(doc, vp as never);
      expect(s1.compositedArea).toBe(400);
      comp.markDirty(l.id, Rect.make(0, 0, 1, 1));
      const s2 = comp.render(doc, vp as never);
      // 1 px dirty inflated by the glow extent (4) → 9x9 region, clamped to the doc.
      expect(s2.recomposited).toBe(true);
      expect(s2.compositedArea).toBe(9 * 9);
      const s3 = comp.render(doc, vp as never);
      expect(s3.recomposited).toBe(false);
    } finally {
      (document as unknown as { createElement: typeof origCreate }).createElement = origCreate;
    }
  });
});
