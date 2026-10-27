/**
 * Convert a receipt canvas to ESC/POS raster bytes (GS v 0) with
 * Floyd–Steinberg dithering so the map survives 1-bit thermal ink.
 */

function floydSteinbergMono(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  // Working buffer: 0 = black ink, 1 = white paper (luminance 0..1)
  const lum = new Float32Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    const a = rgba[o + 3]! / 255
    const r = rgba[o]!
    const g = rgba[o + 1]!
    const b = rgba[o + 2]!
    const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    // Transparent → white
    lum[i] = a < 0.08 ? 1 : y
  }

  const mono = new Uint8Array(width * height) // 1 = black dot
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const old = lum[i]!
      const value = old < 0.5 ? 0 : 1
      mono[i] = value === 0 ? 1 : 0
      const err = old - value
      if (x + 1 < width) lum[i + 1]! += err * (7 / 16)
      if (y + 1 < height) {
        if (x > 0) lum[i + width - 1]! += err * (3 / 16)
        lum[i + width]! += err * (5 / 16)
        if (x + 1 < width) lum[i + width + 1]! += err * (1 / 16)
      }
    }
  }
  return mono
}

function packRaster(
  mono: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const byteWidth = Math.ceil(width / 8)
  const raster = new Uint8Array(byteWidth * height)
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < byteWidth; bx++) {
      let byte = 0
      for (let bit = 0; bit < 8; bit++) {
        const x = bx * 8 + bit
        if (x < width && mono[y * width + x]) {
          byte |= 0x80 >> bit
        }
      }
      raster[y * byteWidth + bx] = byte
    }
  }
  return raster
}

/** Build GS v 0 + init/feed/cut around a canvas image. */
export function canvasToEscPos(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')

  const width = canvas.width
  const height = canvas.height
  if (width <= 0 || height <= 0) throw new Error('Tom canvas')
  if (height > 65535) throw new Error('Kvittering for høy for ESC/POS')

  const { data } = ctx.getImageData(0, 0, width, height)
  const mono = floydSteinbergMono(data, width, height)
  const raster = packRaster(mono, width, height)
  const byteWidth = Math.ceil(width / 8)

  const header = new Uint8Array([
    0x1b,
    0x40, // ESC @ init
    0x1b,
    0x61,
    0x01, // center
    0x1d,
    0x76,
    0x30,
    0x00, // GS v 0 m=0
    byteWidth & 0xff,
    (byteWidth >> 8) & 0xff,
    height & 0xff,
    (height >> 8) & 0xff,
  ])

  const footer = new Uint8Array([
    0x0a,
    0x0a,
    0x0a,
    0x1d,
    0x56,
    0x00, // cut
  ])

  const out = new Uint8Array(header.length + raster.length + footer.length)
  out.set(header, 0)
  out.set(raster, header.length)
  out.set(footer, header.length + raster.length)
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
