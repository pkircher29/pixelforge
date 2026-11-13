# `app/src/lib/engine/commands` — Undoable Engine Commands

Implementations of the `Command` interface (`do(doc)`, `undo(doc)`, `mergeWith?(next)`, `byteSize()`, `affected?()`) executed through `History` (`app/src/lib/engine/history.ts`).

## Key Files

| File | Commands |
|---|---|
| `index.ts` | Barrel re-exporting all command classes and factory functions. |
| `paint.ts` | `PaintCommand` (stores only the dirty-rect before/after sub-raster of a layer or layer mask), `ClearSelectionCommand`, `FillSelectionCommand`. |
| `layers.ts` | `AddLayerCommand`, `RemoveLayerCommand`, `DuplicateLayerCommand`, `ReorderLayerCommand`, `RenameLayerCommand`, `SetLayerPropsCommand`, `MoveLayerCommand`, `MoveLayersCommand`, `GroupLayersCommand`, `UngroupLayersCommand`. |
| `layers2.ts` | Format-2 layer commands: `AddMaskCommand`, `DeleteMaskCommand`, `ApplyMaskCommand`, `SetLayerEffectsCommand`, `SetAdjustmentCommand`, `SetFillLayerCommand`, `SetShapeLayerCommand`, `SetTextLayerCommand`, `RasterizeLayerCommand`, `UpdateLayerPixelsCommand`. |
| `selection.ts` | `SelectionCommand` (undoable selection mask replacement/modification). |
| `channels.ts` | Alpha channel & path commands (`AddChannelCommand`, `RemoveChannelCommand`, `UpdateChannelCommand`, `DuplicateChannelCommand`, `SetPathsCommand`). |
| `merge.ts` | `MergeDownCommand`, `MergeVisibleCommand`, `FlattenCommand`. |
| `canvas.ts` | Whole-document geometry commands: `ResizeCanvasCommand` (Image Size), `ExtendCanvasCommand` (Canvas Size), `CropCanvasCommand`, `RotateCanvasCommand` (90°/180°/flips). |
| `transform.ts` | Single-layer 90° rotation and horizontal/vertical flip commands (`rotateLayer90Command`, `flipLayerCommand`). |
| `structural.ts` | Generic full-document structural command wrapper (`StructuralCommand`) using `captureDocState` / `restoreDocState`. |
