export type StoneRect = {
  /** Top-left x in full video pixels */
  x: number
  /** Top-left y in full video pixels */
  y: number
  w: number
  h: number
}

export type StoneBaseline = {
  /** Luminance samples (0–255), row-major, size baselineW * baselineH */
  data: Float32Array
  baselineW: number
  baselineH: number
}

export type StoneTouchPhase = 'idle' | 'armed' | 'countdown' | 'locked'

export type StoneTouchSnapshot = {
  phase: StoneTouchPhase
  /** Mean absolute luminance diff vs baseline (0–255) */
  diff: number
  covered: boolean
  /** Seconds remaining in countdown (ceil), or null outside countdown */
  countdownSec: number | null
  /** Progress 0–1 through countdown */
  countdownProgress: number
}

export const DEFAULT_DIFF_THRESHOLD = 28
export const ARM_MS = 400
export const COUNTDOWN_MS = 3000
export const COOLDOWN_MS = 1000

/** Max edge for downsampled ROI baseline (keeps localStorage small). */
const BASELINE_MAX_EDGE = 48

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): StoneRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  return { x, y, w, h }
}

export function rectFromCorners(
  a: { x: number; y: number },
  b: { x: number; y: number },
): StoneRect | null {
  const r = normalizeRect(a, b)
  if (r.w < 8 || r.h < 8) return null
  return r
}

export function isStoneReady(opts: {
  rect: StoneRect | null
  baseline: number[] | null
  baselineW: number
  baselineH: number
}): boolean {
  return Boolean(
    opts.rect &&
      opts.rect.w >= 8 &&
      opts.rect.h >= 8 &&
      opts.baseline &&
      opts.baseline.length > 0 &&
      opts.baselineW > 0 &&
      opts.baselineH > 0,
  )
}

/**
 * Sample ROI luminance into a fixed-size grid.
 * `rect` is in full video pixels; `scaleX/Y` map process-canvas → video.
 */
export function sampleRoiLuma(
  imageData: ImageData,
  rect: StoneRect,
  scaleX: number,
  scaleY: number,
  outW?: number,
  outH?: number,
): StoneBaseline | null {
  if (rect.w < 4 || rect.h < 4) return null

  const procRect = {
    x: rect.x / scaleX,
    y: rect.y / scaleY,
    w: rect.w / scaleX,
    h: rect.h / scaleY,
  }

  const maxEdge = BASELINE_MAX_EDGE
  let bw = outW
  let bh = outH
  if (!bw || !bh) {
    const aspect = procRect.w / procRect.h
    if (procRect.w >= procRect.h) {
      bw = Math.min(maxEdge, Math.max(8, Math.round(procRect.w)))
      bh = Math.max(4, Math.round(bw / aspect))
    } else {
      bh = Math.min(maxEdge, Math.max(8, Math.round(procRect.h)))
      bw = Math.max(4, Math.round(bh * aspect))
    }
  }

  const { width, height, data } = imageData
  const out = new Float32Array(bw * bh)

  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const u = (i + 0.5) / bw
      const v = (j + 0.5) / bh
      const px = Math.round(procRect.x + u * procRect.w)
      const py = Math.round(procRect.y + v * procRect.h)
      if (px < 0 || py < 0 || px >= width || py >= height) {
        out[j * bw + i] = 0
        continue
      }
      const o = (py * width + px) * 4
      out[j * bw + i] = luma(data[o], data[o + 1], data[o + 2])
    }
  }

  return { data: out, baselineW: bw, baselineH: bh }
}

export function roiDiff(baseline: Float32Array, current: Float32Array): number {
  const n = Math.min(baseline.length, current.length)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += Math.abs(baseline[i] - current[i])
  }
  return sum / n
}

export type StoneTouchDetectorOptions = {
  threshold?: number
  armMs?: number
  countdownMs?: number
  cooldownMs?: number
}

/**
 * Frame-driven state machine for hand-on-stone detection.
 * Call `update(covered, nowMs)` each animation frame.
 */
