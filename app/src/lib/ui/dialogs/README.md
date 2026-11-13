# `app/src/lib/ui/dialogs` — Modal Dialogs & Overlays

Modal dialog container (`Dialog.svelte`, `DialogHost.svelte`, `dialogs.svelte.ts`) and all application dialogs.

## Key Files

| File | Dialog / Purpose |
|---|---|
| `Dialog.svelte`, `DialogHost.svelte`, `dialogs.svelte.ts` | Accessible modal window shell, promise-based dialog host (`openDialog`, `dialogs`), focus management, and keyboard (`Enter` / `Escape`) handling. |
| `NewDocDialog.svelte`, `NewLayerDialog.svelte`, `ExportDialog.svelte`, `ConfirmDialog.svelte`, `NumberDialog.svelte`, `AboutDialog.svelte`, `PreferencesDialog.svelte` | Core document creation, layer creation, PNG/JPEG/WebP export with live byte-size preview, confirmation prompt, numeric input, About box, and Preferences dialog. |
| `ImageSizeDialog.svelte`, `CanvasSizeDialog.svelte`, `RotateCanvasDialog.svelte`, `TransformOverlay.svelte` | Image resampling, 9-anchor canvas resizing, arbitrary canvas rotation (`Image > Image Rotation > Arbitrary…`), and interactive on-canvas Free Transform handles (`Ctrl+T`). |
| `AdjustDialog.svelte` | Shared live-preview modal for all parametric adjustments and filters (`Levels`, `Hue/Saturation`, `Gaussian Blur`, `Unsharp Mask`, etc.) with optional 256-bin histogram. |
| `LayerStyleDialog.svelte`, `LayerStyleAngleDial.svelte`, `LayerStyleGlobalLightDialog.svelte`, `layer-style-model.ts`, `layer-style-presets.ts` | Photoshop-layout Layer Style editor (`Drop Shadow`, `Inner Shadow`, `Outer Glow`, `Inner Glow`, `Bevel & Emboss`, `Stroke`, `Color Overlay`, `Gradient Overlay`) and style presets. |
| `LayerPropsDialog.svelte`, `LayerPropsLockDialog.svelte` | Layer name/color-label properties and lock configuration dialogs. |
| `ColorPickerDialog.svelte`, `color-picker.ts`, `GradientEditorDialog.svelte` | Photoshop HSB/RGB/Hex Color Picker and multi-stop Gradient Editor. |
| `FillDialog.svelte`, `FillLayerDialog.svelte`, `FillPathDialog.svelte`, `StrokeDialog.svelte`, `StrokePathDialog.svelte` | Edit > Fill, Layer > New Fill Layer, Edit > Stroke, and Paths Fill/Stroke dialogs. |
| `AiProvidersDialog.svelte`, `AiShootoutDialog.svelte` | BYOK API key & subscription OAuth configuration + custom/local provider manager (`Edit > AI Providers…`), and multi-model streaming shootout gallery (`Ctrl+Shift+Alt+M`). |
