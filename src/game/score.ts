import type { Point2 } from '../vision/homography'

/** Max poeng per utfordring (GeoGuessr-lignende skala). */
export const MAX_SCORE = 5000

/** Euclidean distance in normalized map space (0..√2). */
export function mapDistance(a: Point2, b: Point2): number {
  const du = a.x - b.x
  const dv = a.y - b.y
  return Math.hypot(du, dv)
}

/**
 * Score from guess vs fasit in UV-space.
 * Perfect hit → 5000; falls off with distance across the map diagonal.
 */
export function scoreGuess(
  player: Point2,
  answer: Point2,
): { score: number; distance: number } {
  const distance = mapDistance(player, answer)
  const maxDist = Math.SQRT2
  const t = Math.min(1, distance / maxDist)
  // Smooth falloff: close guesses stay high, far ones drop quickly
  const score = Math.round(MAX_SCORE * (1 - t) ** 2)
  return { score, distance }
}

/**
 * Score from guessed year vs fasit.
 * Exact → 5000; falls off with absolute year difference (soft at ±50 years).
 */
export function scoreYear(
  guess: number,
  answer: number,
): { score: number; yearDelta: number } {
  const yearDelta = Math.abs(Math.round(guess) - Math.round(answer))
  const maxDelta = 50
  const t = Math.min(1, yearDelta / maxDelta)
  const score = Math.round(MAX_SCORE * (1 - t) ** 2)
  return { score, yearDelta }
}

/**
 * Combine location and/or year scores into one round score (0–MAX_SCORE).
 * Parts that are present are averaged.
 */
export function combineRoundScore(parts: number[]): number {
  if (parts.length === 0) return 0
  const sum = parts.reduce((a, b) => a + b, 0)
  return Math.round(sum / parts.length)
}
