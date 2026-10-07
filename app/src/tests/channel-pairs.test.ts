import { expect, it } from "vitest";
import { Raster, channelViewRaster, createDocument, rgba } from "../lib/engine";
import { buildChannelRows, toggleChannelEye } from "../lib/ui/panels/Channels.model";

it("renders each color pair and no channels without leaking hidden components", () => {
  const doc = createDocument({ width: 1, height: 1 });
  const source = Raster.filled(1, 1, rgba(100, 150, 200, 128));
  expect(channelViewRaster(doc, source, "rg")!.getPixel(0, 0)).toEqual(rgba(50, 75, 0));
  expect(channelViewRaster(doc, source, "rb")!.getPixel(0, 0)).toEqual(rgba(50, 0, 100));
  expect(channelViewRaster(doc, source, "gb")!.getPixel(0, 0)).toEqual(rgba(0, 75, 100));
  expect(channelViewRaster(doc, source, "none")!.getPixel(0, 0)).toEqual(rgba(0, 0, 0));
});

it("hides the last color without restoring RGB and reopens only the requested color", () => {
  const doc = createDocument({ width: 1, height: 1 });
  let rows = buildChannelRows(doc, null, "b", ["r", "g"]);
  const hidden = toggleChannelEye(rows, rows[3]!, "b", ["r", "g"]);
  expect(hidden.view).toBe("none");
  rows = buildChannelRows(doc, null, hidden.view, hidden.hidden);
  expect(toggleChannelEye(rows, rows[1]!, hidden.view, hidden.hidden).view).toBe("r");
});
