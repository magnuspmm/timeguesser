export type HsvRange = {
  /** Hue center 0–360 */
  h: number
  /** Hue half-width in degrees */
  hTol: number
  /** Saturation min 0–1 */
  sMin: number
  /** Value (brightness) min 0–1 */
  vMin: number
}

export type TrackResult = {
  x: number
  y: number
  area: number
  found: boolean
}

/**
 * Restrict tracking to map UV space (with buffer).
 * `cameraToMap` maps full-resolution video pixels → normalized map (u,v).
 * `scaleX/Y` convert process-canvas pixels → video pixels.
 */
export type MapTrackRoi = {
  cameraToMap: import('./homography').Mat3
  scaleX: number
  scaleY: number
  /** Margin in map UV beyond [0,1] (default ~0.08). */
  buffer: number
}

export const DEFAULT_HSV: HsvRange = {
  h: 0,
  hTol: 18,
  sMin: 0.35,
  vMin: 0.25,
}

function rgbToHsv(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; v: number } {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const s = max === 0 ? 0 : d / max
  return { h, s, v: max }
}

function hueInRange(h: number, center: number, tol: number): boolean {
  const d = Math.min(Math.abs(h - center), 360 - Math.abs(h - center))
  return d <= tol
}

/** Sample HSV at a pixel (image coords) from ImageData. */
export function sampleHsvAt(
  imageData: ImageData,
  x: number,
  y: number,
): { h: number; s: number; v: number } | null {
  const ix = Math.round(x)
  const iy = Math.round(y)
  if (ix < 0 || iy < 0 || ix >= imageData.width || iy >= imageData.height) {
    return null
  }
  const i = (iy * imageData.width + ix) * 4
  const d = imageData.data
  return rgbToHsv(d[i], d[i + 1], d[i + 2])
}

function pixelInMapRoi(
  px: number,
  py: number,
  roi: MapTrackRoi,
): boolean {
  const { cameraToMap: h, scaleX, scaleY, buffer } = roi
  const x = px * scaleX
  const y = py * scaleY
  const w = h[6] * x + h[7] * y + h[8]
  if (Math.abs(w) < 1e-12) return false
  const u = (h[0] * x + h[1] * y + h[2]) / w
  const v = (h[3] * x + h[4] * y + h[5]) / w
  return (
    u >= -buffer &&
    u <= 1 + buffer &&
    v >= -buffer &&
    v <= 1 + buffer
  )
}

/**
 * Find largest blob matching HSV range.
 * When `roi` is set, only pixels inside the buffered map quad are considered.
 * Writes binary mask into maskOut if provided (255 = match).
 */
export function trackColor(
  imageData: ImageData,
  range: HsvRange,
  maskOut?: Uint8ClampedArray,
  roi?: MapTrackRoi | null,
): TrackResult {
  const { width, height, data } = imageData
  const visited = new Uint8Array(width * height)
  let bestArea = 0
  let bestCx = 0
  let bestCy = 0

  // Precompute match mask for flood fill + optional debug
  const matchBuf = maskOut ?? new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const px = i % width
    const py = (i / width) | 0
    if (roi && !pixelInMapRoi(px, py, roi)) {
      matchBuf[i] = 0
      continue
    }
    const o = i * 4
    const { h, s, v } = rgbToHsv(data[o], data[o + 1], data[o + 2])
    matchBuf[i] =
      hueInRange(h, range.h, range.hTol) && s >= range.sMin && v >= range.vMin
        ? 255
        : 0
  }

  const minArea = Math.max(40, (width * height) * 0.00015)

  for (let start = 0; start < width * height; start++) {
    if (visited[start] || matchBuf[start] === 0) continue

    let area = 0
    let sumX = 0
    let sumY = 0
    const stack = [start]
    visited[start] = 1

    while (stack.length) {
      const idx = stack.pop()!
      const x = idx % width
      const y = (idx / width) | 0
      area++
      sumX += x
      sumY += y

      const candidates = [
        x > 0 ? idx - 1 : -1,
        x < width - 1 ? idx + 1 : -1,
        y > 0 ? idx - width : -1,
        y < height - 1 ? idx + width : -1,
      ]
      for (const n of candidates) {
        if (n < 0 || visited[n] || matchBuf[n] === 0) continue
        visited[n] = 1
        stack.push(n)
      }
    }

    if (area > bestArea && area >= minArea) {
      bestArea = area
      bestCx = sumX / area
      bestCy = sumY / area
    }
  }

  if (bestArea === 0) {
    return { x: 0, y: 0, area: 0, found: false }
  }
  return { x: bestCx, y: bestCy, area: bestArea, found: true }
}

/** Downscale for faster tracking; returns image + scale factor to original. */
export function drawVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth = 480,
): { imageData: ImageData; scaleX: number; scaleY: number } {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) {
    return {
      imageData: new ImageData(1, 1),
      scaleX: 1,
      scaleY: 1,
    }
  }
  const scale = Math.min(1, maxWidth / vw)
  const w = Math.max(1, Math.round(vw * scale))
  const h = Math.max(1, Math.round(vh * scale))
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(video, 0, 0, w, h)
  return {
    imageData: ctx.getImageData(0, 0, w, h),
    scaleX: vw / w,
    scaleY: vh / h,
  }
}
