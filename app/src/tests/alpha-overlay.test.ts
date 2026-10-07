import { expect, it } from "vitest";
import { Selection, channelFromSelection, createDocument } from "../lib/engine";
import { AlphaOverlayCache } from "../lib/engine/channels";
import { buildChannelRows, clickChannel, toggleChannelEye } from "../lib/ui/panels/Channels.model";

it("caches tint separately and responds to options, edits and channel deletion", () => {
  const doc = createDocument({ width: 2, height: 1 });
  const ch = channelFromSelection(doc, Selection.none(2, 1));
  doc.alphaChannels.push(ch);
  const cache = new AlphaOverlayCache();
  const first = cache.get(doc, [ch.id])!;
  expect(first.getPixel(0, 0)).toEqual({ r: 255, g: 0, b: 0, a: 128 });
  expect(cache.get(doc, [ch.id])).toBe(first);
  ch.opacity = 1;
  expect(cache.get(doc, [ch.id])!.getPixel(0, 0).a).toBe(255);
  ch.mask.fill({ r: 255, g: 255, b: 255, a: 255 });
  cache.invalidate();
  expect(cache.get(doc, [ch.id])!.getPixel(0, 0).a).toBe(0);
  doc.alphaChannels = [];
  expect(cache.get(doc, [ch.id])).toBeNull();
});

it("selects alpha alone as grayscale but turns its eye into an RGB overlay", () => {
  const doc = createDocument({ width: 2, height: 1 });
  const ch = channelFromSelection(doc, Selection.none(2, 1)); doc.alphaChannels.push(ch);
  const rows = buildChannelRows(doc, null, "rgb", []);
  expect(rows[4]!.visible).toBe(false);
  const overlay = toggleChannelEye(rows, rows[4]!, "rgb", []);
  expect(overlay).toEqual({ view: "rgb", hidden: [], overlays: [ch.id] });
  expect(clickChannel(rows[4]!, rows)).toEqual({ view: `alpha:${ch.id}`, hidden: ["r", "g", "b"] });
  const alphaRows = buildChannelRows(doc, null, `alpha:${ch.id}`, ["r", "g", "b"]);
  expect(toggleChannelEye(alphaRows, alphaRows[0]!, `alpha:${ch.id}`, ["r", "g", "b"])).toEqual(overlay);
});
