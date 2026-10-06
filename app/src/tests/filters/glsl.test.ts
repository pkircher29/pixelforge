import { describe, expect, it } from "vitest";
import { buildFragmentSource } from "../../lib/filters/gpu";
import { ADJUSTMENT_OPS, ALL_OPS, FILTER_OPS, commandIdFor, opById } from "../../lib/filters/ops";
import { gaussianPasses } from "../../lib/filters/ops/blur";
import { defaultParams } from "../../lib/filters/types";

function balanced(src: string): boolean {
  let depth = 0;
  let paren = 0;
  for (const ch of src) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "(") paren++;
    if (ch === ")") paren--;
    if (depth < 0 || paren < 0) return false;
  }
  return depth === 0 && paren === 0;
}

describe("op definitions", () => {
  it("every op has a unique id, a label, a menu, glsl and cpu", () => {
    const ids = new Set<string>();
    for (const op of ALL_OPS) {
      expect(op.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(op.id)).toBe(false);
      ids.add(op.id);
      expect(op.label.length).toBeGreaterThan(0);
      expect(["Image/Adjustments", "Filter/Blur", "Filter/Sharpen", "Filter/Noise", "Filter/Pixelate"]).toContain(op.menu);
      expect(typeof op.glsl).toBe("function");
      expect(typeof op.cpu).toBe("function");
      expect(opById(op.id)).toBe(op);
    }
    expect(ALL_OPS.length).toBe(ADJUSTMENT_OPS.length + FILTER_OPS.length);
    expect(ALL_OPS.length).toBeGreaterThanOrEqual(15);
  });

  it("params have sane ranges and defaults inside them", () => {
    for (const op of ALL_OPS) {
      for (const p of op.params) {
        if (p.kind === "number") {
          expect(p.min).toBeLessThan(p.max);
          expect(p.default).toBeGreaterThanOrEqual(p.min);
          expect(p.default).toBeLessThanOrEqual(p.max);
          expect(p.step).toBeGreaterThan(0);
        } else if (p.kind === "select") {
          expect(p.options.map((o) => o.value)).toContain(p.default);
        }
      }
      const d = defaultParams(op);
      for (const p of op.params) expect(d[p.id]).toEqual(p.default);
      if (op.groupSelector) expect(d[op.groupSelector.id]).toBe(op.groupSelector.default);
    }
  });

  it("GLSL passes are syntactically plausible: balanced braces, pf_op defined, uniforms declared, main present", () => {
    for (const op of ALL_OPS) {
      const passes = op.glsl(defaultParams(op));
      expect(passes.length).toBeGreaterThan(0);
      for (const pass of passes) {
        expect(balanced(pass.source)).toBe(true);
        expect(pass.source).toMatch(/vec4\s+pf_op\s*\(\s*ivec2\s+\w+\s*\)/);
        for (const name of Object.keys(pass.uniforms ?? {})) {
          expect(pass.source.includes(name)).toBe(true);
          expect(pass.source).toMatch(new RegExp(`uniform\\s+\\w+\\s+${name}\\b`));
        }
        const full = buildFragmentSource(pass.source);
        expect(full.startsWith("#version 300 es")).toBe(true);
        expect(full).toContain("void main()");
        expect(balanced(full)).toBe(true);
        // No GLSL 1.00-isms.
        expect(full).not.toMatch(/gl_FragColor|texture2D\(/);
      }
    }
  });

  it("uniform values are typed as the runner expects", () => {
    for (const op of ALL_OPS) {
      for (const pass of op.glsl(defaultParams(op))) {
        for (const [name, v] of Object.entries(pass.uniforms ?? {})) {
          const decl = pass.source.match(new RegExp(`uniform\\s+(\\w+)\\s+${name}\\b`))![1];
          if (decl === "int" || decl === "sampler2D") expect(v).toBeInstanceOf(Int32Array);
          else if (decl === "float") expect(typeof v).toBe("number");
          else if (decl === "bool") expect(typeof v).toBe("boolean");
          else if (decl === "vec2") expect((v as number[]).length).toBe(2);
          else if (decl === "vec3") expect((v as number[]).length).toBe(3);
          else if (decl === "vec4") expect((v as number[]).length).toBe(4);
        }
      }
    }
  });

  it("big-sigma Gaussian uses the downsample path with scaled passes", () => {
    expect(gaussianPasses(2).length).toBe(2);
    const big = gaussianPasses(100);
    expect(big.length).toBe(4);
    expect(big[0]!.scale).toBeCloseTo(1 / 7, 9);
    expect(big[3]!.scale).toBeUndefined();
  });

  it("command ids and shortcuts follow the contract", () => {
    const byId = Object.fromEntries(ALL_OPS.map((op) => [op.id, op]));
    expect(commandIdFor(byId["levels"]!)).toBe("image.adjust.levels");
    expect(commandIdFor(byId["gaussian-blur"]!)).toBe("filter.gaussian-blur");
    expect(byId["levels"]!.shortcut).toBe("CmdOrCtrl+L");
    expect(byId["hue-saturation"]!.shortcut).toBe("CmdOrCtrl+U");
    expect(byId["invert"]!.shortcut).toBe("CmdOrCtrl+I");
    expect(byId["desaturate"]!.shortcut).toBe("CmdOrCtrl+Shift+U");
    expect(byId["brightness-contrast"]!.shortcut).toBeUndefined();
    expect(byId["gaussian-blur"]!.shortcut).toBeUndefined();
    expect(byId["invert"]!.instant).toBe(true);
    expect(byId["desaturate"]!.instant).toBe(true);
  });
});
