import { Raster } from "./raster";
import { Rect } from "./rect";
import type { BlitOptions, IRaster, RGBA } from "./types";

export const RASTER_TILE_SIZE = 256;
const TILE_BYTES = RASTER_TILE_SIZE * RASTER_TILE_SIZE * 4;
interface Tile { bytes: Uint8ClampedArray<ArrayBuffer>; populated: number }
// Once shared, a tile is immutable. A writer detaches only that tile.
const shared = new WeakSet<Tile>();

/**
 * Sparse RGBA storage for the raster migration. Pixel, fill, crop and clone operations
 * stay tiled. The legacy writable `data` accessor permanently materializes this instance
 * into a contiguous buffer; inherited resampling operations still use that compatibility path.
 * Document factories and compositor uploads must migrate before the memory gate closes.
 */
export class TiledRaster extends Raster {
  private tiles = new Map<number, Tile>();
  private readonly columns: number;
  private readonly pixelBytes = new Uint8ClampedArray(4);

  constructor(width: number, height: number) {
    super(width, height, undefined, true);
    this.columns = Math.ceil(width / RASTER_TILE_SIZE);
  }

  static override filled(width: number, height: number, color: RGBA): TiledRaster {
    const result = new TiledRaster(width, height);
    result.fill(color);
    return result;
  }

  static override fromBytes(width: number, height: number, bytes: ArrayBufferView): TiledRaster {
    const result = new TiledRaster(width, height);
    result.blit(Raster.fromBytes(width, height, bytes), 0, 0, undefined, { mode: "replace" });
    return result;
  }

  static override fromImageData(image: ImageData): TiledRaster {
    return TiledRaster.fromBytes(image.width, image.height, image.data);
  }

  get storageMode(): "tiled" | "contiguous" { return this.denseData ? "contiguous" : "tiled"; }
  get allocatedTileCount(): number { return this.tiles.size; }

  override get data(): Uint8ClampedArray<ArrayBuffer> {
    if (!this.denseData) {
      const data = super.data;
      for (const [key, tile] of this.tiles) {
        const x = (key % this.columns) * RASTER_TILE_SIZE;
        const y = Math.floor(key / this.columns) * RASTER_TILE_SIZE;
        const rowBytes = Math.min(RASTER_TILE_SIZE, this.width - x) * 4;
        const rows = Math.min(RASTER_TILE_SIZE, this.height - y);
        for (let row = 0; row < rows; row++) {
          const start = row * RASTER_TILE_SIZE * 4;
          data.set(tile.bytes.subarray(start, start + rowBytes), ((y + row) * this.width + x) * 4);
        }
      }
      this.tiles.clear();
    }
    return this.denseData!;
  }

  override byteLength(): number { return this.denseData?.byteLength ?? this.tiles.size * TILE_BYTES; }

  override readPixels(rect: Rect): Uint8ClampedArray<ArrayBuffer> {
    if (this.denseData) return super.readPixels(rect);
    const result = new Uint8ClampedArray(Math.max(0, rect.w) * Math.max(0, rect.h) * 4);
    const area = Rect.intersect(rect, this.bounds());
    if (Rect.isEmpty(area)) return result;
    for (let ty = Math.floor(area.y / RASTER_TILE_SIZE); ty <= Math.floor((area.y + area.h - 1) / RASTER_TILE_SIZE); ty++) {
      for (let tx = Math.floor(area.x / RASTER_TILE_SIZE); tx <= Math.floor((area.x + area.w - 1) / RASTER_TILE_SIZE); tx++) {
        const tile = this.tiles.get(ty * this.columns + tx);
        if (!tile) continue;
        const part = Rect.intersect(area, Rect.make(tx * RASTER_TILE_SIZE, ty * RASTER_TILE_SIZE, RASTER_TILE_SIZE, RASTER_TILE_SIZE));
        for (let y = part.y; y < part.y + part.h; y++) {
          const start = ((y - ty * RASTER_TILE_SIZE) * RASTER_TILE_SIZE + part.x - tx * RASTER_TILE_SIZE) * 4;
          result.set(tile.bytes.subarray(start, start + part.w * 4), ((y - rect.y) * rect.w + part.x - rect.x) * 4);
        }
      }
    }
    return result;
  }

