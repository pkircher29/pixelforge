import { describe, expect, it } from "vitest";
import { Viewport } from "../../lib/engine";
import { clipBox, panByDrag, panToPoint, parseZoomPercent, showsWholeDoc, sliderToZoom, thumbLayout, viewBox, visibleDocRect, zoomToSlider } from "../../lib/ui/panels/navigator-math";

describe("navigator geometry", () => {
  it("fits the thumbnail (≤ 256 px) centred in the panel", () => {
    const l = thumbLayout(2000, 1000, 300, 200, 256);
    expect(l.w).toBe(256);
    expect(l.h).toBe(128);
    expect(l.x).toBe(22);
    expect(l.y).toBe(36);
    expect(l.scale).toBeCloseTo(0.128);
  });

  it("maps the viewport's visible doc rect to the view box", () => {
    const vp = { zoom: 2, panX: -400, panY: -200 };
    expect(visibleDocRect(vp, 800, 600)).toEqual({ x: 200, y: 100, w: 400, h: 300 });
    const l = thumbLayout(1000, 1000, 100, 100, 256);
    const b = viewBox(vp, 800, 600, l);
    expect(b).toEqual({ x: 20, y: 10, w: 40, h: 30 });
  });

  it("clips the box to the thumbnail and detects a fully visible document", () => {
    const l = thumbLayout(1000, 1000, 100, 100);
    expect(clipBox({ x: -10, y: 90, w: 50, h: 50 }, l)).toEqual({ x: 0, y: 90, w: 40, h: 10 });
    expect(showsWholeDoc({ zoom: 0.5, panX: 50, panY: 50 }, 800, 800, 1000, 1000)).toBe(true);
    expect(showsWholeDoc({ zoom: 2, panX: 0, panY: 0 }, 800, 800, 1000, 1000)).toBe(false);
  });

  it("dragging the box pans the viewport so the box follows the pointer", () => {
    const l = thumbLayout(1000, 1000, 100, 100);
    const vp = new Viewport({ zoom: 2, panX: -400, panY: -200 });
    const before = viewBox(vp, 800, 600, l);
    const p = panByDrag(vp, 5, -3, l);
    vp.panX = p.panX;
    vp.panY = p.panY;
    const after = viewBox(vp, 800, 600, l);
    expect(after.x - before.x).toBeCloseTo(5);
    expect(after.y - before.y).toBeCloseTo(-3);
  });

  it("clicking the thumbnail centres the view on that document point", () => {
    const l = thumbLayout(1000, 1000, 100, 100);
    const vp = new Viewport({ zoom: 3, panX: 0, panY: 0 });
    const p = panToPoint(vp, 50, 25, l, 800, 600);
    vp.panX = p.panX;
    vp.panY = p.panY;
    const c = vp.screenToDoc({ x: 400, y: 300 });
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(250);
  });

  it("zoom slider is log-scaled and the zoom field parses percentages", () => {
    expect(zoomToSlider(0.01, 0.01, 32)).toBe(0);
    expect(zoomToSlider(32, 0.01, 32)).toBe(1);
    expect(sliderToZoom(zoomToSlider(1.5, 0.01, 32), 0.01, 32)).toBeCloseTo(1.5);
    expect(parseZoomPercent("66.7%")).toBeCloseTo(0.667);
    expect(parseZoomPercent(" 200 ")).toBe(2);
    expect(parseZoomPercent("abc")).toBeNull();
    expect(parseZoomPercent("-5")).toBeNull();
  });
});
