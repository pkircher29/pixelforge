/**
 * Programmatic dialogs: mounted on `document.body` so commands can open them without a
 * host component. Reports itself to `ui.modalDepth` so shell shortcuts / the palette are
 * suspended while the dialog is open (same contract as the shell's dialog stack).
 */

import { mount, unmount } from "svelte";
import ApiKeysDialog from "$lib/ui/dialogs/ApiKeysDialog.svelte";
import { ui } from "$lib/stores/ui.svelte";
import { aiUi } from "./ui.svelte";

let keys: Record<string, unknown> | null = null;

export function openApiKeysDialog(): void {
  if (keys || typeof document === "undefined") return;
  keys = mount(ApiKeysDialog, {
    target: document.body,
    props: {
      onclose: () => {
        if (!keys) return;
        void unmount(keys);
        keys = null;
        ui.modalDepth = Math.max(0, ui.modalDepth - 1);
        void aiUi.refreshProviders();
      },
    },
  });
  ui.modalDepth++;
}

export function isApiKeysDialogOpen(): boolean {
  return keys !== null;
}
