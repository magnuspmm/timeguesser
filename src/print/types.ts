import type { Point2 } from '../vision/homography'

/** Data for one thermal score receipt (game or preview sample). */
export type ReceiptData = {
  score: number
  totalScore: number
  round: number
  rounds: number
  /** Player guess in map UV (0..1). */
  player: Point2
  /** Fasit in map UV (0..1). */
  fasit: Point2
  /** Player year guess (omit when challenge has no year). */
  yearGuess?: number | null
  /** Fasit year (omit when challenge has no year). */
  yearFasit?: number | null
}

/** Canvas width matching typical 80mm ESC/POS at ~203 dpi. */
export const RECEIPT_WIDTH_PX = 576
