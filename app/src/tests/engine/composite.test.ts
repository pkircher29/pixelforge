import { describe, expect, it } from "vitest";
import {
  BLEND_MODES,
  BLEND_UNIFORMS,
  BlendMode,
  CanvasCompositor,
  DirtyTracker,
  FULLSCREEN_VERT,
  GlCompositor,
  PRESENT_FRAG,
  PRESENT_UNIFORMS,
  Rect,
  Selection,
  Viewport,
  addLayer,
  buildBlendFragment,
  buildBlendSingle,
  computeSelectionEdge,
  createCompositor,
  createDocument,
  createRasterLayer,
  groupLayers,
  lowestIndexOf,
  rgba,
  thresholdMask,
} from "../../lib/engine";

// ---------------------------------------------------------------------------
// Shader source generation
// ---------------------------------------------------------------------------

describe("shader sources", () => {
  it("blend fragment with the mode switch covers all 16 modes and declares its uniforms", () => {
    const src = buildBlendFragment("all");
    expect(src.trimStart().startsWith("#version 300 es")).toBe(true);
    expect(FULLSCREEN_VERT.trimStart().startsWith("#version 300 es")).toBe(true);
    for (let i = 0; i < 16; i++) expect(src).toContain(`case ${i}:`);
    for (const u of BLEND_UNIFORMS) expect(src).toContain(`uniform`), expect(src).toContain(u);
    expect(src).toContain("pf_setLum");
    expect(src).toContain("pf_hardLight");
    expect((src.match(/\bvoid main\b/g) ?? []).length).toBe(1);
  });

  it("per-mode fragments embed exactly that mode's body", () => {
    const mul = buildBlendFragment(BlendMode.Multiply);
    expect(mul).toContain("return cb * cs;");
    expect(mul).not.toContain("case 1:");
    expect(buildBlendSingle(BlendMode.Hue)).toContain("pf_setSat(cs, pf_sat(cb))");
    for (const m of BLEND_MODES) expect(buildBlendFragment(m)).toContain("pf_blend(int mode, vec3 cb, vec3 cs)");
  });

  it("present fragment declares its uniforms and ants/grid/checker logic", () => {
    for (const u of PRESENT_UNIFORMS) expect(PRESENT_FRAG).toContain(u);
    expect(PRESENT_FRAG).toContain("u_antsPhase");
    expect(PRESENT_FRAG).toContain("fract(d)");
    expect(PRESENT_FRAG).toContain("u_screenToDoc");
  });
});

// ---------------------------------------------------------------------------
// Dirty-rect bookkeeping
// ---------------------------------------------------------------------------

describe("DirtyTracker", () => {
  it("unions rects, upgrades to full, takes and retains", () => {
    const d = new DirtyTracker();
    expect(d.isEmpty).toBe(true);
    d.mark("a", Rect.make(0, 0, 2, 2));
    d.mark("a", Rect.make(5, 5, 1, 1));
    expect(d.peek("a")).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    d.mark("a", Rect.empty()); // ignored
    expect(d.peek("a")).toEqual({ x: 0, y: 0, w: 6, h: 6 });
    d.mark("a");
    expect(d.peek("a")).toBe("full");
    d.mark("a", Rect.make(1, 1, 1, 1)); // stays full
    expect(d.take("a")).toBe("full");
    expect(d.take("a")).toBeUndefined();
    d.mark("b", Rect.make(1, 1, 1, 1));
    d.mark("c");
    d.retain(new Set(["c"]));
    expect(d.layerIds()).toEqual(["c"]);
    expect(lowestIndexOf(["x", "c", "b"], ["b", "c"])).toBe(1);
    expect(lowestIndexOf(["x"], ["q"])).toBe(-1);
  });
});

describe("selection edge", () => {
  it("finds the inner boundary of a rect and thresholds soft masks", () => {
    const s = Selection.fromRect(10, 10, Rect.make(2, 2, 3, 3));
    const e = computeSelectionEdge(s);
    expect(e.length).toBe(8);
    expect(Array.from(e)).toContain(2 * 10 + 2);
    expect(Array.from(e)).not.toContain(3 * 10 + 3);
    expect(computeSelectionEdge(Selection.none(4, 4)).length).toBe(0);
    // Canvas edge counts as a boundary.
    expect(computeSelectionEdge(Selection.all(3, 3)).length).toBe(8);
    const soft = new Selection(2, 1, new Uint8Array([127, 128]));
    expect(Array.from(thresholdMask(soft, new Uint8Array(2)))).toEqual([0, 255]);
  });
});

