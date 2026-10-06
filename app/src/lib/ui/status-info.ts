/** Status-bar info field text (PS ▸ menu: Document Sizes, Profile, Dimensions, Scratch, Efficiency, Timing, Current Tool). Pure. */
import type { StatusInfoKind } from "$lib/stores/ui.svelte";

/** PS style: "5.93M", "812.3K", "1.20G". */
export function formatDocSize(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(2)}G`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

export interface StatusInfoInput {
  w: number;
  h: number;
  dpi: number;
  layerCount: number;
  /** Flattened size (w × h × 4). */
  flat: number;
  /** Bytes of all layer rasters (+ masks). */
  layerBytes: number;
  historyBytes: number;
  budgetBytes: number;
  renderMs: number;
  toolName: string;
}

export function statusInfoText(kind: StatusInfoKind, i: StatusInfoInput): string {
  switch (kind) {
    case "sizes":
      return `Doc: ${formatDocSize(i.flat)}/${formatDocSize(i.layerBytes)}`;
    case "profile":
      return "sRGB IEC61966-2.1 (8bpc)";
    case "dimensions":
      return `${i.w} px × ${i.h} px (${i.dpi} ppi)`;
    case "scratch":
      return `Scr: ${formatDocSize(i.layerBytes + i.historyBytes)}/${formatDocSize(i.budgetBytes)}`;
    case "efficiency":
      return `Efficiency: ${Math.max(1, Math.min(100, Math.round(100 - (i.historyBytes / Math.max(1, i.budgetBytes)) * 100)))}%`;
    case "timing":
      return `${(i.renderMs / 1000).toFixed(2)}s`;
    case "tool":
      return i.toolName;
  }
  return "";
}
