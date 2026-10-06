import { beforeEach, describe, expect, it } from "vitest";
import { TOOLS, TOOL_GROUPS, SPEC_TOOL_IDS, toolbarSlots, toolLabel, toolGlyph, groupOfTool, getTool } from "../../lib/tools";
import { toolStore } from "../../lib/stores/tool.svelte";

beforeEach(() => {
  localStorage.clear();
});

describe("toolbar groups (PLAN-v2 §2)", () => {
  it("renders the 20 Photoshop slots in order, placeholders included", () => {
    const slots = toolbarSlots();
    expect(slots.map((s) => s.id)).toEqual([
      "move", "marquee", "lasso", "quickselect", "crop", "eyedropper", "healing", "brush", "stamp", "history",
      "eraser", "gradient", "blur", "dodge", "pen", "type", "pathselect", "shape", "hand", "zoom",
    ]);
    expect(SPEC_TOOL_IDS.length).toBeGreaterThanOrEqual(60);
  });

  it("every registered tool lands in exactly one slot and keeps its group", () => {
    const slots = toolbarSlots();
    for (const t of TOOLS) {
      const owners = slots.filter((s) => s.tools.includes(t));
      expect(owners, t.id).toHaveLength(1);
      expect(owners[0]!.id).toBe(groupOfTool(t.id));
    }
  });

  it("placeholders are listed but have no live tool", () => {
    const healing = toolbarSlots().find((s) => s.id === "healing")!;
    expect(healing.members.map((m) => m.id)).toEqual(["healing-spot", "healing-brush", "patch", "content-aware-move", "red-eye"]);
    expect(healing.tools).toHaveLength(0);
    expect(healing.members.every((m) => m.tool === null)).toBe(true);
  });

  it("fly-out order follows PS: Gradient before Paint Bucket, rect marquee before ellipse", () => {
    const slots = toolbarSlots();
    expect(slots.find((s) => s.id === "gradient")!.tools.map((t) => t.id)).toEqual(["gradient", "bucket"]);
    expect(slots.find((s) => s.id === "marquee")!.tools.map((t) => t.id)).toEqual(["marquee-rect", "marquee-ellipse"]);
    expect(slots.find((s) => s.id === "lasso")!.members.map((m) => m.id)).toEqual(["lasso", "lasso-polygon", "lasso-magnetic"]);
  });

  it("uses PS wording for labels and glyph aliases", () => {
    expect(toolLabel(getTool("move")!)).toBe("Move Tool");
    expect(toolLabel(getTool("text")!)).toBe("Horizontal Type Tool");
    expect(toolLabel({ id: "x", name: "Weird" })).toBe("Weird Tool");
    expect(toolGlyph("text", getTool("text"))).toBe("type-h");
    expect(toolGlyph("brush", getTool("brush"))).toBe("brush");
  });

  it("tools outside the spec still get a slot of their own", () => {
    const extra = { ...getTool("move")!, id: "weird", name: "Weird", shortcut: "Shift+k", group: undefined } as unknown as (typeof TOOLS)[number];
    const slots = toolbarSlots([...TOOLS, extra]);
    const last = slots[slots.length - 1]!;
    expect(last.id).toBe("weird");
    expect(last.key).toBe("K");
    expect(slots).toHaveLength(TOOL_GROUPS.length + 1);
  });
});

describe("tool store group memory", () => {
  it("remembers the last tool per group and uses it as the group's face", () => {
    toolStore.setActive("marquee-ellipse");
    expect(toolStore.lastInGroup.marquee).toBe("marquee-ellipse");
    toolStore.setActive("brush");
    expect(toolStore.faceOf("marquee", ["marquee-rect", "marquee-ellipse"], "marquee-rect")).toBe("marquee-ellipse");
    toolStore.setActive("marquee-rect");
    expect(toolStore.faceOf("marquee", ["marquee-rect", "marquee-ellipse"], "marquee-ellipse")).toBe("marquee-rect");
  });

  it("falls back to the first member when nothing was used yet, and persists", () => {
    expect(toolStore.faceOf("healing", ["healing-spot", "healing-brush"], "healing-spot")).toBe("healing-spot");
    toolStore.setActive("gradient");
    const raw = JSON.parse(localStorage.getItem("pixelforge.tools.v1")!) as { lastInGroup: Record<string, string> };
    expect(raw.lastInGroup.gradient).toBe("gradient");
  });

  it("ignores stale ids that left the group", () => {
    toolStore.lastInGroup.marquee = "gone";
    toolStore.setActive("brush");
    expect(toolStore.faceOf("marquee", ["marquee-rect", "marquee-ellipse"], "marquee-rect")).toBe("marquee-rect");
  });

  it("toggles quick mask and cycles screen modes F-style", () => {
    toolStore.quickMask = false;
    toolStore.toggleQuickMask();
    expect(toolStore.quickMask).toBe(true);
    toolStore.screenMode = "standard";
    toolStore.cycleScreenMode();
    expect(toolStore.screenMode).toBe("fullscreen-menu");
    toolStore.cycleScreenMode();
    expect(toolStore.screenMode).toBe("fullscreen");
    toolStore.cycleScreenMode();
    expect(toolStore.screenMode).toBe("standard");
  });
});