// ---------------------------------------------------------------------------
// GlCompositor against a recording WebGL2 mock (no real GPU in jsdom)
// ---------------------------------------------------------------------------

interface MockGl {
  gl: WebGL2RenderingContext;
  calls: Map<string, number>;
  count(name: string): number;
}

function mockGl(): MockGl {
  const calls = new Map<string, number>();
  const FRAMEBUFFER_COMPLETE = 0x8cd5;
  const record = (name: string): void => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
  };
  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getProgramInfoLog: () => "",
    checkFramebufferStatus: () => FRAMEBUFFER_COMPLETE,
    isContextLost: () => false,
    getUniformLocation: () => ({}),
    createShader: () => ({}),
    createProgram: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createVertexArray: () => ({}),
    getExtension: () => null,
  };
  const target: Record<string, unknown> = {};
  const gl = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "FRAMEBUFFER_COMPLETE") return FRAMEBUFFER_COMPLETE;
      if (/^[A-Z0-9_]+$/.test(prop)) {
        // Deterministic distinct constant per name.
        let h = 0;
        for (let i = 0; i < prop.length; i++) h = (h * 31 + prop.charCodeAt(i)) & 0xffff;
        return h + 1;
      }
      const custom = handlers[prop];
      return (...args: unknown[]): unknown => {
        record(prop);
        return custom ? custom(...args) : undefined;
      };
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, calls, count: (n) => calls.get(n) ?? 0 };
}

function fakeCanvas(): HTMLCanvasElement {
  const c = {
    width: 300,
    height: 200,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext: () => null,
  };
  return c as unknown as HTMLCanvasElement;
}

function threeLayerDoc() {
  const doc = createDocument({ width: 64, height: 48, background: "white" });
  const mid = createRasterLayer(doc, { name: "mid", blendMode: BlendMode.Multiply });
  mid.raster.fill(rgba(128, 128, 128));
  addLayer(doc, mid);
  const top = createRasterLayer(doc, { name: "top", blendMode: BlendMode.Screen, opacity: 0.5 });
  addLayer(doc, top);
  return { doc, bottom: doc.layers[0]!.id, mid: mid.id, top: top.id };
}

