/**
 * TypeScript mirror of `crates/pf-io/src/frame.rs` — the binary frame used by every
 * raw-bytes Tauri command (see `docs/ipc.md`).
 *
 * Layout: `u32 LE header_len | JSON header (UTF-8) | blob0 | blob1 | …`
 * The header object always carries `blobs: number[]` (byte length of each blob).
 */

export interface FrameHeader {
  blobs: number[];
  [key: string]: unknown;
}

export interface Frame<H extends FrameHeader = FrameHeader> {
  header: H;
  blobs: Uint8Array[];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Build a frame body. `header.blobs` is filled in from `blobs` automatically. */
export function encodeFrame(header: Record<string, unknown>, blobs: Uint8Array[]): Uint8Array {
  const h: FrameHeader = { ...header, blobs: blobs.map((b) => b.byteLength) };
  const headerBytes = enc.encode(JSON.stringify(h));
  const total = 4 + headerBytes.byteLength + blobs.reduce((n, b) => n + b.byteLength, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, headerBytes.byteLength, true);
  out.set(headerBytes, 4);
  let off = 4 + headerBytes.byteLength;
  for (const b of blobs) {
    out.set(b, off);
    off += b.byteLength;
  }
  return out;
}

/** Parse a frame returned by a raw-bytes command. Throws on malformed input. */
export function decodeFrame<H extends FrameHeader = FrameHeader>(buf: ArrayBuffer | Uint8Array): Frame<H> {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes.byteLength < 4) throw new Error("frame: too short");
  const headerLen = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (4 + headerLen > bytes.byteLength) throw new Error("frame: header length out of range");
  const header = JSON.parse(dec.decode(bytes.subarray(4, 4 + headerLen))) as H;
  if (!Array.isArray(header.blobs)) throw new Error("frame: header.blobs missing");
  const blobs: Uint8Array[] = [];
  let off = 4 + headerLen;
  for (const len of header.blobs) {
    if (typeof len !== "number" || off + len > bytes.byteLength) throw new Error("frame: blob length out of range");
    blobs.push(bytes.subarray(off, off + len));
    off += len;
  }
  if (off !== bytes.byteLength) throw new Error("frame: trailing bytes");
  return { header, blobs };
}
