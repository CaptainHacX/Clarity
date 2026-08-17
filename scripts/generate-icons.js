#!/usr/bin/env node
// ─── Brand asset generator ──────────────────────────────────
// Regenerates every icon in the project from the vector geometry defined here,
// so the brand has one source of truth instead of a folder of opaque binaries.
//
//   npm run icons
//
// Rasterizing runs inside Electron (already a devDependency) via a canvas, so
// there is no image-library dependency to install. `.icns` uses macOS's built-in
// `iconutil`; the `.ico` container is written directly, since it is just a
// header wrapping PNGs.
//
// macOS-only for the two container formats — `iconutil` does not exist
// elsewhere. On Windows/Linux the script still emits every PNG and SVG and skips
// only the `.icns`, so the assets stay regenerable cross-platform.

const { spawnSync } = require('child_process')
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require('fs')
const { tmpdir } = require('os')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')

// ─── Brand geometry ─────────────────────────────────────────
// The mark is a bold "C" cut as a camera aperture: one circle, one 66° radial
// cut, terminals on true radii. A four-point spark sits at the core, carried
// over from the previous gem mark so this reads as an evolution of the brand.
//
// Coordinates are exact rather than hand-drawn, so the shape survives any
// scale. Centre (512,512); ring outer r=336, inner r=186; gap ±33° about east.

/** The aperture C, on a 1024 grid. */
const RING_PATH =
  'M793.8 329.0 A336 336 0 1 0 793.8 695.0 L668.0 613.3 A186 186 0 1 1 668.0 410.7 Z'

/** Four-point spark at the core of the counter. */
const SPARK_PATH =
  'M512 417 Q524 500 607 512 Q524 524 512 607 Q500 524 417 512 Q500 500 512 417 Z'

const AMBER_STOPS = `
      <stop offset="0" stop-color="#fde08a"/>
      <stop offset="0.42" stop-color="#fbbf24"/>
      <stop offset="1" stop-color="#d97706"/>`

/** The full-colour artwork on its dark tile, filling the 1024 canvas. */
function colourArtwork() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Clarity</title>
  <defs>
    <linearGradient id="tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1a1a22"/>
      <stop offset="1" stop-color="#0a0a0f"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#fbbf24" stop-opacity="0.20"/>
      <stop offset="1" stop-color="#f59e0b" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="ring" x1="0.18" y1="0" x2="0.82" y2="1">${AMBER_STOPS}
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="228" fill="url(#tile)"/>
  <rect x="1.5" y="1.5" width="1021" height="1021" rx="227" fill="none" stroke="#2c2c38" stroke-width="3"/>
  <circle cx="512" cy="470" r="400" fill="url(#halo)"/>
  <path d="${RING_PATH}" fill="url(#ring)"/>
  <path d="${SPARK_PATH}" fill="#fffaf0"/>
</svg>
`
}

/**
 * The app-icon variant: identical shape, inset to leave a margin.
 *
 * A full-bleed tile reads oversized next to native apps, which reserve the outer
 * band of the canvas. The transform keeps the approved proportions exactly and
 * just scales them to 960 within 1024.
 */
function appIconArtwork() {
  const inner = colourArtwork()
    .replace(/^<svg[^>]*>\n/, '')
    .replace(/<\/svg>\n?$/, '')
    .replace(/<title>.*<\/title>\n\s*/, '')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Clarity app icon</title>
  <g transform="translate(32,32) scale(0.9375)">
${inner}  </g>
</svg>
`
}

/** The bare mark with no tile, for light surfaces and print. */
function markArtwork() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <title>Clarity mark</title>
  <defs>
    <linearGradient id="ring" x1="0.18" y1="0" x2="0.82" y2="1">${AMBER_STOPS}
    </linearGradient>
  </defs>
  <path d="${RING_PATH}" fill="url(#ring)"/>
  <path d="${SPARK_PATH}" fill="#f59e0b"/>
