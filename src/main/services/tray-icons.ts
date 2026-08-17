import { deflateSync } from 'zlib'

/**
 * Tiny pure-Node icon toolkit for the system tray. Everything here is
 * dependency-free pixel/PNG work so it can be unit-tested without Electron;
 * the `nativeImage` wrapping happens in the main process entry point.
 */

export type StatusColor = 'green' | 'amber' | 'red'

export type MenuIconName =
  | 'play'
  | 'quickScan'
  | 'restorePoint'
  | 'home'
  | 'eraser'
  | 'bug'
  | 'gauge'
  | 'sliders'
  | 'power'
  | 'bell'
  | 'calendar'
  | 'activity'

const ICON_SIZE = 16

// ─── PNG encoder (RGBA, 8-bit, non-interlaced) ─────────────

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Encode a raw RGBA buffer (w×h) into a PNG buffer. */
export function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // bytes 10-12 (compression, filter, interlace) default to 0

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Menu glyphs ───────────────────────────────────────────

// 16×16 bitmaps. `#` = on, `.` = off. Hand-authored at a small grid so they
// stay crisp in the tray menu without shipping an asset per icon.
// ─── Glyph geometry ────────────────────────────────────────
//
// Glyphs are vector primitives on a 16-unit grid, rasterized with anti-aliasing
// at whatever size is asked for. They used to be hand-drawn 16×16 ASCII bitmaps
// of solid blocks, which had three problems: the solid fills clashed with the
// stroked (lucide) iconography the rest of the app uses, the @2x variant was a
// nearest-neighbour block-scale of the 16px art rather than a real 32px render,
// and hard-edged diagonals looked ragged on a menu bar.
//
// Distance-field rendering gives round caps and joins for free, so a stroke is
// just "every point within half a stroke-width of this line", which is also why
// this stays pure Node with no dependency to test around.

/** A point on the 16-unit design grid. y increases downward, as in the image. */
type Pt = readonly [number, number]

/**
 * Angles are in degrees measured from east, increasing toward +y — i.e.
 * clockwise on screen, because y points down. 270° is straight up.
 */
type Prim =
  | { k: 'line'; a: Pt; b: Pt; w?: number }
  | { k: 'poly'; pts: readonly Pt[]; w?: number; close?: boolean }
  | { k: 'ring'; c: Pt; r: number; w?: number }
  | { k: 'arc'; c: Pt; r: number; from: number; to: number; w?: number }
  | { k: 'disc'; c: Pt; r: number }
  | { k: 'fill'; pts: readonly Pt[] }

/** Design grid the primitives are authored on. */
const GRID = 16

/**
 * Default stroke weight, in grid units.
 *
 * The app's lucide icons are 1.8 on a 24 grid (0.075). Scaled to this grid that
 * would be 1.2, which is too thin to hold up in a menu bar once anti-aliased —
 * 1.7 keeps the same visual family while staying legible at 16px.
 */
const STROKE = 1.7

/** A closed rectangle as a stroked polygon. */
function rect(x0: number, y0: number, x1: number, y1: number, w?: number): Prim {
  return { k: 'poly', pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], close: true, w }
}

