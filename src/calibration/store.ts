import type { Point2, Mat3 } from '../vision/homography'
import type { HsvRange } from '../vision/colorTrack'
import { DEFAULT_HSV } from '../vision/colorTrack'
import {
  DEFAULT_DIFF_THRESHOLD,
  type StoneRect,
} from '../vision/stoneTouch'
import {
  DEFAULT_YEAR_MAX,
  DEFAULT_YEAR_MIN,
  normalizeYearRange,
  type YearRange,
} from '../vision/yearField'

const KEY = 'timeguesser.calibration.v1'

export type YearFieldState = {
  /** Camera pixel corners of year strip: NW, NE, SE, SW */
  cameraCorners: Point2[] | null
  cameraToYear: Mat3 | null
  /** Left end of timeline */
  yearMin: number
  /** Right end of timeline */
  yearMax: number
}

export type StoneLockState = {
  /** Video-pixel rect around the physical lock stone */
  rect: StoneRect | null
  /** Serialized luminance baseline (row-major) */
  baseline: number[] | null
  baselineW: number
  baselineH: number
  /** Mean abs luma diff threshold (0–255) */
  diffThreshold: number
}

export type CalibrationState = {
  /** Camera pixel corners: NW, NE, SE, SW */
  cameraCorners: Point2[] | null
  cameraToMap: Mat3 | null
  hsv: HsvRange
  showMask: boolean
  /** Print round score on fasit reveal */
  printEnabled: boolean
  yearField: YearFieldState
  stone: StoneLockState
}

export const defaultYearField = (): YearFieldState => ({
  cameraCorners: null,
  cameraToYear: null,
  yearMin: DEFAULT_YEAR_MIN,
  yearMax: DEFAULT_YEAR_MAX,
})

export const defaultStone = (): StoneLockState => ({
  rect: null,
  baseline: null,
  baselineW: 0,
  baselineH: 0,
  diffThreshold: DEFAULT_DIFF_THRESHOLD,
})

export const defaultCalibration = (): CalibrationState => ({
  cameraCorners: null,
  cameraToMap: null,
  hsv: { ...DEFAULT_HSV },
  showMask: false,
  printEnabled: true,
  yearField: defaultYearField(),
  stone: defaultStone(),
})

function sanitizeYearField(
  partial?: Partial<YearFieldState>,
): YearFieldState {
  const base = defaultYearField()
  const merged = { ...base, ...(partial ?? {}) }
  const range = normalizeYearRange(merged.yearMin, merged.yearMax)
  return {
    cameraCorners: merged.cameraCorners ?? null,
    cameraToYear: merged.cameraToYear ?? null,
    yearMin: range?.min ?? DEFAULT_YEAR_MIN,
    yearMax: range?.max ?? DEFAULT_YEAR_MAX,
  }
}

function sanitizeStoneRect(rect: unknown): StoneRect | null {
  if (!rect || typeof rect !== 'object') return null
  const r = rect as Partial<StoneRect>
  const x = Number(r.x)
  const y = Number(r.y)
  const w = Number(r.w)
  const h = Number(r.h)
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null
  if (w < 8 || h < 8) return null
  return { x, y, w, h }
}

function sanitizeStone(partial?: Partial<StoneLockState>): StoneLockState {
  const base = defaultStone()
  const merged = { ...base, ...(partial ?? {}) }
  const threshold = Number(merged.diffThreshold)
  const bw = Math.max(0, Math.round(Number(merged.baselineW) || 0))
  const bh = Math.max(0, Math.round(Number(merged.baselineH) || 0))
  let baseline: number[] | null = null
  if (Array.isArray(merged.baseline) && bw > 0 && bh > 0) {
    const expected = bw * bh
    if (merged.baseline.length === expected) {
      baseline = merged.baseline.map((v) => Number(v) || 0)
    }
  }
  return {
    rect: sanitizeStoneRect(merged.rect),
    baseline,
    baselineW: baseline ? bw : 0,
    baselineH: baseline ? bh : 0,
    diffThreshold: Number.isFinite(threshold)
      ? Math.min(120, Math.max(5, threshold))
      : DEFAULT_DIFF_THRESHOLD,
  }
}

export function yearRangeFromCalib(state: CalibrationState): YearRange {
  return {
    min: state.yearField.yearMin,
    max: state.yearField.yearMax,
  }
}

export function loadCalibration(): CalibrationState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultCalibration()
    const parsed = JSON.parse(raw) as Partial<CalibrationState> & {
      yearField?: Partial<YearFieldState>
      stone?: Partial<StoneLockState>
    }
    return {
      ...defaultCalibration(),
      ...parsed,
      hsv: { ...DEFAULT_HSV, ...(parsed.hsv ?? {}) },
      printEnabled:
        typeof parsed.printEnabled === 'boolean'
          ? parsed.printEnabled
          : true,
      yearField: sanitizeYearField(parsed.yearField),
      stone: sanitizeStone(parsed.stone),
    }
  } catch {
    return defaultCalibration()
  }
}

export function saveCalibration(state: CalibrationState): void {
  try {
    const yearField = sanitizeYearField(state.yearField)
    const stone = sanitizeStone(state.stone)
    localStorage.setItem(
      KEY,
      JSON.stringify({
        cameraCorners: state.cameraCorners,
        cameraToMap: state.cameraToMap,
        hsv: state.hsv,
        showMask: state.showMask,
        printEnabled: state.printEnabled,
        yearField: {
          cameraCorners: yearField.cameraCorners,
          cameraToYear: yearField.cameraToYear,
          yearMin: yearField.yearMin,
          yearMax: yearField.yearMax,
        },
        stone: {
          rect: stone.rect,
          baseline: stone.baseline,
          baselineW: stone.baselineW,
          baselineH: stone.baselineH,
          diffThreshold: stone.diffThreshold,
        },
      }),
    )
  } catch {
    // ignore
  }
}

export function isYearFieldCalibrated(state: CalibrationState): boolean {
  return Boolean(state.yearField.cameraToYear && state.yearField.cameraCorners)
}

export function isStoneCalibrated(state: CalibrationState): boolean {
  const s = state.stone
  return Boolean(
    s.rect &&
      s.baseline &&
      s.baseline.length === s.baselineW * s.baselineH &&
      s.baselineW > 0 &&
      s.baselineH > 0,
  )
}
