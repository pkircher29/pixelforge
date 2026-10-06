import { describe, expect, it } from "vitest";
import { BlendMode, History, SetLayerEffectsCommand, type LayerEffects } from "../../lib/engine";
import { STYLE_PAGES, toggleEffect, setEffectField, setGlobalLight, syncGlobalLight, scaleEffects, applyPreset, enabledCount, effectDefault, makeDefault, resetDefault, normAngle, renderStylePreview, emptyEffects } from "../../lib/ui/dialogs/layer-style-model";
import { STYLE_PRESETS, presetById } from "../../lib/ui/dialogs/layer-style-presets";
import { sampleDoc, byName } from "./fixtures";

describe("Layer Style model", () => {
  it("lists the PS pages in order and toggles effects on from defaults / off in place", () => {
    expect(STYLE_PAGES).toEqual(["bevelEmboss", "stroke", "innerShadow", "innerGlow", "colorOverlay", "gradientOverlay", "outerGlow", "dropShadow"]);
    const e = toggleEffect(null, "dropShadow", true);
    expect(e.dropShadow?.enabled).toBe(true);
    expect(e.dropShadow?.distance).toBe(5);
    expect(e.globalLightAngle).toBe(120);
    const off = toggleEffect(e, "dropShadow", false);
    expect(off.dropShadow?.enabled).toBe(false);
    expect(off.dropShadow?.distance).toBe(5); // kept, like PS
    expect(e.dropShadow?.enabled).toBe(true); // input untouched
    expect(enabledCount(off)).toBe(0);
  });

  it("setEffectField patches one effect without touching the others", () => {
    let e = toggleEffect(null, "stroke", true);
    e = toggleEffect(e, "dropShadow", true);
    const n = setEffectField(e, "stroke", { size: 9, position: "inside" });
    expect(n.stroke?.size).toBe(9);
    expect(n.stroke?.position).toBe("inside");
    expect(n.dropShadow?.enabled).toBe(true);
    expect(e.stroke?.size).toBe(3);
  });

  it("global light propagates to every effect that uses it, and only those", () => {
    let e = toggleEffect(null, "dropShadow", true);
    e = toggleEffect(e, "innerShadow", true);
    e = toggleEffect(e, "bevelEmboss", true);
    e = setEffectField(e, "innerShadow", { useGlobalLight: false, angle: 45 });
    const g = setGlobalLight(e, -30, 60);
    expect(g.globalLightAngle).toBe(-30);
    expect(g.dropShadow?.angle).toBe(-30);
    expect(g.bevelEmboss?.angle).toBe(-30);
    expect(g.bevelEmboss?.altitude).toBe(60);
    expect(g.innerShadow?.angle).toBe(45);
    expect(normAngle(200)).toBe(-160);
    expect(normAngle(-180)).toBe(180);
    expect(syncGlobalLight(emptyEffects()).globalLightAngle).toBe(120);
  });

  it("scaleEffects scales distances and sizes, never below 1 px strokes", () => {
    let e = toggleEffect(null, "dropShadow", true);
    e = toggleEffect(e, "stroke", true);
    const s = scaleEffects(e, 200)!;
    expect(s.dropShadow?.distance).toBe(10);
    expect(s.dropShadow?.size).toBe(10);
    expect(s.stroke?.size).toBe(6);
    expect(scaleEffects(e, 1)!.stroke?.size).toBe(1);
    expect(scaleEffects(null, 50)).toBeNull();
  });

  it("presets: ~12 shipped, applyPreset replaces the effect set but keeps the global light", () => {
    expect(STYLE_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(STYLE_PRESETS.map((p) => p.id)).size).toBe(STYLE_PRESETS.length);
    let e = toggleEffect(null, "colorOverlay", true);
    e = setGlobalLight(e, 45);
    const chrome = presetById("chrome")!;
    const a = applyPreset(e, chrome);
    expect(a.colorOverlay).toBeUndefined();
    expect(a.bevelEmboss?.enabled).toBe(true);
    expect(a.gradientOverlay?.enabled).toBe(true);
    expect(a.globalLightAngle).toBe(45);
    expect(a.dropShadow?.angle).toBe(45); // synced to the kept global light
    expect(enabledCount(applyPreset(a, presetById("none")!))).toBe(0);
  });

  it("Make Default / Reset to Default change what toggling an effect starts from", () => {
    makeDefault("outerGlow", { ...effectDefault("outerGlow"), size: 42 });
    expect(toggleEffect(null, "outerGlow", true).outerGlow?.size).toBe(42);
    resetDefault("outerGlow");
    expect(toggleEffect(null, "outerGlow", true).outerGlow?.size).toBe(5);
  });

  it("renders a preview raster of the requested size (effects extend the Aa glyph)", () => {
    const plain = renderStylePreview(null, 32);
    expect(plain.width).toBe(32);
    const styled = renderStylePreview(toggleEffect(null, "outerGlow", true), 32);
    expect(styled.width).toBe(32);
    expect(styled.height).toBe(32);
    let diff = 0;
    for (let i = 3; i < styled.data.length; i += 4) if (styled.data[i] !== plain.data[i]) diff++;
    expect(diff).toBeGreaterThan(0);
  });

  it("SetLayerEffectsCommand: one OK = one undo step; Cancel semantics restore the original object", () => {
    const doc = sampleDoc();
    const h = new History(doc);
    const title = byName(doc, "Title");
    const original = title.effects;
    const next: LayerEffects = setEffectField(title.effects, "dropShadow", { blendMode: BlendMode.Normal, distance: 12 });
    h.push(new SetLayerEffectsCommand(title.id, next, "Layer Style"), { noMerge: true });
    expect(title.effects?.dropShadow?.distance).toBe(12);
    expect(h.entries.length).toBe(1);
    h.undo();
    expect(title.effects).toBe(original);
  });
});
