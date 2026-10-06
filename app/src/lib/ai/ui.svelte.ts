/**
 * Panel form state, shared between `AiPanel.svelte` and the registered commands
 * (`ai.generate` / `ai.edit` focus the panel and force a mode; the history panel's
 * "Edit prompt & re-run" refills the form).
 */

import type { Raster } from "$lib/engine";
import { listProviders, hasTauri } from "./client";
import { toFriendlyError } from "./errors";
import type { AiRunRequest } from "./run";
import { canGenerate, isReady, type AiMode, type ImageSize, type ProviderId, type ProviderInfo } from "./types";

export interface RefImage {
  id: string;
  name: string;
  raster: Raster;
  /** Data URL preview. */
  thumb: string;
}

/** `"auto"` or a `WxH` key into `sizeOptions`. */
export type SizeKey = string;

export interface SizeOption {
  key: SizeKey;
  label: string;
  size?: ImageSize;
}

let refCounter = 0;

class AiUiState {
  providers = $state<ProviderInfo[]>([]);
  providersLoaded = $state(false);
  providersError = $state<string | null>(null);

  providerId = $state<ProviderId>("open_ai");
  /** Empty = provider default for the mode. */
  model = $state("");
  prompt = $state("");
  negativePrompt = $state("");
  showNegative = $state(false);
  n = $state(1);
  quality = $state("");
  transparent = $state(false);
  sizeKey = $state<SizeKey>("auto");
  refs = $state<RefImage[]>([]);
  timeoutSecs = $state(180);
  feather = $state(2);
  newDocument = $state(false);
  forcedMode = $state<AiMode | undefined>(undefined);
  showAdvanced = $state(false);

  /** Bumped by commands that want the prompt focused. */
  focusRequest = $state(0);
  /** Last request that was submitted (for `ai.rerunLast`). */
  lastRun = $state<AiRunRequest | null>(null);

  get provider(): ProviderInfo | null {
    return this.providers.find((p) => p.id === this.providerId) ?? null;
  }

  async refreshProviders(): Promise<void> {
    if (!hasTauri()) {
      this.providersLoaded = true;
      return;
    }
    try {
      this.providers = await listProviders();
      this.providersError = null;
      this.ensureSelectable();
    } catch (e) {
      this.providersError = toFriendlyError(e).title;
    } finally {
      this.providersLoaded = true;
    }
  }

  /** Inject a provider list (demo / tests). */
  setProviders(list: ProviderInfo[]): void {
    this.providers = list;
    this.providersLoaded = true;
    this.ensureSelectable();
  }

  /**
   * Keep `providerId` on a provider that can make images: a ready generator first, then
   * any generator, then whatever exists (prompt-assist-only entries are never picked).
   */
  private ensureSelectable(): void {
    const current = this.providers.find((p) => p.id === this.providerId);
    if (current && canGenerate(current)) return;
    const gens = this.providers.filter(canGenerate);
    const pick = gens.find(isReady) ?? gens[0] ?? this.providers[0];
    if (pick) this.providerId = pick.id;
  }

  addRef(ref: Omit<RefImage, "id">): void {
    const max = Math.max(0, (this.provider?.capabilities.maxRefs ?? 1) - 1);
    if (this.refs.length >= max) return;
    this.refs.push({ ...ref, id: `ref_${++refCounter}` });
  }

  removeRef(id: string): void {
    this.refs = this.refs.filter((r) => r.id !== id);
  }

  focusPrompt(forced?: AiMode): void {
    this.forcedMode = forced;
    this.focusRequest++;
  }
}

export const aiUi = new AiUiState();
