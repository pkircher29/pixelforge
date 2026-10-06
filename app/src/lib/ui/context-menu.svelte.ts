/** Context menu store; `ContextMenu.svelte` renders `contextMenu.state`. */

export interface ContextMenuItem {
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  separator?: boolean;
  run?: () => void | Promise<void>;
}

class ContextMenuStore {
  state = $state<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  open(x: number, y: number, items: ContextMenuItem[]): void {
    this.state = { x, y, items };
  }

  close(): void {
    this.state = null;
  }
}

export const contextMenu = new ContextMenuStore();
