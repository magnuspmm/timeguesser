import {
  applyHomography,
  computeHomography,
  invertHomography,
  type Mat3,
  type Point2,
} from './homography'

/** Timeline UV corners: NW, NE, SE, SW (u=0 → startår, u=1 → sluttår). */
export const YEAR_FIELD_CORNERS: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

export const DEFAULT_YEAR_MIN = 1850
export const DEFAULT_YEAR_MAX = 2025

/** Extra margin in timeline UV so edge tokens still track. */
export const YEAR_TRACK_BUFFER = 0.08

export type YearRange = {
  min: number
  max: number
}

export function normalizeYearRange(
  min: number,
  max: number,
): YearRange | null {
  const a = Math.round(min)
  const b = Math.round(max)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a < 1000 || b > 9999 || a >= b) return null
  return { min: a, max: b }
}

export function computeYearHomography(cameraCorners: Point2[]): Mat3 | null {
  return computeHomography(cameraCorners, YEAR_FIELD_CORNERS)
}

/** Project year UV → camera pixels. */
export function yearToPixel(cameraToYear: Mat3, uv: Point2): Point2 | null {
  const yearToCamera = invertHomography(cameraToYear)
  if (!yearToCamera) return null
  return applyHomography(yearToCamera, uv)
}

export function yearFieldOutline(cameraToYear: Mat3): Point2[] | null {
  const pts: Point2[] = []
  for (const c of YEAR_FIELD_CORNERS) {
    const p = yearToPixel(cameraToYear, c)
    if (!p) return null
    pts.push(p)
  }
  return pts
}

/** Center line of the timeline in camera pixels (for overlay). */
export function yearTimelineCenterLine(
  cameraToYear: Mat3,
): { start: Point2; end: Point2 } | null {
  const start = yearToPixel(cameraToYear, { x: 0, y: 0.5 })
  const end = yearToPixel(cameraToYear, { x: 1, y: 0.5 })
  if (!start || !end) return null
  return { start, end }
}

/** Pick a few readable tick years across the range. */
export function suggestTimelineTicks(range: YearRange): number[] {
  const { min, max } = range
  const span = max - min
  if (span <= 0) return [min, max]

  const stepCandidates = [1, 5, 10, 25, 50, 100, 250, 500]
  let step = stepCandidates[stepCandidates.length - 1]!
  for (const s of stepCandidates) {
    if (span / s <= 5) {
      step = s
      break
    }
  }

  const ticks: number[] = [min]
  const first = Math.ceil((min + 1) / step) * step
  for (let y = first; y < max; y += step) {
    ticks.push(y)
  }
  if (ticks[ticks.length - 1] !== max) ticks.push(max)
  return ticks
}

/** Tick marks along the timeline in camera space. */
export function yearTimelineTicks(
  cameraToYear: Mat3,
  range: YearRange,
  years?: number[],
): { year: number; pixel: Point2 }[] {
  const list = years ?? suggestTimelineTicks(range)
  const out: { year: number; pixel: Point2 }[] = []
  for (const year of list) {
    const u = yearToU(year, range)
    const pixel = yearToPixel(cameraToYear, { x: u, y: 0.5 })
    if (pixel) out.push({ year, pixel })
  }
  return out
}

export function yearToU(year: number, range: YearRange): number {
  return (year - range.min) / (range.max - range.min)
}

/** Map horizontal position on the timeline (u 0–1) to a calendar year. */
export function uToYear(u: number, range: YearRange): number {
  const t = Math.min(1, Math.max(0, u))
  return Math.round(range.min + t * (range.max - range.min))
}

/** Pixel → year via camera→timeline homography (uses u only). */
export function pixelToYear(
  cameraToYear: Mat3,
  pixel: Point2,
  range: YearRange,
): number {
  const uv = applyHomography(cameraToYear, pixel)
  return uToYear(uv.x, range)
}
