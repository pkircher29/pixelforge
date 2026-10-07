/** Info panel ≡ ▸ Panel Options: the two readout modes and the status-tip line. */
import type { InfoColorMode } from "./info-model";

const LS_KEY = "pixelforge.info.v1";

interface Persisted {
  first: InfoColorMode;
  second: InfoColorMode;
  showTips: boolean;
  showDocSize: boolean;
}

class InfoUi {
  first = $state<InfoColorMode>("rgb");
  second = $state<InfoColorMode>("cmyk");
  showTips = $state(true);
  showDocSize = $state(true);

  constructor() {
    try {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<Persisted>;
        if (p.first) this.first = p.first;
        if (p.second) this.second = p.second;
        if (typeof p.showTips === "boolean") this.showTips = p.showTips;
        if (typeof p.showDocSize === "boolean") this.showDocSize = p.showDocSize;
      }
    } catch {
      /* ignore */
    }
  }

  persist(): void {
    try {
      const data: Persisted = { first: this.first, second: this.second, showTips: this.showTips, showDocSize: this.showDocSize };
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }
}

export const infoUi = new InfoUi();
