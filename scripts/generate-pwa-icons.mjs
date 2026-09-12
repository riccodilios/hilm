import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  }
  crcTable[n] = c
}

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function makeChunk(type, data) {
  const len = data.length
  const typeBuf = Buffer.from(type, 'ascii')
  const buf = Buffer.alloc(4 + 4 + len + 4)
  buf.writeUInt32BE(len, 0)
  typeBuf.copy(buf, 4)
  data.copy(buf, 8)
  const crc = crc32(Buffer.concat([typeBuf, data]))
  buf.writeUInt32BE(crc, 8 + len)
  return buf
}

function encodePNG(width, height, rgbaBuffer) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr)

  const stride = width * 4
  const raw = Buffer.alloc(height * (stride + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // No filter
    rgbaBuffer.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idatChunk = makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 }))
  const iendChunk = makeChunk('IEND', Buffer.alloc(0))
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk])
}

// Distance from point (px, py) to rounded rectangle with corners (0,0) to (w,h) and radius r
function distToRoundedRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r)
  const qy = Math.abs(py - h / 2) - (h / 2 - r)
  const outerX = Math.max(qx, 0)
  const outerY = Math.max(qy, 0)
  const outerDist = Math.hypot(outerX, outerY)
  const innerDist = Math.min(Math.max(qx, qy), 0)
  return outerDist + innerDist - r
}

// Distance to box (minX, minY) to (maxX, maxY)
function distToBox(px, py, minX, minY, maxX, maxY) {
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const hw = (maxX - minX) / 2
  const hh = (maxY - minY) / 2
  const qx = Math.abs(px - cx) - hw
  const qy = Math.abs(py - cy) - hh
  const outerX = Math.max(qx, 0)
  const outerY = Math.max(qy, 0)
  const outerDist = Math.hypot(outerX, outerY)
  const innerDist = Math.min(Math.max(qx, qy), 0)
  return outerDist + innerDist
}

// Hilm "H" distance function normalized to [0, 1] coordinate system
// In viewBox 0..128:
// H left stem: x in [38, 56], y in [34, 94]
// H right stem: x in [72, 90], y in [34, 94]
// H crossbar: x in [56, 72], y in [58, 74]
function distToH(nx, ny) {
  const dLeft = distToBox(nx, ny, 38 / 128, 34 / 128, 56 / 128, 94 / 128)
  const dRight = distToBox(nx, ny, 72 / 128, 34 / 128, 90 / 128, 94 / 128)
  const dCross = distToBox(nx, ny, 56 / 128, 58 / 128, 72 / 128, 74 / 128)
  return Math.min(dLeft, dRight, dCross)
}

function renderHilmIcon(size, { maskable = false } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const bgR = 0x0a, bgG = 0x0a, bgB = 0x0b // #0a0a0b
  const fgR = 0xf4, fgG = 0xf4, fgB = 0xf5 // #f4f4f5

  const rx = (28 / 128) * size
  const cornerRadius = maskable ? 0 : rx

  // Oversampling grid for smooth anti-aliasing (4x4 = 16 subpixels)
  const SAMPLES = 4
  const invSamplesSq = 1 / (SAMPLES * SAMPLES)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgCoverage = 0
      let fgCoverage = 0

      for (let sy = 0; sy < SAMPLES; sy++) {
        const py = y + (sy + 0.5) / SAMPLES
        const ny = py / size

        for (let sx = 0; sx < SAMPLES; sx++) {
          const px = x + (sx + 0.5) / SAMPLES
          const nx = px / size

          // Background check
          let inBg = true
          if (!maskable) {
            const dBg = distToRoundedRect(px, py, size, size, cornerRadius)
            if (dBg > 0) {
              inBg = false
            }
          }

          if (inBg) {
            bgCoverage++
            const dH = distToH(nx, ny)
            if (dH <= 0) {
              fgCoverage++
            }
          }
        }
      }

      const pixelIdx = (y * size + x) * 4
      if (bgCoverage === 0) {
        buf[pixelIdx] = 0
        buf[pixelIdx + 1] = 0
        buf[pixelIdx + 2] = 0
        buf[pixelIdx + 3] = 0
      } else {
        const alphaFraction = bgCoverage * invSamplesSq
        const fgFraction = fgCoverage / bgCoverage

        const r = Math.round(bgR * (1 - fgFraction) + fgR * fgFraction)
        const g = Math.round(bgG * (1 - fgFraction) + fgG * fgFraction)
        const b = Math.round(bgB * (1 - fgFraction) + fgB * fgFraction)
        const a = Math.round(255 * alphaFraction)

        buf[pixelIdx] = r
        buf[pixelIdx + 1] = g
        buf[pixelIdx + 2] = b
        buf[pixelIdx + 3] = a
      }
    }
  }

  return encodePNG(size, size, buf)
}

console.log('Rendering public/pwa-192.png (192x192)...')
const pwa192 = renderHilmIcon(192, { maskable: false })
fs.writeFileSync(path.join(publicDir, 'pwa-192.png'), pwa192)

console.log('Rendering public/pwa-512.png (512x512)...')
const pwa512 = renderHilmIcon(512, { maskable: false })
fs.writeFileSync(path.join(publicDir, 'pwa-512.png'), pwa512)

console.log('Rendering public/apple-touch-icon.png (192x192)...')
const appleTouch = renderHilmIcon(192, { maskable: false })
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouch)

console.log('Rendering public/pwa-maskable-512.png (512x512)...')
const maskable512 = renderHilmIcon(512, { maskable: true })
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512.png'), maskable512)

console.log('All icons generated successfully!')
