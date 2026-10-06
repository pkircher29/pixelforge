/**
 * App settings persisted by the Rust side (`settings_get` / `settings_set`, see
 * docs/ipc.md). Outside Tauri (plain `vite` preview) a localStorage shim is used so the
 * shell still works. Unknown keys round-trip untouched.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

export interface Settings {
  theme: string;
  defaultProvider: "open_ai" | "x_ai" | "gemini" | null;
  historyBudgetMb: number;
  recentFiles: string[];
  [extra: string]: unknown;
}

const DEFAULTS: Settings = { theme: "dark", defaultProvider: null, historyBudgetMb: 1024, recentFiles: [] };
const LS_KEY = "pixelforge.settings.v1";

class SettingsStore {
  value = $state<Settings>({ ...DEFAULTS });
  loaded = $state(false);
  private saving: Promise<void> | null = null;

  async load(): Promise<Settings> {
    try {
      if (isTauri()) {
        const s = await invoke<Settings>("settings_get");
        this.value = { ...DEFAULTS, ...s };
      } else {
        const raw = globalThis.localStorage?.getItem(LS_KEY);
        if (raw) this.value = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
          this.value = { ...DEFAULTS, ...stored };
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
