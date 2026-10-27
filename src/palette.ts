/**
 * Pure colour + noise helpers for the dashboard screensaver.
 * No OpenCode or OpenTUI imports, so this file unit-tests with `node --test`.
 */

export type RGB = readonly [number, number, number]

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Classic improved Perlin noise in three dimensions, seeded and repeatable. */
export class Perlin {
  private readonly perm = new Uint8Array(512)

  constructor(seed = 1337) {
    const random = mulberry32(seed)
    const table = new Uint8Array(256)
    for (let index = 0; index < 256; index++) table[index] = index
    for (let index = 255; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1))
      const value = table[index]
      table[index] = table[swap]
      table[swap] = value
    }
    for (let index = 0; index < 512; index++) this.perm[index] = table[index & 255]
  }

  private grad(hash: number, x: number, y: number, z: number): number {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  /** Returns a value in roughly [-1, 1] that is smooth over all three axes. */
  noise3(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const zi = Math.floor(z) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const zf = z - Math.floor(z)
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)

    const p = this.perm
    const a = p[xi] + yi
    const aa = p[a] + zi
    const ab = p[a + 1] + zi
    const b = p[xi + 1] + yi
    const ba = p[b] + zi
    const bb = p[b + 1] + zi

    const x1 = lerp(this.grad(p[aa], xf, yf, zf), this.grad(p[ba], xf - 1, yf, zf), u)
    const x2 = lerp(this.grad(p[ab], xf, yf - 1, zf), this.grad(p[bb], xf - 1, yf - 1, zf), u)
    const y1 = lerp(x1, x2, v)

    const x3 = lerp(this.grad(p[aa + 1], xf, yf, zf - 1), this.grad(p[ba + 1], xf - 1, yf, zf - 1), u)
    const x4 = lerp(this.grad(p[ab + 1], xf, yf - 1, zf - 1), this.grad(p[bb + 1], xf - 1, yf - 1, zf - 1), u)
    const y2 = lerp(x3, x4, v)

    return lerp(y1, y2, w)
  }
}

function hsvToRgb(hue: number, saturation: number, value: number): RGB {
  const h = ((hue % 360) + 360) % 360
  const c = value * saturation
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = value - c
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x]
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ]
}

/**
 * Screensaver palette:
 * 0-40% black, 40-50% fade from black to red, 50-100% one full loop through the
 * colour spectrum.
 */
export function palette(p: number): RGB {
  const value = clamp01(p)
  if (value < 0.4) return [0, 0, 0]
  if (value < 0.5) {
    const t = (value - 0.4) / 0.1
    return [Math.round(255 * t), 0, 0]
  }
  return hsvToRgb(((value - 0.5) / 0.5) * 360, 1, 1)
}

/**
 * Darkest a screensaver glyph may get. The palette deliberately bottoms out at
 * pure black, which is invisible on the black screensaver background, so glyph
 * colours are floored at a readable dark grey instead.
 */
export const SAVER_FLOOR = 96

/**
 * Raises every channel of a screensaver colour to `floor`. Results are cached by
 * source object so the quantised LUT keeps its identity and run merging still
 * collapses a full-screen recolour into a few hundred text chunks.
 */
export function readable(color: RGB, floor = SAVER_FLOOR): RGB {
  const cached = readableCache.get(color)
  if (cached) return cached
  const raised: RGB = [
    color[0] < floor ? floor : color[0],
    color[1] < floor ? floor : color[1],
    color[2] < floor ? floor : color[2],
  ]
  readableCache.set(color, raised)
  return raised
}

const readableCache = new WeakMap<RGB, RGB>()

export interface NoiseField {
  /** Colour for the character at screen column/row, at animated time `seconds`. */
  at(x: number, y: number, seconds: number): RGB
}

/**
 * Screensaver colours are quantised into a fixed LUT so every cell reuses one of
 * a few dozen shared colour objects. Run merging compares colours by identity,
 * so this is what keeps a full-screen recolour down to a few hundred text chunks
 * per frame instead of one chunk per character.
 */
const LUT_STEPS = 96
const lut: RGB[] = Array.from({ length: LUT_STEPS + 1 }, (_, index) => palette(index / LUT_STEPS))

function lookup(value: number): RGB {
  return lut[Math.round(clamp01(value) * LUT_STEPS)]
}

/**
 * Maps character positions to a palette through animated 3D Perlin noise.
 * Y is compressed relative to X because terminal cells are about twice as tall
 * as they are wide, so the field stays visually isotropic.
 */
export function createNoiseField(seed = 1337, scale = 0.035): NoiseField {
  const perlin = new Perlin(seed)
  return {
    at(x, y, seconds) {
      const noise = perlin.noise3(x * scale, y * scale * 2, seconds * 0.45)
      return lookup(0.5 + noise * 0.95)
    },
  }
}
