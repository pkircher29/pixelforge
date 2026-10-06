/**
 * Programmatic dialogs: mounted on `document.body` so commands can open them without a
 * host component. TODO(shell): route through the shared dialog store once it exists.
 */

import { mount, unmount } from "svelte";
import ApiKeysDialog from "$lib/ui/dialogs/ApiKeysDialog.svelte";
import { aiUi } from "./ui.svelte";

let keys: Record<string, unknown> | null = null;

export function openApiKeysDialog(): void {
  if (keys || typeof document === "undefined") return;
  keys = mount(ApiKeysDialog, {
    target: document.body,
    props: {
      onclose: () => {
        if (keys) void unmount(keys);
        keys = null;
        void aiUi.refreshProviders();
      },
    },
  });
}

export function isApiKeysDialogOpen(): boolean {
  return keys !== null;
}
