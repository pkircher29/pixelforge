import { expect, it } from "vitest";
import { Rect, Viewport } from "../../lib/engine";
import { contextualPosition } from "../../lib/ui/contextual-position";

it("positions below a selection and moves above when there is insufficient room", () => {
  const viewport = new Viewport();
  expect(contextualPosition(Rect.make(100, 100, 200, 50), viewport, 800, 600, 300, 100)).toEqual({ x: 50, y: 158 });
  expect(contextualPosition(Rect.make(600, 500, 200, 90), viewport, 800, 600, 300, 100)).toEqual({ x: 492, y: 392 });
});

it("uses all rotated corners, clamps to the view and hides wholly offscreen selections", () => {
  const viewport = new Viewport({ rotation: Math.PI / 2, panX: 300, panY: 100, zoom: 2 });
  expect(contextualPosition(Rect.make(0, 0, 100, 50), viewport, 800, 600, 300, 100)).toEqual({ x: 100, y: 308 });
  expect(contextualPosition(Rect.make(-1000, -1000, 10, 10), new Viewport(), 800, 600, 300, 100)).toBeNull();
  expect(contextualPosition(Rect.make(0, 0, 800, 600), new Viewport(), 800, 600, 300, 100)).toEqual({ x: 250, y: 8 });
  expect(contextualPosition(Rect.make(0, 0, 10, 10), new Viewport(), 800, 90, 300, 100)).toBeNull();
});
