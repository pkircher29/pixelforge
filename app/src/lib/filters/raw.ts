/**
 * Raw (non-proxied) engine objects behind the doc store.
 *
 * `docStore.docs` is `$state<OpenDoc[]>`, so `docStore.doc`, `.layers[i]` and
 * `docStore.activeLayer` are Svelte 5 deep proxies of the plain `Document` / `Layer`
 * objects. Reads fall through to the raw objects, but a *write* through a proxy (e.g.
 * `layer.raster = r`) is stored in the proxy's own signal and never reaches the raw
 * document that `History` and every `Command` operate on — the two views silently
 * diverge. Class instances (Raster, Selection, History, Viewport) are not proxied.
 *
 * Rule for this module: read ids through the store, then mutate only raw objects
 * obtained here. `History.doc` is the raw document the store was opened with.
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