const GLYPHS: Record<MenuIconName, readonly Prim[]> = {
  // Right-pointing triangle. The previous art pointed *up*, which reads as a
  // sort-ascending marker rather than "run this now".
  play: [{ k: 'fill', pts: [[5.4, 3.3], [12.7, 8], [5.4, 12.7]] }],

  // Magnifier — "scan now".
  quickScan: [
    { k: 'ring', c: [7.1, 7.1], r: 3.7 },
    { k: 'line', a: [9.9, 9.9], b: [13.3, 13.3] },
  ],

  // Clock: a point in time to restore to.
  restorePoint: [
    { k: 'ring', c: [8, 8], r: 5.3 },
    { k: 'line', a: [8, 8], b: [8, 4.6] },
    { k: 'line', a: [8, 8], b: [10.8, 9.3] },
  ],

  home: [
    { k: 'poly', pts: [[2.7, 8.7], [8, 3.6], [13.3, 8.7]] },
    { k: 'poly', pts: [[4.5, 8.2], [4.5, 13.2], [11.5, 13.2], [11.5, 8.2]] },
  ],

  // A sparkle, not an eraser: this key routes to the Cleaner page, whose icon in
  // the sidebar is `Sparkles`, and it echoes the spark in the brand mark. The key
  // name is kept so the MenuIconName union stays stable.
  eraser: [
    {
      k: 'fill',
      pts: [
        [8, 2.4], [9.5, 6.5], [13.6, 8], [9.5, 9.5],
        [8, 13.6], [6.5, 9.5], [2.4, 8], [6.5, 6.5],
      ],
    },
  ],

  bug: [
    { k: 'ring', c: [8, 9.1], r: 3.5 },
    { k: 'line', a: [4.5, 9.1], b: [2.3, 9.1] },
    { k: 'line', a: [11.5, 9.1], b: [13.7, 9.1] },
    { k: 'line', a: [5.3, 11.7], b: [3.5, 13.5] },
    { k: 'line', a: [10.7, 11.7], b: [12.5, 13.5] },
    { k: 'line', a: [6.4, 5.9], b: [5.4, 3.2] },
    { k: 'line', a: [9.6, 5.9], b: [10.6, 3.2] },
  ],

  // Speedometer: a 250° dial with the gap at the bottom, needle to upper-right.
  // A plain top half-arc left rows 11-15 empty, so the glyph sat high in the box
  // and read as a floating eyebrow rather than a dial.
  gauge: [
    { k: 'arc', c: [8, 8.6], r: 5.3, from: 145, to: 395 },
    { k: 'line', a: [8, 8.6], b: [10.5, 5.6] },
    { k: 'disc', c: [8, 8.6], r: 1.15 },
  ],

  sliders: [
    { k: 'line', a: [2.7, 5.3], b: [13.3, 5.3] },
    { k: 'disc', c: [5.9, 5.3], r: 1.9 },
    { k: 'line', a: [2.7, 10.7], b: [13.3, 10.7] },
    { k: 'disc', c: [10.1, 10.7], r: 1.9 },
  ],

  // Power: a ring broken at the top, with the stem rising through the gap.
  power: [
    { k: 'arc', c: [8, 9], r: 4.9, from: 300, to: 600 },
    { k: 'line', a: [8, 2.6], b: [8, 7.6] },
  ],

  bell: [
    { k: 'arc', c: [8, 8.2], r: 3.6, from: 180, to: 360 },
    { k: 'line', a: [4.4, 8.2], b: [4.4, 11.2] },
    { k: 'line', a: [11.6, 8.2], b: [11.6, 11.2] },
    { k: 'line', a: [3.2, 11.2], b: [12.8, 11.2] },
    { k: 'disc', c: [8, 13.3], r: 1.15 },
  ],

  calendar: [
    rect(2.9, 4.6, 13.1, 13.1),
    { k: 'line', a: [2.9, 7.4], b: [13.1, 7.4] },
    { k: 'line', a: [5.7, 2.7], b: [5.7, 5.1] },
    { k: 'line', a: [10.3, 2.7], b: [10.3, 5.1] },
  ],

  // Pulse line.
  activity: [
    { k: 'poly', pts: [[2.2, 8], [5.5, 8], [6.9, 4.3], [9.1, 11.7], [10.5, 8], [13.8, 8]] },
  ],
}

// ─── Rasterizer ────────────────────────────────────────────

/** Squared distance from p to segment ab, in grid units. */
function distToSegment(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / lenSq
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const cx = a[0] + t * dx
  const cy = a[1] + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Even-odd point-in-polygon. */
function insidePolygon(px: number, py: number, pts: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/** Is the angle from `c` to the point inside the arc's sweep? */
function withinSweep(px: number, py: number, c: Pt, from: number, to: number): boolean {
  let deg = (Math.atan2(py - c[1], px - c[0]) * 180) / Math.PI
  if (deg < 0) deg += 360
  const start = ((from % 360) + 360) % 360
  const span = to - from
  let rel = deg - start
  if (rel < 0) rel += 360
  return rel <= span
}

/** Does this point fall inside any primitive? */
function covered(px: number, py: number, prims: readonly Prim[]): boolean {
  for (const prim of prims) {
    switch (prim.k) {
      case 'line': {
        if (distToSegment(px, py, prim.a, prim.b) <= (prim.w ?? STROKE) / 2) return true
        break
      }
      case 'poly': {
        const half = (prim.w ?? STROKE) / 2
        const n = prim.pts.length
        const last = prim.close ? n : n - 1
        for (let i = 0; i < last; i++) {
          if (distToSegment(px, py, prim.pts[i], prim.pts[(i + 1) % n]) <= half) return true
        }
        break
      }
      case 'ring': {
        if (Math.abs(Math.hypot(px - prim.c[0], py - prim.c[1]) - prim.r) <= (prim.w ?? STROKE) / 2) return true
        break
      }
      case 'arc': {
        const onBand = Math.abs(Math.hypot(px - prim.c[0], py - prim.c[1]) - prim.r) <= (prim.w ?? STROKE) / 2
        if (onBand && withinSweep(px, py, prim.c, prim.from, prim.to)) return true
        break
      }
      case 'disc': {
        if (Math.hypot(px - prim.c[0], py - prim.c[1]) <= prim.r) return true
        break
      }
      case 'fill': {
        if (insidePolygon(px, py, prim.pts)) return true
        break
      }
    }
  }
  return false
}

/**
 * Supersampling factor. 4× (16 samples per pixel) is enough to make a diagonal
 * read smoothly at 16px without the cost mattering — every result is cached.
 */
const SS = 4

/**
 * Render a glyph to RGBA at `size`, anti-aliased.
 *
 * Colour is flat; only alpha varies, which is what lets the same render be used
 * as a macOS template image and be recoloured per theme elsewhere.
 */
function renderGlyph(
  name: MenuIconName,
  color: readonly [number, number, number],
  size: number
): Buffer {
  const prims = GLYPHS[name]
  const buf = Buffer.alloc(size * size * 4)
  const step = GRID / (size * SS)
  const inv = 255 / (SS * SS)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        const uy = (y * SS + sy + 0.5) * step
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x * SS + sx + 0.5) * step
          if (covered(ux, uy, prims)) hits++
        }
      }
      if (hits === 0) continue
      const i = (y * size + x) * 4
      buf[i] = color[0]
      buf[i + 1] = color[1]
      buf[i + 2] = color[2]
      buf[i + 3] = Math.min(255, Math.round(hits * inv))
    }
  }
  return buf
}

