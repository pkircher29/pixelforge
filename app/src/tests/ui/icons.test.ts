import { describe, expect, it } from "vitest";
import { ICONS, ICON_NAMES, hasIcon, resolveIcon } from "../../lib/ui/icons/icons";
import { SPEC_TOOL_IDS, TOOLS, toolGlyph, getTool } from "../../lib/tools";

const REQUIRED = [
  // toolbar extras
  "swap-colors", "default-colors", "quick-mask", "quick-mask-on", "screen-mode", "edit-toolbar",
  // options bar
  "preset-picker", "sel-new", "sel-add", "sel-subtract", "sel-intersect", "align-left", "align-hcenter", "align-right", "align-top", "align-vcenter", "align-bottom", "distribute-h", "distribute-v", "brush-size",
  // layers panel
  "eye", "eye-off", "lock-transparent", "lock-pixels", "lock-position", "lock-artboard", "lock-all", "chain", "fx", "mask", "adjustment", "folder", "new-layer", "trash",
  "kind-pixel", "kind-adjust", "kind-type", "kind-shape", "kind-smart", "search", "clip-arrow",
  // panel tabs
  "panel-menu", "collapse-left", "collapse-right", "close",
  // misc
  "chevron-down", "chevron-right", "check", "warning", "info", "plus", "minus", "snapshot", "history-source", "zoom-in", "zoom-out", "hand", "play",
];

describe("icon set", () => {
  it("has a glyph for every tool id in PLAN-v2 §2 (including placeholders)", () => {
    const missing = SPEC_TOOL_IDS.filter((id) => !hasIcon(toolGlyph(id, getTool(id))));
    expect(missing).toEqual([]);
    for (const t of TOOLS) expect(hasIcon(toolGlyph(t.id, t)), t.id).toBe(true);
  });

  it("has every toolbar / options / layers / panel / misc glyph the shell uses", () => {
    expect(REQUIRED.filter((n) => !hasIcon(n))).toEqual([]);
  });

  it("ships at least 110 glyphs, all with path data inside the 16×16 grid", () => {
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(110);
    for (const [name, def] of Object.entries(ICONS)) {
      expect(def.length, name).toBeGreaterThan(0);
      for (const p of def) {
        expect(p.d.trim().length, name).toBeGreaterThan(3);
        expect(/^[Mm]/.test(p.d.trim()), name).toBe(true);
        // Absolute coordinates must stay on the 16×16 grid (lenient: look at M/L/H/V absolute numbers).
        for (const m of p.d.matchAll(/[MLHV]\s*(-?\d+(?:\.\d+)?)(?:[ ,]+(-?\d+(?:\.\d+)?))?/g)) {
          for (const v of [m[1], m[2]]) if (v !== undefined) expect(Number(v), `${name}: ${m[0]}`).toBeLessThanOrEqual(16.5);
        }
      }
    }
  });

  it("resolves aliases (legacy tool ids) to canonical glyphs", () => {
    expect(resolveIcon("text")).toBe(ICONS["type-h"]);
    expect(resolveIcon("visibility")).toBe(ICONS.eye);
    expect(resolveIcon("nope")).toBeUndefined();
  });
});
