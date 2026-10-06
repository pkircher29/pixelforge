/**
 * Mounts a dialog component into a body-level container and tears it down on close.
 * One filters dialog at a time: opening another closes the current one.
 *
 * TODO(integration): replace with the shell's dialog/overlay host when available.
 */

import { mount, unmount, type Component } from "svelte";

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
    if (current === close) current = null;
  };
  const full = { ...props, onclose: close } as unknown as P;
  instance = mount(component, { target, props: full });
  current = close;
}

export function closeDialog(): void {
  current?.();
  current = null;
}

export function isDialogOpen(): boolean {
  return current !== null;
}