  override blit(src: IRaster, dx: number, dy: number, srcRect?: Rect, opts?: BlitOptions): void {
    if (this.denseData) { super.blit(src === this ? this.clone() : src, dx, dy, srcRect, opts); return; }
    const sr = srcRect ? Rect.intersect(srcRect, src.bounds()) : src.bounds();
    const destination = Rect.intersect(Rect.make(dx, dy, sr.w, sr.h), this.bounds());
    if (Rect.isEmpty(sr) || Rect.isEmpty(destination)) return;
    const opacity = Math.min(1, Math.max(0, opts?.opacity ?? 1));
    if (opacity <= 0) return;
    const replaceAll = opts?.mode === "replace" && opacity >= 1;
    // Reading from a clone gives overlapping self-copies snapshot semantics.
    const source = src === this ? this.clone() : src;
    for (let ty = Math.floor(destination.y / RASTER_TILE_SIZE); ty <= Math.floor((destination.y + destination.h - 1) / RASTER_TILE_SIZE); ty++) {
      for (let tx = Math.floor(destination.x / RASTER_TILE_SIZE); tx <= Math.floor((destination.x + destination.w - 1) / RASTER_TILE_SIZE); tx++) {
        const key = ty * this.columns + tx;
        const part = Rect.intersect(destination, Rect.make(tx * RASTER_TILE_SIZE, ty * RASTER_TILE_SIZE, RASTER_TILE_SIZE, RASTER_TILE_SIZE));
        const pixels = source.readPixels(Rect.make(sr.x + part.x - dx, sr.y + part.y - dy, part.w, part.h));
        if (!replaceAll) {
          let visible = false;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
          if (!visible) continue;
        }
        if (!this.tiles.has(key) && !pixels.some(v => v !== 0)) continue;
        const tile = this.writable(key);
        const view = new Raster(RASTER_TILE_SIZE, RASTER_TILE_SIZE, tile.bytes);
        view.blit(new Raster(part.w, part.h, pixels), part.x - tx * RASTER_TILE_SIZE, part.y - ty * RASTER_TILE_SIZE, undefined, opts);
        let populated = 0;
        for (let i = 0; i < tile.bytes.length; i += 4) if (tile.bytes[i] || tile.bytes[i + 1] || tile.bytes[i + 2] || tile.bytes[i + 3]) populated++;
        tile.populated = populated;
        if (!populated) this.tiles.delete(key);
      }
    }
  }

  /** Unique retained pixel buffers across snapshots; excludes JS objects and GPU memory. */
  static retainedPixelBytes(rasters: Iterable<TiledRaster>): number {
    const buffers = new Set<ArrayBuffer>();
    for (const raster of rasters) {
      if (raster.denseData) buffers.add(raster.denseData.buffer);
      else for (const tile of raster.tiles.values()) buffers.add(tile.bytes.buffer);
    }
    let bytes = 0;
    for (const buffer of buffers) bytes += buffer.byteLength;
    return bytes;
  }

  override clone(): TiledRaster {
    const result = new TiledRaster(this.width, this.height);
    if (this.denseData) result.denseData = this.denseData.slice();
    else for (const [key, tile] of this.tiles) { shared.add(tile); result.tiles.set(key, tile); }
    return result;
  }

