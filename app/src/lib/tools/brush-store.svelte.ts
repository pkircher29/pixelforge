/**
 * Reactive brush state shared by the Brush Settings / Brushes panels, the options bar
 * brush picker and every brush-engine tool: the live `settings` (Brush Settings panel),
 * the preset library (built-ins + user presets, persisted in app settings) and the
 * selected preset id.
 */
import { settings as appSettings } from "$lib/stores/settings.svelte";
import { DEFAULT_BRUSH_SETTINGS, normalizeBrushSettings, type BrushSettings } from "./brush-engine";
import { BUILTIN_PRESETS, type BrushPreset } from "./brush-presets";

const LS_KEY = "pixelforge.brush.v1";

interface Persisted {
  settings: BrushSettings;
  userPresets: BrushPreset[];
  presetId: string | null;
}

function loadLocal(): Partial<Persisted> {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Persisted>) : {};
  } catch {
    return {};
  }
}

class BrushStore {
  /** Live Brush Settings (what the next stroke uses). */
  settings = $state<BrushSettings>({ ...DEFAULT_BRUSH_SETTINGS });
  userPresets = $state<BrushPreset[]>([]);
  presetId = $state<string | null>("hard-round-20");
  /** Bumped when settings change so canvases / previews can redraw. */
  version = $state(0);

  constructor() {
    const p = loadLocal();
    if (p.settings) this.settings = normalizeBrushSettings(p.settings);
    if (Array.isArray(p.userPresets)) this.userPresets = p.userPresets.map((x) => ({ ...x, settings: normalizeBrushSettings(x.settings) }));
    if (p.presetId !== undefined) this.presetId = p.presetId;
  }

  get presets(): BrushPreset[] {
    return [...BUILTIN_PRESETS, ...this.userPresets];
  }

  get current(): BrushPreset | null {
    return this.presets.find((p) => p.id === this.presetId) ?? null;
  }

  persist(): void {
    const data: Persisted = { settings: $state.snapshot(this.settings), userPresets: $state.snapshot(this.userPresets), presetId: this.presetId };
    try {
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    // Mirror user presets into the app settings file so they survive machines.
    void appSettings.set({ brushPresets: data.userPresets }).catch(() => {});
  }

  /** Patch the live settings (Brush Settings panel / shortcuts). */
  update(patch: Partial<BrushSettings>): void {
    this.settings = normalizeBrushSettings({ ...this.settings, ...patch });
    this.version++;
    this.persist();
  }

  applyPreset(id: string): void {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return;
    this.presetId = id;
    this.settings = normalizeBrushSettings({ ...p.settings });
    this.version++;
    this.persist();
  }

  /** Save the live settings as a new user preset. */
  saveAsPreset(name: string, group = "User Brushes"): BrushPreset {
    const id = `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`;
    const p: BrushPreset = { id, name, group, settings: normalizeBrushSettings({ ...this.settings }) };
    this.userPresets = [...this.userPresets, p];
    this.presetId = id;
    this.persist();
    return p;
  }

  renamePreset(id: string, name: string): void {
    this.userPresets = this.userPresets.map((p) => (p.id === id ? { ...p, name } : p));
    this.persist();
  }

  deletePreset(id: string): boolean {
    if (!this.userPresets.some((p) => p.id === id)) return false;
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    if (this.presetId === id) this.presetId = null;
    this.persist();
    return true;
  }

  /** `[` / `]` — PS size steps. */
  stepSize(dir: 1 | -1): number {
    const size = this.settings.size;
    const step = size < 10 ? 1 : size < 50 ? 5 : size < 200 ? 10 : 25;
    const next = Math.max(1, Math.min(2500, size + dir * step));
    this.update({ size: next });
    return next;
  }

  /** `{` / `}` — hardness in 25 % steps. */
  stepHardness(dir: 1 | -1): number {
    const next = Math.max(0, Math.min(100, this.settings.hardness + dir * 25));
    this.update({ hardness: next });
    return next;
  }
}

export const brushStore = new BrushStore();
