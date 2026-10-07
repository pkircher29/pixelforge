/**
 * `openColorPicker(initial)` — the Photoshop Color Picker as a promise, for every colour
 * swatch control in the app (toolbar fg/bg, Color panel, Layer Style colour wells,
 * Fill / Stroke dialogs…). Resolves `null` on Cancel.
 */
import type { RGBA } from "$lib/engine";
import { openDialog } from "./dialogs.svelte";
import ColorPickerDialog from "./ColorPickerDialog.svelte";

export interface ColorPickerOptions {
  /** Dialog title, e.g. "Color Picker (Foreground Color)". */
  title?: string;
}

export function openColorPicker(initial: RGBA, opts: ColorPickerOptions = {}): Promise<RGBA | null> {
  return openDialog<{ initial: RGBA; title?: string }, RGBA>(ColorPickerDialog, opts.title ? { initial, title: opts.title } : { initial });
}