</svg>
`
}

/**
 * Monochrome tray glyph, drawn on the pixel grid at its target size.
 *
 * Deliberately not a scaled copy of the master: macOS renders the tray image as
 * a template, discarding colour and keeping only the silhouette, so the stroke
 * has to land on whole pixels or it turns to mush. 2.4px at 16, 4.8px at 32.
 * The open right side is what stops the silhouette collapsing into a disc, and
 * it leaves clear space for the status dot `overlayDotOnBitmap` composites in.
 *
 * The core is a plain diamond rather than the master's curved four-point spark —
 * concave sides cannot be expressed in 5 pixels. It is sized to 52% of the
 * counter, matching the master's 51%, because a smaller one rasterized to a
 * single pixel and made the whole mark read as a © symbol.
 */
function trayGlyph(size) {
  if (size !== 16 && size !== 32) throw new Error(`no tuned tray glyph for ${size}px`)
  const g = size === 16
    ? {
      ring: 'M13.871 4.188 A7 7 0 1 0 13.871 11.812 L11.858 10.505 A4.6 4.6 0 1 1 11.858 5.495 Z',
      spark: 'M8 5.6 L10.4 8 L8 10.4 L5.6 8 Z',
    }
    : {
      ring: 'M27.742 8.376 A14 14 0 1 0 27.742 23.624 L23.716 21.010 A9.2 9.2 0 1 1 23.716 10.990 Z',
      spark: 'M16 11.2 L20.8 16 L16 20.8 L11.2 16 Z',
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <title>Clarity tray glyph</title>
  <!-- Black on transparency: macOS uses the alpha channel and inverts for the
       menu bar theme; Windows/Linux recolour it via recolorBitmap(). -->
  <g fill="#000000">
    <path d="${g.ring}"/>
    <path d="${g.spark}"/>
  </g>
</svg>
`
}

// ─── Rasterizing ────────────────────────────────────────────

/**
 * Render SVG sources to PNG/JPEG inside Electron.
 *
 * Drawn through a canvas rather than `capturePage()`, which is subject to the
 * window's own compositing — the canvas gives exact dimensions and a clean alpha
 * channel, which the tray template images depend on absolutely.
 */
function rasterize(jobs) {
  const dir = mkdtempSync(path.join(tmpdir(), 'clarity-icons-'))
  const payload = path.join(dir, 'jobs.json')
  writeFileSync(payload, JSON.stringify(jobs), 'utf-8')

  const main = path.join(dir, 'main.js')
  writeFileSync(main, `
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync, mkdirSync } = require('fs')
const path = require('path')
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')

const jobs = JSON.parse(readFileSync(${JSON.stringify(payload)}, 'utf-8'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<html><body></body></html>')

  for (const job of jobs) {
    const dataUrl = await win.webContents.executeJavaScript(\`
      new Promise((resolve, reject) => {
        const svg = \${JSON.stringify(job.svg)};
        const size = \${job.size};
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = size; c.height = size;
          const ctx = c.getContext('2d');
          ctx.clearRect(0, 0, size, size);
          if (\${JSON.stringify(job.flatten || null)}) {
            ctx.fillStyle = \${JSON.stringify(job.flatten || '#000000')};
            ctx.fillRect(0, 0, size, size);
          }
          ctx.drawImage(img, 0, 0, size, size);
          resolve(c.toDataURL(\${JSON.stringify(job.mime || 'image/png')}, 0.95));
        };
        img.onerror = () => reject(new Error('svg decode failed'));
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
      })
    \`, true)

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    mkdirSync(path.dirname(job.out), { recursive: true })
    writeFileSync(job.out, Buffer.from(base64, 'base64'))
    console.log('wrote ' + job.out)
  }
  app.exit(0)
}).catch((err) => { console.error('RASTER_FAIL ' + (err && err.message)); app.exit(1) })
`, 'utf-8')

  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'raster', main: 'main.js' }), 'utf-8')

  const electron = path.join(ROOT, 'node_modules', '.bin', 'electron')
  const res = spawnSync(electron, [dir], { stdio: 'inherit' })
  rmSync(dir, { recursive: true, force: true })
  if (res.status !== 0) throw new Error('rasterizing failed')
}

// ─── ICO container ──────────────────────────────────────────

