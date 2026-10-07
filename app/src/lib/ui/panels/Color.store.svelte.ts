/** Color panel ≡ state (display mode), remembered per machine. */

export type ColorPanelMode = "gray" | "rgb" | "hsb" | "cube" | "bcube";

export const COLOR_PANEL_MODES: readonly { id: ColorPanelMode; label: string }[] = [
  { id: "gray", label: "Grayscale Slider" },
  { id: "rgb", label: "RGB Sliders" },
  { id: "hsb", label: "HSB Sliders" },
  { id: "cube", label: "Hue Cube" },
  { id: "bcube", label: "Brightness Cube" },
];

const LS_KEY = "pixelforge.colorpanel.v1";

class ColorPanelUi {
  mode = $state<ColorPanelMode>("cube");

  constructor() {
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      if (raw && COLOR_PANEL_MODES.some((m) => m.id === raw)) this.mode = raw as ColorPanelMode;
    } catch {
      /* ignore */
    }
  }

  setMode(m: ColorPanelMode): void {
    this.mode = m;
    try {
      globalThis.localStorage?.setItem(LS_KEY, m);
    } catch {
      /* ignore */
    }
  }
}

export const colorPanelUi = new ColorPanelUi();