describe("GlCompositor bookkeeping (mock GL)", () => {
  it("uploads every layer and composites fully on the first frame, then does nothing on the second", () => {
    const m = mockGl();
    const { doc } = threeLayerDoc();
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const vp = new Viewport().fitToView(300, 200, doc.width, doc.height);
    const s1 = comp.render(doc, vp);
    expect(s1.drawn).toBe(true);
    expect(s1.recomposited).toBe(true);
    expect(s1.uploads).toBe(3);
    expect(s1.passes).toBe(3);
    expect(s1.compositedArea).toBe(64 * 48);
    expect(comp.debugState().layers).toBe(3);
    const s2 = comp.render(doc, vp);
    expect(s2.drawn).toBe(true);
    expect(s2.recomposited).toBe(false);
    expect(s2.uploads).toBe(0);
    expect(s2.passes).toBe(0);
    expect(s2.compositedArea).toBe(0);
    expect(comp.isContextLost()).toBe(false);
    comp.dispose();
  });

  it("markDirty uploads a sub-rect and re-composites only that area", () => {
    const m = mockGl();
    const { doc, mid } = threeLayerDoc();
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const vp = new Viewport();
    comp.render(doc, vp);
    const subBefore = m.count("texSubImage2D");
    comp.markDirty(mid, Rect.make(10, 10, 5, 4));
    comp.markDirty(mid, Rect.make(12, 12, 5, 4)); // unions to 10,10,7,6
    const s = comp.render(doc, vp);
    expect(s.uploads).toBe(1);
    expect(m.count("texSubImage2D")).toBe(subBefore + 1);
    expect(s.recomposited).toBe(true);
    expect(s.compositedArea).toBe(7 * 6);
    expect(s.passes).toBeGreaterThanOrEqual(2); // mid and top (bottom may be cached)
  });

  it("builds the below-cache for the active layer so later strokes need one pass", () => {
    const m = mockGl();
    const { doc, top } = threeLayerDoc();
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const vp = new Viewport();
    comp.render(doc, vp, { activeLayerId: top });
    expect(comp.debugState()).toMatchObject({ belowValid: true, belowIndex: 2 });
    comp.markDirty(top, Rect.make(0, 0, 8, 8));
    const s = comp.render(doc, vp, { activeLayerId: top });
    expect(s.passes).toBe(1);
    expect(s.compositedArea).toBe(64);
    // Changing a layer below the cache invalidates it.
    doc.layers[0]!.opacity = 0.5;
    const s2 = comp.render(doc, vp, { activeLayerId: top });
    expect(s2.recomposited).toBe(true);
    expect(s2.compositedArea).toBe(64 * 48);
    expect(comp.debugState().belowValid).toBe(true); // rebuilt during the full pass
  });

  it("detects property, visibility, raster swap, selection and structure changes", () => {
    const m = mockGl();
    const { doc, mid, top } = threeLayerDoc();
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const vp = new Viewport();
    comp.render(doc, vp);
    const layer = doc.layers[1]!;
    layer.blendMode = BlendMode.Overlay;
    expect(comp.render(doc, vp).recomposited).toBe(true);
    layer.visible = false;
    const sHidden = comp.render(doc, vp);
    expect(sHidden.recomposited).toBe(true);
    expect(sHidden.passes).toBe(2);
    layer.visible = true;
    layer.offset = { x: 5, y: 5 };
    expect(comp.render(doc, vp).recomposited).toBe(true);
    if (layer.kind === "raster") layer.raster = layer.raster.clone();
    const swapped = comp.render(doc, vp);
    expect(swapped.uploads).toBe(1);
    expect(swapped.recomposited).toBe(true);
    // Selection change re-uploads the mask but does not re-composite.
    const subBefore = m.count("texSubImage2D");
    doc.selection = Selection.fromRect(doc.width, doc.height, Rect.make(1, 1, 10, 10));
    const sel = comp.render(doc, vp);
    expect(sel.recomposited).toBe(false);
    expect(m.count("texSubImage2D")).toBe(subBefore + 1);
    // Removing a layer frees its texture; grouping re-composites.
    const delBefore = m.count("deleteTexture");
    doc.layers = doc.layers.filter((l) => l.id !== mid);
    const removed = comp.render(doc, vp);
    expect(removed.recomposited).toBe(true);
    expect(m.count("deleteTexture")).toBe(delBefore + 1);
    expect(comp.debugState().layers).toBe(2);
    const group = groupLayers(doc, [top]);
    const grouped = comp.render(doc, vp);
    expect(grouped.recomposited).toBe(true);
    expect(grouped.passes).toBe(2); // pass-through (PS default): bottom + child straight onto the stack
    group.passThrough = false;
    const isolated = comp.render(doc, vp);
    expect(isolated.recomposited).toBe(true);
    expect(isolated.passes).toBe(3); // bottom + child into group buffer + group onto stack
    comp.invalidateAll();
    const inv = comp.render(doc, vp);
    expect(inv.uploads).toBe(2);
    expect(inv.compositedArea).toBe(64 * 48);
  });

  it("reallocates buffers when the document size changes", () => {
    const m = mockGl();
    const { doc } = threeLayerDoc();
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    comp.render(doc, new Viewport());
    const fbBefore = m.count("createFramebuffer");
    doc.width = 32;
    doc.height = 32;
    for (const l of doc.layers) if (l.kind === "raster") l.raster = l.raster.resize(32, 32, "nearest");
    const s = comp.render(doc, new Viewport());
    expect(s.compositedArea).toBe(32 * 32);
    expect(m.count("createFramebuffer")).toBeGreaterThan(fbBefore);
    expect(comp.debugState()).toMatchObject({ docW: 32, docH: 32 });
  });
});

describe("createCompositor fallback", () => {
  it("falls back to Canvas 2D when WebGL2 is unavailable", () => {
    const ctx2d = {};
    const canvas = {
      width: 10,
      height: 10,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      getContext: (kind: string) => (kind === "2d" ? ctx2d : null),
    } as unknown as HTMLCanvasElement;
    const comp = createCompositor(canvas);
    expect(comp.kind).toBe("canvas2d");
    expect(comp).toBeInstanceOf(CanvasCompositor);
    expect(comp.isContextLost()).toBe(false);
    comp.dispose();
    const none = { ...canvas, getContext: () => null } as unknown as HTMLCanvasElement;
    expect(() => createCompositor(none)).toThrow();
  });
});
