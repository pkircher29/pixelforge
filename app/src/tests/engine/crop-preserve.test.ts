import { expect, it } from "vitest";
import { History, Raster, Rect, Selection, CropCanvasCommand, ResizeCanvasCommand, createDocument, createRasterLayer, createGroupLayer, createShapeLayer, createFillLayer, addLayer, rgba, compositeToRaster, rectPath, solidFill, rerasterizeShape } from "../../lib/engine";
import { projectFrameParts, documentFromProjectFrame, type ProjectHeader } from "../../lib/io/convert";
import { encodeFrame, decodeFrame } from "../../lib/io/frame";
import { cloneLayer } from "../../lib/engine/document";

it.each([true, false])("preserves off-canvas pixels and masks through crop, history and project files (pass-through %s)", (passThrough) => {
  const doc = createDocument({ width: 12, height: 10, noBackgroundLayer: true });
  const group = createGroupLayer(doc, { passThrough, mask: Raster.filled(12, 10, rgba(255,255,255)) });
  group.mask!.fill(rgba(0,0,0), Rect.make(0,0,5,4));
  addLayer(doc, group);
  const raster = new Raster(12,10);
  for(let y=0;y<10;y++)for(let x=0;x<12;x++)raster.setPixel(x,y,rgba(x*20,y*20,80));
  const layer = createRasterLayer(doc, { raster, parentId: group.id, mask: Raster.filled(12,10,rgba(255,255,255)) });
  layer.mask!.setPixel(7,5,rgba(0,0,0));addLayer(doc,layer);
  const original = compositeToRaster(doc);
  const selection = Selection.fromRect(12,10,Rect.make(4,3,3,2));doc.selection=selection;
  const history = new History(doc);
  history.push(new CropCanvasCommand(Rect.make(3,2,6,6),false));
  expect(layer.raster).toBe(raster);
  expect(layer.offset).toEqual({x:-3,y:-2});
  expect(group.offset).toEqual({x:-3,y:-2});
  expect(compositeToRaster(doc).data).toEqual(original.crop(Rect.make(3,2,6,6)).data);
  const parts=projectFrameParts(doc,"crop.pfproj","test",null);
  const restored=documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(parts.header as unknown as Record<string,unknown>,parts.blobs)));
  expect(compositeToRaster(restored).data).toEqual(compositeToRaster(doc).data);
  new ResizeCanvasCommand(12,10).do(restored);
  expect(compositeToRaster(restored).data).toEqual(original.data);
  history.undo();expect(layer.offset).toEqual({x:0,y:0});expect(doc.selection).toBe(selection);
  history.redo();expect(layer.raster).toBe(raster);expect(doc.width).toBe(6);
});

it("preserves editable shape and procedural fill render bounds after crop and reload", () => {
  const doc=createDocument({width:20,height:16,noBackgroundLayer:true});
  const fill=createFillLayer(doc,{fill:solidFill(rgba(80,90,100))});addLayer(doc,fill);
  const shape=createShapeLayer(doc,{path:rectPath(Rect.make(1,1,17,13)),fill:solidFill(rgba(200,30,40))});addLayer(doc,shape);
  const original=compositeToRaster(doc);
  const history=new History(doc);history.push(new CropCanvasCommand(Rect.make(4,3,12,10),false));
  rerasterizeShape(doc,shape);
  expect(shape.raster.width).toBe(20);expect(fill.renderSize).toEqual({width:20,height:16});
  const duplicate = cloneLayer(shape);
  expect(duplicate.renderSize).toEqual(shape.renderSize);
  expect(duplicate.renderSize).not.toBe(shape.renderSize);
  if (duplicate.kind !== "shape") throw new Error("Expected shape duplicate");
  rerasterizeShape(doc, duplicate);
  expect(duplicate.raster.data).toEqual(shape.raster.data);
  expect(compositeToRaster(doc).data).toEqual(original.crop(Rect.make(4,3,12,10)).data);
  const parts=projectFrameParts(doc,"crop.pfproj","test",null);
  const restored=documentFromProjectFrame(decodeFrame<ProjectHeader>(encodeFrame(parts.header as unknown as Record<string,unknown>,parts.blobs)));
  expect(compositeToRaster(restored).data).toEqual(compositeToRaster(doc).data);
  new ResizeCanvasCommand(20,16).do(restored);expect(compositeToRaster(restored).data).toEqual(original.data);
  history.undo();expect(shape.renderSize).toBeUndefined();history.redo();expect(shape.renderSize?.width).toBe(20);
});

it("still discards cropped pixel buffers when Delete Cropped Pixels is enabled", () => {
  const doc=createDocument({width:12,height:10,background:rgba(20,40,60)});
  new CropCanvasCommand(Rect.make(3,2,6,6),true).do(doc);
  expect(doc.layers[0]!.raster!.width).toBe(6);
  new ResizeCanvasCommand(12,10).do(doc);
  expect(doc.layers[0]!.raster!.getPixel(0,0).a).toBe(0);
});
