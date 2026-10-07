/** Navigator ≡ ▸ Panel Options: view box color (PS default light red). */

export const VIEW_BOX_COLORS: readonly { id: string; label: string; css: string }[] = [
  { id: "red", label: "Light Red", css: "#ff4d4d" },
  { id: "blue", label: "Light Blue", css: "#4d8dff" },
  { id: "green", label: "Green", css: "#3fcf6a" },
  { id: "yellow", label: "Yellow", css: "#ffd84d" },
  { id: "white", label: "White", css: "#ffffff" },
  { id: "black", label: "Black", css: "#000000" },
];

const LS_KEY = "pixelforge.navigator.v1";

class NavigatorUi {
  boxColor = $state("red");

  constructor() {
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      if (raw && VIEW_BOX_COLORS.some((c) => c.id === raw)) this.boxColor = raw;
    } catch {
      /* ignore */
    }
  }

  get boxCss(): string {
    return VIEW_BOX_COLORS.find((c) => c.id === this.boxColor)?.css ?? "#ff4d4d";
  }

  setBoxColor(id: string): void {
    this.boxColor = id;
    try {
      globalThis.localStorage?.setItem(LS_KEY, id);
    } catch {
      /* ignore */
    }
  }
}

export const navigatorUi = new NavigatorUi();
