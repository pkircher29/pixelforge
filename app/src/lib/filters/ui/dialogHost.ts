/**
 * Mounts a dialog component into a body-level container and tears it down on close.
 * One filters dialog at a time: opening another closes the current one.
 *
 * The host is separate from the shell's `Dialog` primitive on purpose (non-dimming live
 * preview), but it reports itself to `ui.modalDepth` so the shell's shortcut dispatcher
 * and command palette stay out of the way while a dialog is open.
 */

import { mount, unmount, type Component } from "svelte";
import { ui } from "$lib/stores/ui.svelte";

let current: (() => void) | null = null;

/** Props every dialog must accept. */
export interface DialogProps {
  onclose: () => void;
}

export function openDialog<P extends DialogProps>(component: Component<P>, props: Omit<P, "onclose">): void {
  closeDialog();
  const target = document.createElement("div");
  target.className = "pf-filters-dialog-host";
  document.body.appendChild(target);
  let instance: Record<string, unknown> | null = null;
  const close = (): void => {
    if (!instance) return;
    const inst = instance;
    instance = null;
    void unmount(inst);
    target.remove();
    ui.modalDepth = Math.max(0, ui.modalDepth - 1);
    if (current === close) current = null;
  };
  const full = { ...props, onclose: close } as unknown as P;
  instance = mount(component, { target, props: full });
  ui.modalDepth++;
  current = close;
}

export function closeDialog(): void {
  current?.();
  current = null;
}

export function isDialogOpen(): boolean {
  return current !== null;
}
