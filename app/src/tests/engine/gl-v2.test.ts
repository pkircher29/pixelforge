import { describe, expect, it } from "vitest";
import {
  BLEND_UNIFORMS,
  BlendMode,
  GlCompositor,
  PRESENT_FRAG,
  PRESENT_UNIFORMS,
  Raster,
  Rect,
  UNPREMUL_PASS,
  Viewport,
  addLayer,
  buildBlendFragment,
  buildUnits,
  createAdjustmentLayer,
  createDocument,
  createFillLayer,
  createRasterLayer,
  createShapeLayer,
  defaultDropShadow,
  enterQuickMask,
  groupLayers,
  rectPath,
  rgba,
  saveSelectionAsChannel,
  solidFill,
} from "../../lib/engine";
import { buildOpFragmentSource } from "../../lib/engine/ops/glsl";

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
    getError: () => 0,
  };
  const target: Record<string, unknown> = {};
  const gl = new Proxy(target, {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "FRAMEBUFFER_COMPLETE") return FRAMEBUFFER_COMPLETE;
      if (prop === "NO_ERROR") return 0;
      if (/^[A-Z0-9_]+$/.test(prop)) {
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
  return { width: 300, height: 200, addEventListener: () => undefined, removeEventListener: () => undefined, getContext: () => null } as unknown as HTMLCanvasElement;
}

describe("shader sources (v2)", () => {
  it("blend fragment declares clip / lerp / adjust uniforms and the present pass the channel-view ones", () => {
    const src = buildBlendFragment("all");
    for (const u of BLEND_UNIFORMS) expect(src).toContain(u);
    expect(src).toContain("u_hasClip");
    expect(src).toContain("u_adjust");
    expect(src).toContain("u_lerp");
    for (const u of PRESENT_UNIFORMS) expect(PRESENT_FRAG).toContain(u);
    expect(PRESENT_FRAG).toContain("u_viewMode");
    expect(PRESENT_FRAG).toContain("u_qmColor");
    expect(buildOpFragmentSource(UNPREMUL_PASS)).toContain("pf_unpremul");
    expect(buildOpFragmentSource(UNPREMUL_PASS)).toContain("void main");
  });
});

describe("buildUnits", () => {
  it("groups clipped layers under their base and never under a group", () => {
    const doc = createDocument({ width: 4, height: 4 });
    const base = doc.layers[0]!;
    const c1 = createRasterLayer(doc, { clipToBelow: true });
    const c2 = createRasterLayer(doc, { clipToBelow: true });
    const free = createRasterLayer(doc);
    addLayer(doc, c1);
    addLayer(doc, c2);
    addLayer(doc, free);
    const units = buildUnits(doc.layers);
    expect(units.map((u) => [u.layer.id, u.chain.map((c) => c.id)])).toEqual([
      [base.id, [c1.id, c2.id]],
      [free.id, []],
    ]);
    const g = groupLayers(doc, [free.id]);
    const clippedAfterGroup = createRasterLayer(doc, { clipToBelow: true });
    doc.layers.push(clippedAfterGroup);
    const u2 = buildUnits(doc.layers.filter((l) => l.parentId === null));
    expect(u2[1]!.layer.id).toBe(g.id);
    expect(u2[1]!.chain).toEqual([]);
    expect(u2[2]!.layer.id).toBe(clippedAfterGroup.id);
  });
});

describe("GlCompositor v2 bookkeeping (mock GL)", () => {
  it("composites a clipping unit with a clip texture and the base's blend as one pass", () => {
    const m = mockGl();
    const doc = createDocument({ width: 16, height: 16, background: "white" });
    const base = createRasterLayer(doc, { name: "base" });
    base.raster.fill(rgba(0, 0, 255), Rect.make(0, 0, 8, 16));
    addLayer(doc, base);
    const clipped = createRasterLayer(doc, { name: "c", raster: Raster.filled(16, 16, rgba(0, 255, 0)), clipToBelow: true });
    addLayer(doc, clipped);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const s = comp.render(doc, new Viewport());
    expect(s.recomposited).toBe(true);
    // bg + (base into unit, clipped into unit, unit onto stack) = 4 blend passes
    expect(s.passes).toBe(4);
    expect(comp.debugState().clips).toBe(1);
    // Releasing the clip drops the clip texture and composites linearly.
    clipped.clipToBelow = false;
    const s2 = comp.render(doc, new Viewport());
    expect(s2.recomposited).toBe(true);
    expect(s2.passes).toBe(3);
    expect(comp.debugState().clips).toBe(0);
    // Painting the base re-uploads its clip alpha.
    clipped.clipToBelow = true;
    comp.render(doc, new Viewport());
    const r8Before = m.count("texSubImage2D");
    comp.markDirty(base.id, Rect.make(0, 0, 2, 2));
    comp.render(doc, new Viewport());
    expect(m.count("texSubImage2D")).toBeGreaterThan(r8Before);
    comp.dispose();
  });

  it("uploads a CPU-styled raster for layers with effects and refreshes it on dirty rects", () => {
    const m = mockGl();
    const doc = createDocument({ width: 16, height: 16, background: "white" });
    const l = createRasterLayer(doc, { name: "fx", raster: new Raster(4, 4), offset: { x: 6, y: 6 } });
    l.raster.fill(rgba(255, 0, 0));
    l.effects = { dropShadow: defaultDropShadow({ distance: 2, size: 1 }) };
    addLayer(doc, l);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    comp.render(doc, new Viewport());
    expect(comp.debugState().styled).toBe(1);
    const uploads = m.count("texSubImage2D") + m.count("texImage2D");
    comp.markDirty(l.id, Rect.make(0, 0, 1, 1));
    const s = comp.render(doc, new Viewport());
    expect(s.recomposited).toBe(true);
    expect(m.count("texSubImage2D") + m.count("texImage2D")).toBeGreaterThan(uploads);
    // The dirty area covers the styled rect (layer rect grown by the effect extent).
    expect(s.compositedArea).toBeGreaterThan(16);
    // Removing the effects goes back to the plain texture.
    l.effects = null;
    comp.render(doc, new Viewport());
    expect(comp.debugState().styled).toBe(0);
    comp.dispose();
  });

  it("runs adjustment layers through op passes (unpremul + op + adjust blend) and re-composites on param change", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const adj = createAdjustmentLayer(doc, { op: "invert" });
    addLayer(doc, adj);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const s = comp.render(doc, new Viewport());
    // bg blend + unpremul pass + invert pass + adjust blend = 4
    expect(s.passes).toBe(4);
    expect(comp.debugState().cpuAdjustments).toBe(0);
    const idle = comp.render(doc, new Viewport());
    expect(idle.recomposited).toBe(false);
    adj.params = { ...adj.params };
    adj.op = "desaturate";
    const changed = comp.render(doc, new Viewport());
    expect(changed.recomposited).toBe(true);
    expect(changed.compositedArea).toBe(64);
    comp.dispose();
  });

  it("falls back to the CPU for ops with down-scaled passes (big blur) and for unknown ops renders nothing", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const blur = createAdjustmentLayer(doc, { op: "gaussian-blur", params: { radius: 40 } });
    addLayer(doc, blur);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    comp.render(doc, new Viewport());
    expect(comp.debugState().cpuAdjustments).toBe(1);
    expect(m.count("readPixels")).toBeGreaterThan(0);
    doc.layers = [doc.layers[0]!, createAdjustmentLayer(doc, { op: "nope" })];
    const s = comp.render(doc, new Viewport());
    expect(s.passes).toBe(1);
    comp.dispose();
  });

  it("pass-through groups draw children straight onto the stack; opacity / mask use the lerp pass", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const a = createRasterLayer(doc, { name: "a" });
    addLayer(doc, a);
    const g = groupLayers(doc, [a.id]);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    expect(comp.render(doc, new Viewport()).passes).toBe(2);
    g.opacity = 0.5;
    expect(comp.render(doc, new Viewport()).passes).toBe(3); // bg + child over copy + lerp
    g.opacity = 1;
    g.mask = Raster.filled(8, 8, rgba(255, 255, 255));
    expect(comp.render(doc, new Viewport()).passes).toBe(3);
    g.passThrough = false;
    expect(comp.render(doc, new Viewport()).passes).toBe(3); // bg + child into group buffer + group blend
    comp.dispose();
  });

  it("fill and shape layers upload their rendered rasters; masks are skipped when disabled", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const fill = createFillLayer(doc, { fill: solidFill(rgba(1, 2, 3)) });
    fill.mask = Raster.filled(8, 8, rgba(0, 0, 0));
    addLayer(doc, fill);
    const shape = createShapeLayer(doc, { path: rectPath(Rect.make(1, 1, 3, 3)), fill: solidFill(rgba(0, 0, 0)) });
    addLayer(doc, shape);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    const s = comp.render(doc, new Viewport());
    expect(s.passes).toBe(3);
    expect(comp.debugState().layers).toBe(3);
    const texBefore = m.count("texImage2D");
    fill.maskEnabled = false;
    const s2 = comp.render(doc, new Viewport());
    expect(s2.recomposited).toBe(true);
    expect(m.count("deleteTexture")).toBeGreaterThan(0);
    fill.fill = solidFill(rgba(9, 9, 9));
    const s3 = comp.render(doc, new Viewport());
    expect(s3.uploads).toBeGreaterThan(0);
    expect(m.count("texImage2D") + m.count("texSubImage2D")).toBeGreaterThan(texBefore);
    comp.dispose();
  });

  it("keeps the below-cache keyed on compositing units (a clipped child caches below its base)", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const mid = createRasterLayer(doc, { name: "mid" });
    addLayer(doc, mid);
    const base = createRasterLayer(doc, { name: "base" });
    addLayer(doc, base);
    const clipped = createRasterLayer(doc, { name: "clipped", clipToBelow: true });
    addLayer(doc, clipped);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    comp.render(doc, new Viewport(), { activeLayerId: clipped.id });
    // Units: [bg], [mid], [base + clipped] → the cache sits below unit 2.
    expect(comp.debugState()).toMatchObject({ belowValid: true, belowIndex: 2 });
    comp.markDirty(clipped.id, Rect.make(0, 0, 2, 2));
    const s = comp.render(doc, new Viewport(), { activeLayerId: clipped.id });
    expect(s.recomposited).toBe(true);
    expect(s.passes).toBe(3); // base into unit, clipped into unit, unit over the cache
    comp.dispose();
  });

  it("uploads channel-view and quick-mask textures only when needed", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    comp.render(doc, new Viewport());
    const base = m.count("texImage2D") + m.count("texSubImage2D");
    const ch = saveSelectionAsChannel(doc);
    doc.alphaChannels.push(ch);
    const s1 = comp.render(doc, new Viewport(), { viewChannel: `alpha:${ch.id}` });
    expect(s1.uploads).toBeGreaterThan(0);
    const s2 = comp.render(doc, new Viewport(), { viewChannel: `alpha:${ch.id}` });
    expect(s2.uploads).toBe(0);
    comp.markDirty(`@channel:${ch.id}`);
    const s3 = comp.render(doc, new Viewport(), { viewChannel: `alpha:${ch.id}` });
    expect(s3.uploads).toBeGreaterThan(0);
    expect(s3.recomposited).toBe(false);
    enterQuickMask(doc);
    const q1 = comp.render(doc, new Viewport());
    expect(q1.uploads).toBeGreaterThan(0);
    const q2 = comp.render(doc, new Viewport());
    expect(q2.uploads).toBe(0);
    comp.markDirty("@quickmask");
    expect(comp.render(doc, new Viewport()).uploads).toBeGreaterThan(0);
    expect(m.count("texImage2D") + m.count("texSubImage2D")).toBeGreaterThan(base);
    comp.dispose();
  });

  it("hides a clipped layer when its base is hidden and treats blend modes per unit", () => {
    const m = mockGl();
    const doc = createDocument({ width: 8, height: 8, background: "white" });
    const base = createRasterLayer(doc, { name: "base", blendMode: BlendMode.Multiply });
    addLayer(doc, base);
    const clipped = createRasterLayer(doc, { name: "c", clipToBelow: true });
    addLayer(doc, clipped);
    const comp = new GlCompositor(fakeCanvas(), { gl: m.gl });
    expect(comp.render(doc, new Viewport()).passes).toBe(4);
    base.visible = false;
    expect(comp.render(doc, new Viewport()).passes).toBe(1);
    comp.dispose();
  });
});
