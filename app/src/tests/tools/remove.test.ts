import { expect, it, vi } from "vitest";
import { createDocument, History, Selection, Rect, Viewport } from "../../lib/engine";
import { RemoveTool } from "../../lib/tools/remove";
import { aiUi } from "../../lib/ai/ui.svelte";
import type { ToolContext, ToolEvent } from "../../lib/tools/types";

function setup() {
  const doc = createDocument({ width: 100, height: 60 });
  const history = new History(doc);
  const options: Record<string, string | number> = { size: 10, mode: "add" };
  const ctx = {
    doc, history, entry: { id: "remove-test" }, viewport: new Viewport(),
    opt: (key: string) => options[key], setOpt: (key: string, value: string | number) => { options[key] = value; },
    exec: (cmd: Parameters<History["push"]>[0]) => history.push(cmd),
    touch: vi.fn(), invalidateOverlay: vi.fn(), notify: vi.fn(),
  } as unknown as ToolContext;
  const tool = new RemoveTool();
  const event = (x: number, y: number, altKey = false) => ({ x, y, button: 0, altKey } as ToolEvent);
  const stroke = (x: number, y: number, toX = x, alt = false) => {
    tool.onPointerDown(event(x, y, alt), ctx);
    tool.onPointerMove(event(toX, y, alt), ctx);
    tool.onPointerUp(event(toX, y, alt), ctx);
  };
  return { doc, history, tool, ctx, event, stroke };
}

it("paints a continuous removal mask, adds/subtracts, and continues correctly after undo", () => {
  const { doc, history, stroke } = setup();
  stroke(10, 20, 80);
  for (let x = 10; x <= 80; x++) expect(doc.selection.mask[20 * 100 + x]).toBe(255);
  expect(doc.selection.mask[40 * 100 + 40]).toBe(0);
  const first = doc.selection;
  stroke(40, 20, 40, true);
  expect(doc.selection.mask[20 * 100 + 40]).toBe(0);
  expect(doc.selection.mask[20 * 100 + 20]).toBe(255);
  history.undo(); expect(doc.selection).toBe(first);
  aiUi.prompt = "Keep my custom removal prompt";
  stroke(40, 40);
  expect(doc.selection.mask[20 * 100 + 20]).toBe(255);
  expect(doc.selection.mask[40 * 100 + 40]).toBe(255);
  expect(aiUi.prompt).toBe("Keep my custom removal prompt");
  history.undo(); expect(doc.selection).toBe(first);
  history.redo(); expect(doc.selection.mask[40 * 100 + 40]).toBe(255);
});

it("starts separately from an unrelated selection and restores it when a stroke is cancelled", () => {
  const { doc, tool, ctx, event, stroke, history } = setup();
  const previous = Selection.fromRect(100, 60, Rect.make(70, 40, 20, 10));
  doc.selection = previous;
  tool.onPointerDown(event(20, 20), ctx);
  expect(doc.selection.mask[45 * 100 + 80]).toBe(0);
  tool.cancel(ctx); expect(doc.selection).toBe(previous);
  stroke(20, 20);
  expect(doc.selection.mask[45 * 100 + 80]).toBe(0);
  expect(aiUi.prompt).toMatch(/Remove the object/);
  history.undo(); expect(doc.selection).toBe(previous);
  tool.onPointerDown(event(20, 20), ctx);
  tool.onDeactivate(ctx); expect(doc.selection).toBe(previous);
});