/**
 * Assemble a Windows `.ico` from PNG entries.
 *
 * Windows has accepted PNG-compressed ICO entries since Vista, so this is a
 * 6-byte header plus one 16-byte directory entry per image plus the PNG bytes.
 * Writing it here avoids depending on an image toolchain that Windows CI would
 * also have to install.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(entries.length, 4)

  const dir = Buffer.alloc(16 * entries.length)
  let offset = header.length + dir.length
  entries.forEach((entry, i) => {
    const at = i * 16
    // 0 encodes 256 — a single byte cannot hold it.
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at)
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1)
    dir.writeUInt8(0, at + 2) // palette size (0 = not paletted)
    dir.writeUInt8(0, at + 3) // reserved
    dir.writeUInt16LE(1, at + 4) // colour planes
    dir.writeUInt16LE(32, at + 6) // bits per pixel
    dir.writeUInt32LE(entry.data.length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entry.data.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.data)])
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  const svgColour = colourArtwork()
  const svgAppIcon = appIconArtwork()
  const svgMark = markArtwork()

  // 1. Vector masters — the source everything else derives from.
  const vectors = [
    ['docs/logo.svg', svgColour],
    ['docs/logo-app-icon.svg', svgAppIcon],
    ['docs/logo-mark.svg', svgMark],
    ['docs/tray-glyph.svg', trayGlyph(32)],
  ]
  for (const [rel, svg] of vectors) {
    const out = path.join(ROOT, rel)
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, svg, 'utf-8')
    console.log('wrote ' + out)
  }

  const jobs = []
  const P = (rel) => path.join(ROOT, rel)

  // 2. Full-colour PNGs. resources/icons/{48..512} is the Linux app icon set;
  //    16 and 32 in that folder are the tray glyphs instead (see below).
  for (const size of [48, 64, 128, 256, 512]) {
    jobs.push({ svg: svgAppIcon, size, out: P(`resources/icons/${size}x${size}.png`) })
  }

  // 3. Monochrome tray glyphs — pixel-tuned per size, never scaled.
  for (const size of [16, 32]) {
    jobs.push({ svg: trayGlyph(size), size, out: P(`resources/icons/${size}x${size}.png`) })
  }

  // 4. The 1024 app icon, plus the in-app and README copies.
  jobs.push({ svg: svgAppIcon, size: 1024, out: P('resources/icon.png') })
  jobs.push({ svg: svgColour, size: 512, out: P('logo.png') })
  jobs.push({ svg: svgColour, size: 512, out: P('src/renderer/src/assets/logo.png') })
  jobs.push({ svg: svgColour, size: 512, out: P('docs/logo.png') })
  // JPEG cannot carry alpha; the tile is opaque anyway, so flatten to its own
  // darkest stop rather than to white.
  jobs.push({ svg: svgColour, size: 512, out: P('docs/logo.jpeg'), mime: 'image/jpeg', flatten: '#0a0a0f' })

  // 5. ICO members. Windows renders the app icon at these sizes.
  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoDir = path.join(ROOT, 'resources', '.ico-src')
  for (const size of icoSizes) {
    jobs.push({ svg: svgAppIcon, size, out: path.join(icoDir, `${size}.png`) })
  }

  // 6. icns members, in the names iconutil expects.
  const iconset = path.join(ROOT, 'resources', 'Clarity.iconset')
  const icnsMembers = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of icnsMembers) {
    jobs.push({ svg: svgAppIcon, size, out: path.join(iconset, name) })
  }

  rasterize(jobs)

  // 7. Assemble the ICO.
  const { readFileSync, unlinkSync } = require('fs')
  const icoEntries = icoSizes.map((size) => ({
    size,
    data: readFileSync(path.join(icoDir, `${size}.png`)),
  }))
  writeFileSync(P('resources/icon.ico'), buildIco(icoEntries))
  console.log('wrote ' + P('resources/icon.ico'))
  rmSync(icoDir, { recursive: true, force: true })

  // 8. Assemble the ICNS (macOS only — iconutil ships with the OS).
  if (process.platform === 'darwin') {
    const res = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', P('resources/icon.icns')], { stdio: 'inherit' })
    if (res.status !== 0) throw new Error('iconutil failed')
    console.log('wrote ' + P('resources/icon.icns'))
  } else {
    console.log('skipped resources/icon.icns — iconutil is macOS-only; the committed file stands')
  }
  rmSync(iconset, { recursive: true, force: true })

  console.log('\nDone. Vector masters live in docs/; every raster is derived from them.')
}

main()
