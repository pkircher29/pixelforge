/**
 * App settings persisted by the Rust side (`settings_get` / `settings_set`, see
 * docs/ipc.md). Outside Tauri (plain `vite` preview) a localStorage shim is used so the
 * shell still works. Unknown keys round-trip untouched.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export type ThemeId = "darkest" | "dark" | "medium" | "light";
export type CheckerSize = "none" | "small" | "medium" | "large";
export type CheckerColors = "light" | "medium" | "dark" | "red" | "orange" | "green" | "blue" | "purple";
export type CursorStyle = "standard" | "precise" | "brush-size";
export type RulerUnit = "px" | "in" | "cm" | "mm" | "%";

export interface Settings {
  theme: ThemeId;
  defaultProvider: "open_ai" | "x_ai" | "gemini" | null;
  historyBudgetMb: number;
  /** PS "History States" (max undo steps). */
  historyStates: number;
  recentFiles: string[];
  /** Preferences ▸ Transparency & Gamut. */
  checkerSize: CheckerSize;
  checkerColors: CheckerColors;
  /** Preferences ▸ Cursors. */
  paintingCursor: CursorStyle;
  otherCursor: "standard" | "precise";
  /** Preferences ▸ Units & Rulers. */
  rulerUnit: RulerUnit;
  /** Preferences ▸ Interface. */
  toolbarDoubleColumn: boolean;
  showToolTips: boolean;
  /** Preferences ▸ Tools. */
  zoomWithWheel: boolean;
  showTransformValues: boolean;
  [extra: string]: unknown;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "dark",
  defaultProvider: null,
  historyBudgetMb: 1024,
  historyStates: 50,
  recentFiles: [],
  checkerSize: "medium",
  checkerColors: "light",
  paintingCursor: "brush-size",
  otherCursor: "standard",
  rulerUnit: "px",
  toolbarDoubleColumn: false,
  showToolTips: true,
  zoomWithWheel: true,
  showTransformValues: true,
};

/** Checkerboard cell size in CSS px per PS size name. */
export const CHECKER_PX: Record<CheckerSize, number> = { none: 0, small: 4, medium: 8, large: 16 };

/** PS "Grid Colors" presets: [light, dark] as 0..1 RGB. */
export const CHECKER_RGB: Record<CheckerColors, [[number, number, number], [number, number, number]]> = {
  light: [
    [1, 1, 1],
    [0.8, 0.8, 0.8],
  ],
  medium: [
    [0.8, 0.8, 0.8],
    [0.6, 0.6, 0.6],
  ],
  dark: [
    [0.6, 0.6, 0.6],
    [0.4, 0.4, 0.4],
  ],
  red: [
    [1, 0.85, 0.85],
    [1, 0.6, 0.6],
  ],
  orange: [
    [1, 0.9, 0.75],
    [1, 0.75, 0.45],
  ],
  green: [
    [0.85, 1, 0.85],
    [0.6, 0.9, 0.6],
  ],
  blue: [
    [0.85, 0.9, 1],
    [0.6, 0.7, 1],
  ],
  purple: [
    [0.93, 0.85, 1],
    [0.8, 0.6, 1],
  ],
};

const LS_KEY = "pixelforge.settings.v1";

class SettingsStore {
  value = $state<Settings>({ ...DEFAULT_SETTINGS });
  loaded = $state(false);
  private saving: Promise<void> | null = null;

  async load(): Promise<Settings> {
    try {
      if (isTauri()) {
        const s = await invoke<Settings>("settings_get");
        this.value = { ...DEFAULT_SETTINGS, ...s };
      } else {
        const raw = globalThis.localStorage?.getItem(LS_KEY);
        if (raw) this.value = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
      }
    } catch (e) {
      console.warn("[pixelforge] settings_get failed", e);
    }
    this.loaded = true;
    return this.value;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.value[key];
  }

  /** Patch and persist. Returns once stored. */
  async set(patch: Partial<Settings>): Promise<void> {
    this.value = { ...this.value, ...patch };
    const snapshot = $state.snapshot(this.value) as Settings;
    const run = async (): Promise<void> => {
      try {
        if (isTauri()) {
          const stored = await invoke<Settings>("settings_set", { settings: snapshot });
          this.value = { ...DEFAULT_SETTINGS, ...stored };
        } else {
          globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(snapshot));
        }
      } catch (e) {
        console.warn("[pixelforge] settings_set failed", e);
      }
    };
    // Serialise writes so a fast slider can't interleave.
    this.saving = (this.saving ?? Promise.resolve()).then(run);
    await this.saving;
  }
}

export const settings = new SettingsStore();
