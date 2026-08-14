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
const GLYPHS: Record<MenuIconName, readonly string[]> = {
  play: [
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '.....######.....',
    '.....######.....',
    '....########....',
    '....########....',
    '...##########...',
    '...##########...',
    '..############..',
    '..############..',
    '.##############.',
    '.##############.',
    '................',
    '................',
  ],
  quickScan: [
    '................',
    '................',
    '......##..##....',
    '......##..##....',
    '.......####.....',
    '........##......',
    '.....########...',
    '........##......',
    '.......####.....',
    '......##..##....',
    '......##..##....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  restorePoint: [
    '................',
    '....########....',
    '...##########...',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '...##########...',
    '...##########...',
    '....########....',
    '....#######.....',
    '.....#####......',
    '......###.......',
    '.......#........',
    '................',
  ],
  home: [
    '................',
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '................',
    '...####...####..',
    '...####...####..',
    '...####...####..',
    '...####...####..',
    '...####...####..',
    '...####...####..',
    '...####...####..',
    '................',
  ],
  eraser: [
    '................',
    '................',
    '...###########..',
    '...###########..',
    '...#########.#..',
    '...########..#..',
    '...#######...#..',
    '...######....#..',
    '...#####.....#..',
    '...####......#..',
    '...###.......#..',
    '...##........#..',
    '...###########..',
    '................',
    '................',
    '................',
  ],
  bug: [
    '................',
    '......##..##....',
    '.......####.....',
    '.......####.....',
    '......######....',
    '....##......##..',
    '....##.####.##..',
    '....##########..',
    '....##########..',
    '.....########...',
    '.....########...',
    '....###....###..',
    '......##..##....',
    '................',
    '................',
    '................',
  ],
  gauge: [
    '................',
    '................',
    '....##.....##...',
    '...#.........#..',
    '..#...........#.',
    '..#...........#.',
    '..#....#......#.',
    '..#....#......#.',
    '..#....#......#.',
    '..#....#......#.',
    '..#...........#.',
    '..#...........#.',
    '...#.........#..',
    '....##.....##...',
    '................',
    '................',
  ],
  sliders: [
    '................',
    '................',
    '......###.......',
    '...##########...',
    '.......###......',
    '................',
    '................',
    '.......###......',
    '...##########...',
    '.......###......',
    '................',
    '................',
    '.......###......',
    '...##########...',
    '.......###......',
    '................',
  ],
  power: [
    '................',
    '.......##.......',
    '.......##.......',
    '....#.####.#....',
    '...#........#...',
    '..#..........#..',
    '.#............#.',
    '.#............#.',
    '.#............#.',
    '.#............#.',
    '.#............#.',
    '..#..........#..',
    '...#........#...',
    '....########....',
    '................',
    '................',
  ],
  bell: [
    '................',
    '................',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '...####..####...',
    '...####..####...',
    '...####..####...',
    '...####..####...',
    '...####..####...',
    '....########....',
    '....########....',
    '....########....',
    '.......##.......',
    '................',
  ],
  calendar: [
    '................',
    '......#....#....',
    '......#....#....',
    '....########....',
    '....########....',
    '...###########..',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###....###...',
    '...###########..',
    '...###########..',
    '................',
  ],
  activity: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....##......##..',
    '....##......##..',
    '....##..##..##..',
    '....##..##..##..',
    '....##..##..##..',
    '..######..######',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
}

/** Render a glyph to an RGBA buffer at ICON_SIZE×ICON_SIZE. */
export function glyphRgba(name: MenuIconName, color: readonly [number, number, number]): Buffer {
  const glyph = GLYPHS[name]
  const buf = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4)
  for (let y = 0; y < ICON_SIZE; y++) {
    const row = glyph[y] ?? ''
    for (let x = 0; x < ICON_SIZE; x++) {
      if (row[x] === '#') {
        const i = (y * ICON_SIZE + x) * 4
        buf[i] = color[0]
        buf[i + 1] = color[1]
        buf[i + 2] = color[2]
        buf[i + 3] = 255
      }
    }
  }
  return buf
}

/** Render a glyph at any pixel size (scale = size/16) and encode it as PNG. */
export function glyphPngAt(
  name: MenuIconName,
  color: readonly [number, number, number],
  size: number
): Buffer {
  const glyph = GLYPHS[name]
  const buf = Buffer.alloc(size * size * 4)
  const scale = size / ICON_SIZE
  const block = Math.max(1, Math.round(scale))
  for (let y = 0; y < ICON_SIZE; y++) {
    const row = glyph[y] ?? ''
    for (let x = 0; x < ICON_SIZE; x++) {
      if (row[x] !== '#') continue
      const x0 = Math.round(x * scale)
      const y0 = Math.round(y * scale)
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const px = Math.min(size - 1, x0 + dx)
          const py = Math.min(size - 1, y0 + dy)
          const i = (py * size + px) * 4
          buf[i] = color[0]
          buf[i + 1] = color[1]
          buf[i + 2] = color[2]
          buf[i + 3] = 255
        }
      }
    }
  }
  return encodePng(size, size, buf)
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
