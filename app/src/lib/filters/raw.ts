/**
 * Raw (non-proxied) engine objects behind the doc store.
 *
 * Historical note: `docStore.docs` used to be deep `$state`, so `docStore.doc` and
 * `docStore.activeLayer` were Svelte proxies and writes through them never reached the
 * raw document that `History` and every `Command` operate on. The store is now
 * `$state.raw` with class-instance entries, so `docStore.doc === entry.history.doc`.
 * These helpers are kept as the explicit "I am about to mutate" entry point for the
 * filters module; they are harmless either way.
 */

import type { Document, Layer, LayerId, RasterLayer } from "$lib/engine";
import type { OpenDoc } from "$lib/stores/doc.svelte";

export function rawDoc(entry: OpenDoc): Document {
  return entry.history.doc;
}

export function rawLayer(entry: OpenDoc, id: LayerId): Layer | null {
  return rawDoc(entry).layers.find((l) => l.id === id) ?? null;
}

export function rawRasterLayer(entry: OpenDoc, id: LayerId): RasterLayer | null {
  const l = rawLayer(entry, id);
  return l && l.kind === "raster" ? l : null;
}
