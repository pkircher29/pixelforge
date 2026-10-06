/**
 * Index math for drag-reordering layers (pure). The panel displays layers top-to-bottom
 * (reversed), `ReorderLayerCommand` wants the index *after removal* of the moved block.
 */

/**
 * @param from   engine index of the dragged layer (before removal)
 * @param target engine index of the row it was dropped on
 * @param above  true when dropped on the upper half of the row (i.e. should end up
 *               *above* it in the panel = higher engine index)
 * @param blockLen length of the dragged block (1 for plain layers; group + children)
 */
export function reorderTarget(from: number, target: number, above: boolean, blockLen = 1): number {
  if (target === from) return from;
  // Desired final index of the block start in the array *without* the block.
  let final = above ? target + 1 : target;
  if (from < target) final -= blockLen;
  return Math.max(0, final);
}
