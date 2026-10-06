/**
 * Programmatic dialogs: mounted on `document.body` so commands can open them without a
 * host component. Each reports itself to `ui.modalDepth` so shell shortcuts / the palette
 * are suspended while open (same contract as the shell's dialog stack).
 */

import { mount, unmount } from "svelte";
import AiProvidersDialog from "$lib/ui/dialogs/AiProvidersDialog.svelte";
import AiShootoutDialog from "$lib/ui/dialogs/AiShootoutDialog.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { providersStore } from "./providers.svelte";
import type { ShootoutSession } from "./shootout";
import type { CustomKind, ProviderId } from "./types";
import { aiUi } from "./ui.svelte";

type Mounted = Record<string, unknown>;

let providers: Mounted | null = null;
let shootout: Mounted | null = null;

export interface ProvidersDialogOptions {
  /** Pre-select this provider in the left list. */
  select?: ProviderId;
  /** Open straight into the "add" form for this kind. */
  addKind?: CustomKind;
}

/** Settings > AI Providers (built-in keys + custom/local providers). */
export function openAiProvidersDialog(opts: ProvidersDialogOptions = {}): void {
  if (providers || typeof document === "undefined") return;
  providers = mount(AiProvidersDialog, {
    target: document.body,
    props: {
      ...(opts.select ? { initialSelect: opts.select } : {}),
      ...(opts.addKind ? { initialAddKind: opts.addKind } : {}),
      onclose: () => {
        if (!providers) return;
        void unmount(providers);
        providers = null;
        ui.modalDepth = Math.max(0, ui.modalDepth - 1);
        void providersStore.refresh();
        void aiUi.refreshProviders();
      },
    },
  });
  ui.modalDepth++;
}

/** Kept for existing call sites (`settings.apiKeys` command, AI panel). */
export const openApiKeysDialog = openAiProvidersDialog;

export function isAiProvidersDialogOpen(): boolean {
  return providers !== null;
}

/** @deprecated use `isAiProvidersDialogOpen`. */
export const isApiKeysDialogOpen = isAiProvidersDialogOpen;

/** The shootout gallery. Without a session it opens in its setup phase (prompt + checklist). */
export function openShootoutDialog(session: ShootoutSession | null = null): void {
  if (shootout || typeof document === "undefined") return;
  shootout = mount(AiShootoutDialog, {
    target: document.body,
    props: {
      session,
      onclose: () => {
        if (!shootout) return;
        void unmount(shootout);
        shootout = null;
        ui.modalDepth = Math.max(0, ui.modalDepth - 1);
      },
    },
  });
  ui.modalDepth++;
}

export function isShootoutDialogOpen(): boolean {
  return shootout !== null;
}
