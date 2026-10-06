/**
 * Modal dialog stack. `openDialog(Component, props)` resolves with the value the
 * dialog passes to its `resolve` prop (null = cancelled). `DialogHost.svelte` renders
 * the stack; `ui.modalDepth` suspends shortcuts while anything is open.
 */
import type { Component } from "svelte";
import { ui } from "$lib/stores/ui.svelte";

export type Resolver<R> = (result: R | null) => void;

/** Props every dialog component receives on top of its own. */
export interface DialogProps<R> {
  resolve: Resolver<R>;
}

export interface DialogRequest {
  id: number;
  component: Component<{ resolve: Resolver<unknown> }>;
  props: Record<string, unknown>;
  resolve: Resolver<unknown>;
}

class DialogStore {
  stack = $state<DialogRequest[]>([]);
  private seq = 0;

  open<P extends object, R>(component: Component<P & DialogProps<R>>, props: P): Promise<R | null> {
    return new Promise<R | null>((res) => {
      const id = ++this.seq;
      const req: DialogRequest = {
        id,
        component: component as unknown as Component<{ resolve: Resolver<unknown> }>,
        props: props as Record<string, unknown>,
        resolve: (r) => {
          const i = this.stack.findIndex((d) => d.id === id);
          if (i >= 0) this.stack.splice(i, 1);
          ui.modalDepth = this.stack.length;
          res(r as R | null);
        },
      };
      this.stack.push(req);
      ui.modalDepth = this.stack.length;
    });
  }

  /** Cancel the top-most dialog (Esc). */
  cancelTop(): void {
    const top = this.stack[this.stack.length - 1];
    top?.resolve(null);
  }
}

export const dialogs = new DialogStore();

export function openDialog<P extends object, R>(component: Component<P & DialogProps<R>>, props: P): Promise<R | null> {
  return dialogs.open<P, R>(component, props);
}
