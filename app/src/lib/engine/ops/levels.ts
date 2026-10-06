/**
 * Levels: input black / white / gamma and output black / white, per channel (R, G, B)
 * and master (RGB). Per-channel values are applied first, then the master, which is how
 * Photoshop composes them. "Auto" clips 0.1 % of pixels at each end of every channel.
 */

import { applyLut, makeLut } from "./cpu";
import { autoLevelsForChannel } from "./histogram";
import { num, type NumberParam, type OpDef, type ParamValues } from "./types";

const CHANNELS = ["rgb", "r", "g", "b"] as const;
type Channel = (typeof CHANNELS)[number];

function suffix(ch: Channel): string {
  return ch === "rgb" ? "" : `_${ch}`;
}

function levelsParams(ch: Channel): NumberParam[] {
  const s = suffix(ch);
  return [
    { kind: "number", id: `inBlack${s}`, label: "Input black", min: 0, max: 253, step: 1, default: 0, group: ch },
    { kind: "number", id: `gamma${s}`, label: "Gamma", min: 0.1, max: 9.99, step: 0.01, default: 1, group: ch },
    { kind: "number", id: `inWhite${s}`, label: "Input white", min: 2, max: 255, step: 1, default: 255, group: ch },
    { kind: "number", id: `outBlack${s}`, label: "Output black", min: 0, max: 255, step: 1, default: 0, group: ch },
    { kind: "number", id: `outWhite${s}`, label: "Output white", min: 0, max: 255, step: 1, default: 255, group: ch },
  ];
}

export interface LevelsValues {
  inBlack: number;
  inWhite: number;
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export function readLevels(p: ParamValues, ch: Channel): LevelsValues {
  const s = suffix(ch);
  return {
    inBlack: num(p, `inBlack${s}`, 0),
    inWhite: num(p, `inWhite${s}`, 255),
    gamma: num(p, `gamma${s}`, 1),
    outBlack: num(p, `outBlack${s}`, 0),
    outWhite: num(p, `outWhite${s}`, 255),
  };
}

/** The levels transfer function on a 0..1 value. */
export function levelsFn(v: number, l: LevelsValues): number {
  const ib = l.inBlack / 255;
  const iw = Math.max(l.inWhite, l.inBlack + 1) / 255;
  let t = (v - ib) / (iw - ib);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  t = Math.pow(t, 1 / Math.max(0.01, l.gamma));
  return l.outBlack / 255 + t * ((l.outWhite - l.outBlack) / 255);
}

const GLSL = `
uniform vec4 u_inBlack;  // r, g, b, master
uniform vec4 u_inWhite;
uniform vec4 u_gamma;
uniform vec4 u_outBlack;
uniform vec4 u_outWhite;
float pf_levels(float v, float ib, float iw, float g, float ob, float ow) {
  float t = clamp((v - ib) / max(iw - ib, 1.0 / 255.0), 0.0, 1.0);
  t = pow(t, 1.0 / max(g, 0.01));
  return ob + t * (ow - ob);
}
vec3 pf_levels3(vec3 c, int i) {
  return vec3(
    pf_levels(c.r, u_inBlack[i], u_inWhite[i], u_gamma[i], u_outBlack[i], u_outWhite[i]),
    pf_levels(c.g, u_inBlack[i], u_inWhite[i], u_gamma[i], u_outBlack[i], u_outWhite[i]),
    pf_levels(c.b, u_inBlack[i], u_inWhite[i], u_gamma[i], u_outBlack[i], u_outWhite[i]));
}
vec4 pf_op(ivec2 p) {
  vec4 c = pf_fetch(p);
  vec3 r = vec3(
    pf_levels(c.r, u_inBlack[0], u_inWhite[0], u_gamma[0], u_outBlack[0], u_outWhite[0]),
    pf_levels(c.g, u_inBlack[1], u_inWhite[1], u_gamma[1], u_outBlack[1], u_outWhite[1]),
    pf_levels(c.b, u_inBlack[2], u_inWhite[2], u_gamma[2], u_outBlack[2], u_outWhite[2]));
  c.rgb = clamp(pf_levels3(r, 3), 0.0, 1.0);
  return c;
}`;

export const levels: OpDef = {
  id: "levels",
  label: "Levels",
  menu: "Image/Adjustments",
  shortcut: "CmdOrCtrl+L",
  histogram: true,
  keywords: ["black point", "white point", "gamma", "auto"],
  groupSelector: {
    id: "channel",
    label: "Channel",
    options: [
      { value: "rgb", label: "RGB" },
      { value: "r", label: "Red" },
      { value: "g", label: "Green" },
      { value: "b", label: "Blue" },
    ],
    default: "rgb",
  },
  params: CHANNELS.flatMap(levelsParams),
  glsl: (p) => {
    const order: Channel[] = ["r", "g", "b", "rgb"];
    const v = order.map((ch) => readLevels(p, ch));
    return [
      {
        source: GLSL,
        uniforms: {
          u_inBlack: v.map((l) => l.inBlack / 255),
          u_inWhite: v.map((l) => Math.max(l.inWhite, l.inBlack + 1) / 255),
          u_gamma: v.map((l) => l.gamma),
          u_outBlack: v.map((l) => l.outBlack / 255),
          u_outWhite: v.map((l) => l.outWhite / 255),
        },
      },
    ];
  },
  cpu: (src, p) => {
    const master = readLevels(p, "rgb");
    const lut = (ch: Channel): Uint8ClampedArray => {
      const own = readLevels(p, ch);
      return makeLut((v) => levelsFn(levelsFn(v, own), master));
    };
    return applyLut(src, lut("r"), lut("g"), lut("b"));
  },
  auto: (hist) => {
    const r = autoLevelsForChannel(hist.r, hist.count);
    const g = autoLevelsForChannel(hist.g, hist.count);
    const b = autoLevelsForChannel(hist.b, hist.count);
    return {
      inBlack_r: r.black,
      inWhite_r: r.white,
      inBlack_g: g.black,
      inWhite_g: g.white,
      inBlack_b: b.black,
      inWhite_b: b.white,
      inBlack: 0,
      inWhite: 255,
      gamma: 1,
    };
  },
};