/** Render a glyph to an RGBA buffer at ICON_SIZE×ICON_SIZE. */
export function glyphRgba(name: MenuIconName, color: readonly [number, number, number]): Buffer {
  return renderGlyph(name, color, ICON_SIZE)
}

/** Render a glyph at any pixel size and encode it as PNG. */
export function glyphPngAt(
  name: MenuIconName,
  color: readonly [number, number, number],
  size: number
): Buffer {
  return encodePng(size, size, renderGlyph(name, color, size))
}

const MENU_ICON_COLOR: readonly [number, number, number] = [26, 26, 26]
const menuIconCache = new Map<string, Buffer>()

/**
 * A 16×16 PNG buffer for a menu glyph (any `size` for @2x variants).
 * Near-black by default so it reads on the light context menus Windows/Linux
 * render; macOS ignores menu icons entirely, so this is a Windows/Linux nicety.
 */
export function menuIconPng(
  name: MenuIconName,
  color: readonly [number, number, number] = MENU_ICON_COLOR,
  size: number = ICON_SIZE
): Buffer {
  const key = `${name}:${color.join(',')}@${size}`
  const cached = menuIconCache.get(key)
  if (cached) return cached
  const png = glyphPngAt(name, color, size)
  menuIconCache.set(key, png)
  return png
}

// ─── Status dot overlay ────────────────────────────────────

const STATUS_RGB: Record<StatusColor, readonly [number, number, number]> = {
  green: [0x22, 0xc5, 0x5e],
  amber: [0xf5, 0xa6, 0x23],
  red: [0xef, 0x44, 0x44],
}

/** Ring color is kept dark so the dot separates from light menu bars / wallpapers. */
const RING_RGB: readonly [number, number, number] = [0x1e, 0x1e, 0x22]

/**
 * Paint a small status dot (with a feathered dark ring) onto the bottom-right
 * corner of a raw BGRA premultiplied bitmap (as returned by
 * `nativeImage.toBitmap()`). Returns a new buffer; the input is untouched.
 */
export function overlayDotOnBitmap(
  bitmap: Buffer,
  width: number,
  height: number,
  color: StatusColor
): Buffer {
  const out = Buffer.from(bitmap)
  if (width <= 0 || height <= 0) return out

  const scale = width / ICON_SIZE
  const dotRadius = 2.5 * scale
  const ringRadius = 3.5 * scale
  const cx = width - 3 * scale
  const cy = height - 3 * scale
  const [r, g, b] = STATUS_RGB[color]
  const [rr, rg, rb] = RING_RGB
  const stride = width * 4

  const paint = (x: number, y: number, pr: number, pg: number, pb: number, alpha: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * stride + x * 4
    // Straight write. The corner of the base icon is empty canvas, and the
    // ring is drawn at premultiplied-alpha so opaque = exact color.
    const a = alpha / 255
    out[i] = Math.round(pb * a)
    out[i + 1] = Math.round(pg * a)
    out[i + 2] = Math.round(pr * a)
    out[i + 3] = alpha
  }

  const ceil = Math.ceil(ringRadius)
  for (let dy = -ceil; dy <= ceil; dy++) {
    for (let dx = -ceil; dx <= ceil; dx++) {
      const dist = Math.hypot(dx, dy)
      if (dist <= dotRadius) {
        paint(cx + dx, cy + dy, r, g, b, 255)
      } else if (dist <= ringRadius) {
        const t = 1 - (dist - dotRadius) / (ringRadius - dotRadius)
        paint(cx + dx, cy + dy, rr, rg, rb, Math.round(t * 210))
      }
    }
  }
  return out
}

/**
 * Re-tint every lit pixel of a BGRA premultiplied bitmap (as returned by
 * `nativeImage.toBitmap()`) to a target RGB, preserving alpha. Used to re-color
 * black+alpha template marks so they contrast with light or dark menu bars,
 * e.g. white glyphs on a dark bar, black glyphs on a light one.
 */
export function recolorBitmap(bitmap: Buffer, rgb: readonly [number, number, number]): Buffer {
  const out = Buffer.from(bitmap)
  for (let i = 0; i + 3 < out.length; i += 4) {
    const a = out[i + 3]
    if (a === 0) continue
    const f = a / 255
    out[i] = Math.round(rgb[2] * f)
    out[i + 1] = Math.round(rgb[1] * f)
    out[i + 2] = Math.round(rgb[0] * f)
  }
  return out
}
