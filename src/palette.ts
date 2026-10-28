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
  let cache = readableCaches.get(floor)
  if (!cache) {
    cache = new WeakMap<RGB, RGB>()
    readableCaches.set(floor, cache)
  }
  const cached = cache.get(color)
  if (cached) return cached
  const raised: RGB = [
    color[0] < floor ? floor : color[0],
    color[1] < floor ? floor : color[1],
    color[2] < floor ? floor : color[2],
  ]
  cache.set(color, raised)
  return raised
}

/** One cache per floor: a colour object may be shared between looks. */
const readableCaches = new Map<number, WeakMap<RGB, RGB>>()

/**
 * One screensaver "look". Every look recolours the glyphs of the canvas; a look
 * may also swap the character itself (the sparkling sky). Colours are plain
 * 8-bit RGB and are emitted as truecolor, so no look is limited to a 256-colour
 * palette. `floor` is the darkest channel a glyph may keep on the black
 * screensaver background (0 = glyphs are allowed to fade away completely).
 */
export interface SaverLook {
  readonly name: string
  /** Fading looks need to reach black, so the legibility floor is per look. */
  readonly floor: number
  /** Colour for the character at screen column/row, at animated time `seconds`. */
  at(x: number, y: number, seconds: number): RGB
  /** Optional glyph for an empty cell; `" "` (or `undefined`) leaves it empty. */
  glyph?(x: number, y: number, seconds: number): string | undefined
}

/** Backwards-compatible alias for the first look. */
export type NoiseField = SaverLook

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
export function createNoiseField(seed = 1337, scale = 0.035): SaverLook {
  const perlin = new Perlin(seed)
  return {
    name: "perlin drift",
    floor: SAVER_FLOOR,
    at(x, y, seconds) {
      const noise = perlin.noise3(x * scale, y * scale * 2, seconds * 0.45)
      return lookup(0.5 + noise * 0.95)
    },
  }
}

/**
 * Look 2: classic "digital rain". Every column runs its own stream at its own
 * speed, so heads fall out of step. A cell's brightness is its distance behind
 * the head: near-white at the head, decaying to a dim green trail.
 */
const MATRIX_STEPS = 64
const matrixLut: RGB[] = Array.from({ length: MATRIX_STEPS + 1 }, (_, index) => {
  const t = index / MATRIX_STEPS
  const head = t > 0.86 ? (t - 0.86) / 0.14 : 0
  const green = Math.round(70 + 185 * t)
  return [
    Math.round(190 * head),
    Math.min(255, green + Math.round(65 * head)),
    Math.round(28 + 46 * t + 90 * head),
  ]
})

const matrixStep = (value: number): RGB => matrixLut[Math.round(clamp01(value) * MATRIX_STEPS)]

export function createMatrixField(seed = 7, rows = 160, columns = 512): SaverLook {
  const random = mulberry32(seed)
  const streams = Array.from({ length: columns }, () => ({
    speed: 6 + random() * 16,
    offset: random() * rows,
    length: 8 + Math.floor(random() * 26),
  }))
  const span = rows + 40
  return {
    name: "falling matrix",
    floor: 24,
    at(x, y, seconds) {
      const stream = streams[Math.abs(x) % columns]
      const head = (stream.offset + seconds * stream.speed) % span
      // Cells above the head are the already-fallen trail; below it is dark.
      const behind = head - (y + 20)
      if (behind < 0 || behind > stream.length) return matrixLut[0]
      return matrixStep(Math.pow(1 - behind / stream.length, 1.35))
    },
  }
}

/**
 * Look 3: a soft horizontal band that sweeps down the screen, drawn as a smooth
 * vertical sine of brightness over a slowly drifting hue.
 */
const SWEEP_HUES = 72
const SWEEP_STEPS = 40
const sweepHueStep = 1 / SWEEP_HUES
const sweepLut: RGB[][] = Array.from({ length: SWEEP_HUES }, (_, hue) =>
  Array.from({ length: SWEEP_STEPS + 1 }, (_, step) =>
    hsvToRgb((hue * 360) / SWEEP_HUES, 0.62, 0.18 + 0.82 * (step / SWEEP_STEPS)),
  ),
)

export function createSweepField(): SaverLook {
  return {
    name: "sine sweep",
    floor: 22,
    at(_x, y, seconds) {
      const band = 0.5 + 0.5 * Math.sin(y * 0.32 - seconds * 1.5)
      // Gentle gamma so the dark end of the band is a soft falloff, not a cliff.
      const brightness = Math.pow(band, 1.6)
      const hue = Math.round((((((y * 1.6 + seconds * 22) / 360) % 1) + 1) % 1) / sweepHueStep) % SWEEP_HUES
      const step = Math.round(clamp01((brightness - 0.18) / 0.82) * SWEEP_STEPS)
      return sweepLut[hue][step]
    },
  }
}

/**
 * Look 4: a sparkling sky. Every cell owns a phase and a rate, so it fades in
 * and out on its own clock; while it is lit it shows a random grayscale
 * character, and while it is dark the cell is blank.
 */
const SKY_STEPS = 48
const skyLut: RGB[] = Array.from({ length: SKY_STEPS + 1 }, (_, index) => {
  const value = Math.round(255 * (index / SKY_STEPS))
  return [value, value, value]
})
// Narrow, single-cell glyphs only: a double-width character would shift every
// following cell and break the canvas alignment.
const SKY_GLYPHS = ["·", "∙", "•", "*", "+", "°", "∘", "⋆", ".", "˙"]

/** Cheap deterministic 0..1 hash for a cell and a salt. */
function hash01(x: number, y: number, salt: number): number {
  let h = Math.imul(x + 0x9e37, 374761393) ^ Math.imul(y + 0x85eb, 668265263) ^ Math.imul(salt + 1, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const skyStep = (value: number): RGB => skyLut[Math.round(clamp01(value) * SKY_STEPS)]

export function createSkyField(seed = 21): SaverLook {
  return {
    name: "sparkling sky",
    floor: 0,
    at(x, y, seconds) {
      const phase = hash01(x, y, seed)
      const rate = 0.16 + 0.34 * hash01(x, y, seed + 1)
      const pulse = 0.5 - 0.5 * Math.cos((seconds * rate + phase) * Math.PI * 2)
      // Most cells stay dim at any moment; the bright ones read as sparkles.
      return skyStep(Math.pow(pulse, 1.8))
    },
    glyph(x, y, seconds) {
      // Most cells never sparkle (a sparse starfield merges into far fewer text
      // chunks than a full-screen grid of characters) and a lit cell still has
      // to be near its pulse peak.
      if (hash01(x, y, seed + 3) < 0.72) return " "
      const phase = hash01(x, y, seed)
      const rate = 0.16 + 0.34 * hash01(x, y, seed + 1)
      const pulse = 0.5 - 0.5 * Math.cos((seconds * rate + phase) * Math.PI * 2)
      if (pulse < 0.45) return " "
      const slot = Math.floor(seconds * 1.7 + phase * 12)
      return SKY_GLYPHS[Math.floor(hash01(x, y, seed + 2 + (slot % 7)) * SKY_GLYPHS.length)]
    },
  }
}