  /** A detached tile copy for upload/readback. An absent tile means transparent black. */
  readTile(column: number, row: number): Uint8ClampedArray<ArrayBuffer> | null {
    if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= this.columns || row * RASTER_TILE_SIZE >= this.height) return null;
    if (this.denseData) {
      const tile = new Uint8ClampedArray(TILE_BYTES);
      const x = column * RASTER_TILE_SIZE, y = row * RASTER_TILE_SIZE;
      const rowBytes = Math.min(RASTER_TILE_SIZE, this.width - x) * 4;
      for (let r = 0; r < Math.min(RASTER_TILE_SIZE, this.height - y); r++) {
        const start = ((y + r) * this.width + x) * 4;
        tile.set(this.denseData.subarray(start, start + rowBytes), r * RASTER_TILE_SIZE * 4);
      }
      return tile.some(v => v !== 0) ? tile : null;
    }
    return this.tiles.get(row * this.columns + column)?.bytes.slice() ?? null;
  }

  private writable(key: number): Tile {
    let tile = this.tiles.get(key);
    if (!tile) { tile = { bytes: new Uint8ClampedArray(TILE_BYTES), populated: 0 }; this.tiles.set(key, tile); }
    else if (shared.has(tile)) { tile = { bytes: tile.bytes.slice(), populated: tile.populated }; this.tiles.set(key, tile); }
    return tile;
  }

  override getPixel(x: number, y: number, out?: RGBA): RGBA {
    if (this.denseData) return super.getPixel(x, y, out);
    const result = out ?? { r: 0, g: 0, b: 0, a: 0 };
    result.r = result.g = result.b = result.a = 0;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) return result;
    const tile = this.tiles.get(Math.floor(y / RASTER_TILE_SIZE) * this.columns + Math.floor(x / RASTER_TILE_SIZE));
    if (!tile) return result;
    const i = ((y % RASTER_TILE_SIZE) * RASTER_TILE_SIZE + x % RASTER_TILE_SIZE) * 4;
    result.r = tile.bytes[i]!; result.g = tile.bytes[i + 1]!; result.b = tile.bytes[i + 2]!; result.a = tile.bytes[i + 3]!;
    return result;
  }

  private write(tile: Tile, i: number, color: ArrayLike<number>): void {
    const d = tile.bytes;
    const before = !!(d[i] || d[i + 1] || d[i + 2] || d[i + 3]);
    d[i] = color[0]!; d[i + 1] = color[1]!; d[i + 2] = color[2]!; d[i + 3] = color[3]!;
    const after = !!(d[i] || d[i + 1] || d[i + 2] || d[i + 3]);
    tile.populated += Number(after) - Number(before);
  }

  override setPixel(x: number, y: number, color: RGBA): void {
    if (this.denseData) { super.setPixel(x, y, color); return; }
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const key = Math.floor(y / RASTER_TILE_SIZE) * this.columns + Math.floor(x / RASTER_TILE_SIZE);
    const bytes = this.pixelBytes;
    bytes[0] = color.r; bytes[1] = color.g; bytes[2] = color.b; bytes[3] = color.a;
    if (!this.tiles.has(key) && !bytes.some(v => v !== 0)) return;
    const tile = this.writable(key);
    this.write(tile, ((y % RASTER_TILE_SIZE) * RASTER_TILE_SIZE + x % RASTER_TILE_SIZE) * 4, bytes);
    if (!tile.populated) this.tiles.delete(key);
  }

  override fill(color: RGBA, rect?: Rect): void {
    if (this.denseData) { super.fill(color, rect); return; }
    const area = Rect.intersect(rect ?? this.bounds(), this.bounds());
    if (Rect.isEmpty(area)) return;
    const bytes = new Uint8ClampedArray([color.r, color.g, color.b, color.a]);
    const zero = !bytes.some(v => v !== 0);
    if (zero && Rect.equals(area, this.bounds())) { this.tiles.clear(); return; }
    for (let ty = Math.floor(area.y / RASTER_TILE_SIZE); ty <= Math.floor((area.y + area.h - 1) / RASTER_TILE_SIZE); ty++) {
      for (let tx = Math.floor(area.x / RASTER_TILE_SIZE); tx <= Math.floor((area.x + area.w - 1) / RASTER_TILE_SIZE); tx++) {
        const key = ty * this.columns + tx;
        if (zero && !this.tiles.has(key)) continue;
        const tile = this.writable(key);
        const part = Rect.intersect(area, Rect.make(tx * RASTER_TILE_SIZE, ty * RASTER_TILE_SIZE, RASTER_TILE_SIZE, RASTER_TILE_SIZE));
        for (let y = part.y; y < part.y + part.h; y++) for (let x = part.x; x < part.x + part.w; x++) {
          this.write(tile, ((y % RASTER_TILE_SIZE) * RASTER_TILE_SIZE + x % RASTER_TILE_SIZE) * 4, bytes);
        }
        if (!tile.populated) this.tiles.delete(key);
      }
    }
  }

  override crop(rect: Rect): TiledRaster {
    if (Rect.equals(rect, this.bounds())) return this.clone();
    const result = new TiledRaster(Math.max(0, rect.w), Math.max(0, rect.h));
    if (this.denseData) {
      result.blit(this, -rect.x, -rect.y, undefined, { mode: "replace" });
      return result;
    }
    const color = { r: 0, g: 0, b: 0, a: 0 };
    for (const [key, tile] of this.tiles) {
      const tileX = (key % this.columns) * RASTER_TILE_SIZE, tileY = Math.floor(key / this.columns) * RASTER_TILE_SIZE;
      const part = Rect.intersect(Rect.intersect(rect, this.bounds()), Rect.make(tileX, tileY, RASTER_TILE_SIZE, RASTER_TILE_SIZE));
      for (let y = part.y; y < part.y + part.h; y++) for (let x = part.x; x < part.x + part.w; x++) {
        const i = ((y - tileY) * RASTER_TILE_SIZE + x - tileX) * 4;
        if (!(tile.bytes[i] || tile.bytes[i + 1] || tile.bytes[i + 2] || tile.bytes[i + 3])) continue;
        color.r = tile.bytes[i]!; color.g = tile.bytes[i + 1]!; color.b = tile.bytes[i + 2]!; color.a = tile.bytes[i + 3]!;
        result.setPixel(x - rect.x, y - rect.y, color);
      }
    }
    return result;
  }

  override boundingBoxOfAlpha(threshold = 0): Rect | null {
    if (this.denseData) return super.boundingBoxOfAlpha(threshold);
    if (threshold < 0) return this.width && this.height ? this.bounds() : null;
    let x0 = this.width, y0 = this.height, x1 = -1, y1 = -1;
    for (const [key, tile] of this.tiles) {
      const tx = (key % this.columns) * RASTER_TILE_SIZE, ty = Math.floor(key / this.columns) * RASTER_TILE_SIZE;
      for (let y = 0; y < Math.min(RASTER_TILE_SIZE, this.height - ty); y++) for (let x = 0; x < Math.min(RASTER_TILE_SIZE, this.width - tx); x++) {
        if (!(tile.bytes[(y * RASTER_TILE_SIZE + x) * 4 + 3]! > threshold)) continue;
        x0 = Math.min(x0, tx + x); y0 = Math.min(y0, ty + y); x1 = Math.max(x1, tx + x); y1 = Math.max(y1, ty + y);
      }
    }
    return x1 < 0 ? null : Rect.make(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }
}