export class StoneTouchDetector {
  private phase: StoneTouchPhase = 'idle'
  private coverStartedAt: number | null = null
  private countdownStartedAt: number | null = null
  private cooldownUntil = 0
  private lastDiff = 0

  readonly armMs: number
  readonly countdownMs: number
  readonly cooldownMs: number
  threshold: number

  constructor(opts: StoneTouchDetectorOptions = {}) {
    this.threshold = opts.threshold ?? DEFAULT_DIFF_THRESHOLD
    this.armMs = opts.armMs ?? ARM_MS
    this.countdownMs = opts.countdownMs ?? COUNTDOWN_MS
    this.cooldownMs = opts.cooldownMs ?? COOLDOWN_MS
  }

  reset(): void {
    this.phase = 'idle'
    this.coverStartedAt = null
    this.countdownStartedAt = null
    this.lastDiff = 0
  }

  /** Soft reset after answer lock so next round can arm again. */
  resetAfterLock(nowMs: number): void {
    this.phase = 'idle'
    this.coverStartedAt = null
    this.countdownStartedAt = null
    this.cooldownUntil = nowMs + this.cooldownMs
  }

  getSnapshot(): StoneTouchSnapshot {
    return this.buildSnapshot(this.lastDiff, false, performance.now())
  }

  /**
   * @returns true once when countdown completes (transition into locked).
   */
  update(diff: number, nowMs: number): { locked: boolean; snapshot: StoneTouchSnapshot } {
    this.lastDiff = diff
    const covered = diff >= this.threshold

    if (nowMs < this.cooldownUntil) {
      this.phase = 'idle'
      this.coverStartedAt = null
      this.countdownStartedAt = null
      return { locked: false, snapshot: this.buildSnapshot(diff, covered, nowMs) }
    }

    if (this.phase === 'locked') {
      return { locked: false, snapshot: this.buildSnapshot(diff, covered, nowMs) }
    }

    if (!covered) {
      if (this.phase === 'countdown' || this.phase === 'armed') {
        this.cooldownUntil = nowMs + this.cooldownMs
      }
      this.phase = 'idle'
      this.coverStartedAt = null
      this.countdownStartedAt = null
      return { locked: false, snapshot: this.buildSnapshot(diff, covered, nowMs) }
    }

    // covered
    if (this.coverStartedAt === null) {
      this.coverStartedAt = nowMs
    }
    const coverDur = nowMs - this.coverStartedAt

    if (coverDur < this.armMs) {
      this.phase = 'idle'
      return { locked: false, snapshot: this.buildSnapshot(diff, covered, nowMs) }
    }

    if (this.phase === 'idle') {
      this.phase = 'armed'
      this.countdownStartedAt = nowMs
    }

    if (this.phase === 'armed' || this.phase === 'countdown') {
      this.phase = 'countdown'
      if (this.countdownStartedAt === null) {
        this.countdownStartedAt = nowMs
      }
      const elapsed = nowMs - this.countdownStartedAt
      if (elapsed >= this.countdownMs) {
        this.phase = 'locked'
        return { locked: true, snapshot: this.buildSnapshot(diff, covered, nowMs) }
      }
    }

    return { locked: false, snapshot: this.buildSnapshot(diff, covered, nowMs) }
  }

  private buildSnapshot(
    diff: number,
    covered: boolean,
    nowMs: number,
  ): StoneTouchSnapshot {
    let countdownSec: number | null = null
    let countdownProgress = 0
    if (
      (this.phase === 'countdown' || this.phase === 'armed') &&
      this.countdownStartedAt !== null
    ) {
      const elapsed = Math.max(0, nowMs - this.countdownStartedAt)
      const remaining = Math.max(0, this.countdownMs - elapsed)
      countdownSec = Math.max(1, Math.ceil(remaining / 1000))
      if (remaining <= 0) countdownSec = 0
      countdownProgress = Math.min(1, elapsed / this.countdownMs)
    } else if (this.phase === 'locked') {
      countdownSec = 0
      countdownProgress = 1
    }
    return {
      phase: this.phase,
      diff,
      covered,
      countdownSec,
      countdownProgress,
    }
  }
}
