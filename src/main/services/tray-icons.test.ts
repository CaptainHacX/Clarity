import { describe, it, expect } from 'vitest'
import { inflateSync } from 'zlib'
import { encodePng, glyphRgba, glyphPngAt, menuIconPng, overlayDotOnBitmap, recolorBitmap } from './tray-icons'

describe('encodePng', () => {
  it('starts with the PNG signature', () => {
    const buf = encodePng(16, 16, Buffer.alloc(16 * 16 * 4))
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('writes an IHDR chunk describing an RGBA 16x16 image', () => {
    const buf = encodePng(16, 16, Buffer.alloc(16 * 16 * 4))
    const ihdr = 8 // after the 8-byte signature
    expect(buf.readUInt32BE(ihdr)).toBe(13)
    expect(buf.toString('ascii', ihdr + 4, ihdr + 8)).toBe('IHDR')
    expect(buf.readUInt32BE(ihdr + 8)).toBe(16) // width
    expect(buf.readUInt32BE(ihdr + 12)).toBe(16) // height
    expect(buf[ihdr + 16]).toBe(8) // bit depth
    expect(buf[ihdr + 17]).toBe(6) // color type RGBA
  })

  it('terminates with IEND', () => {
    const buf = encodePng(16, 16, Buffer.alloc(16 * 16 * 4))
    const iend = buf.length - 12
    expect(buf.toString('ascii', iend + 4, iend + 8)).toBe('IEND')
  })
})

describe('glyphRgba / menuIconPng', () => {
  it('renders on-pixels opaque with the requested color and off-pixels transparent', () => {
    const rgba = glyphRgba('play', [1, 2, 3])
    let opaque = 0
    let transparent = 0
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] === 255) {
        opaque++
        expect(rgba[i]).toBe(1) // R
        expect(rgba[i + 1]).toBe(2) // G
        expect(rgba[i + 2]).toBe(3) // B
      } else {
        expect(rgba[i + 3]).toBe(0)
        transparent++
      }
    }
    expect(opaque).toBeGreaterThan(0)
    expect(transparent).toBeGreaterThan(0)
  })

  it('menuIconPng returns a cached identical buffer on repeat calls', () => {
    const a = menuIconPng('home')
    const b = menuIconPng('home')
    expect(a.equals(b)).toBe(true)
    expect(a.length).toBeGreaterThan(8)
  })

  it('glyphPngAt scales a glyph up cleanly at 32px', () => {
    const base = glyphRgba('home', [1, 2, 3])
    const big = glyphPngAt('home', [1, 2, 3], 32)
    const png = decodePng(big)
    expect(png.width).toBe(32)
    expect(png.height).toBe(32)
    // A 16px glyph scaled 2x fills exactly 2x2 blocks — every lit pixel is opaque.
    let lit = 0
    for (let i = 0; i < png.rgba.length; i += 4) {
      if (png.rgba[i + 3] !== 0) {
        lit++
        expect(png.rgba[i]).toBe(1)
        expect(png.rgba[i + 1]).toBe(2)
        expect(png.rgba[i + 2]).toBe(3)
      }
    }
    const baseLit = countLit(base)
    expect(lit).toBe(baseLit * 4)
  })
})

// Minimal PNG decoder for assertions (reduces dependency on encodePng internals).
function decodePng(buf: Buffer): { width: number; height: number; rgba: Buffer } {
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  let off = 8
  const idat: Buffer[] = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len))
    off += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4
  const rowBytes = width * bpp
  const rgba = Buffer.alloc(height * rowBytes)
  let prev = Buffer.alloc(rowBytes)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (rowBytes + 1)]
    const row = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1))
    const cur = Buffer.from(row)
    if (f === 1) for (let i = bpp; i < rowBytes; i++) cur[i] = (cur[i] + cur[i - bpp]) & 255
    else if (f === 2) for (let i = 0; i < rowBytes; i++) cur[i] = (cur[i] + prev[i]) & 255
    else if (f === 3) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        cur[i] = (cur[i] + ((a + b) >> 1)) & 255
      }
    } else if (f === 4) {
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0
        const b = prev[i]
        const c = i >= bpp ? prev[i - bpp] : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
        cur[i] = (cur[i] + pr) & 255
      }
    }
    cur.copy(rgba, y * rowBytes)
    prev = cur
  }
  return { width, height, rgba }
}

function countLit(rgba: Buffer): number {
  let n = 0
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) n++
  return n
}

describe('overlayDotOnBitmap', () => {
  const w = 16
  const h = 16
  const blank = () => Buffer.alloc(w * h * 4) // transparent premultiplied
  // dot center is (width - 3*scale, height - 3*scale) = (13, 13) for 16px
  const center = 13 * w * 4 + 13 * 4
  const corner = (h - 1) * w * 4 + (w - 1) * 4

  it('paints an opaque red dot at the center of the corner badge', () => {
    const out = overlayDotOnBitmap(blank(), w, h, 'red')
    expect(out[center + 3]).toBe(255)
    // BGRA premultiplied: opaque so channel equals the requested color
    expect(out[center]).toBe(0x44) // B
    expect(out[center + 1]).toBe(0x44) // G
    expect(out[center + 2]).toBe(0xef) // R
  })

  it('adds a translucent ring around the dot and leaves far pixels untouched', () => {
    const out = overlayDotOnBitmap(blank(), w, h, 'amber')
    // bottom-right corner pixel is ring (further than dot radius)
    expect(out[corner + 3]).toBeGreaterThan(0)
    expect(out[corner + 3]).toBeLessThan(255)
    // top-left far corner stays fully transparent
    expect(out[3]).toBe(0)
  })

  it('uses the requested color per status', () => {
    const green = overlayDotOnBitmap(blank(), w, h, 'green')
    expect(green[center]).toBe(0x5e)
    expect(green[center + 1]).toBe(0xc5)
    expect(green[center + 2]).toBe(0x22)
  })

  it('does not mutate the input buffer', () => {
    const src = blank()
    overlayDotOnBitmap(src, w, h, 'red')
    expect(src.every((v) => v === 0)).toBe(true)
  })
})

describe('recolorBitmap', () => {
  const mk = () => Buffer.from([
    0, 0, 0, 255,   // opaque black
    0, 0, 0, 128,   // half-alpha black (premultiplied)
    0, 0, 0, 0,     // fully transparent
  ])

  it('re-tints opaque pixels to the exact target and keeps alpha', () => {
    const out = recolorBitmap(mk(), [255, 255, 255])
    expect(out).toEqual(Buffer.from([
      255, 255, 255, 255,
      128, 128, 128, 128,
      0, 0, 0, 0,
    ]))
  })

  it('premultiplies partial alpha toward the target color', () => {
    const out = recolorBitmap(mk(), [0, 128, 255])
    expect(out[0]).toBe(255) // B
    expect(out[1]).toBe(128) // G
    expect(out[2]).toBe(0)   // R
    expect(out[4]).toBe(128) // B halved by alpha
    expect(out[5]).toBe(64)  // G halved
    expect(out[8]).toBe(0)   // transparent untouched
  })

  it('does not mutate the input buffer', () => {
    const src = mk()
    recolorBitmap(src, [255, 0, 0])
    expect(src[0]).toBe(0)
  })
})
