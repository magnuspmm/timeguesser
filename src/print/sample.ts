import type { ReceiptData } from './types'

/** Fixed sample so layout previews stay comparable. */
export const SAMPLE_RECEIPT: ReceiptData = {
  score: 3720,
  totalScore: 9140,
  round: 2,
  rounds: 5,
  player: { x: 0.42, y: 0.58 },
  fasit: { x: 0.61, y: 0.41 },
  yearGuess: 1968,
  yearFasit: 1975,
}

export function randomSampleReceipt(): ReceiptData {
  const player = {
    x: 0.15 + Math.random() * 0.7,
    y: 0.15 + Math.random() * 0.7,
  }
  const fasit = {
    x: Math.min(0.92, Math.max(0.08, player.x + (Math.random() - 0.5) * 0.35)),
    y: Math.min(0.92, Math.max(0.08, player.y + (Math.random() - 0.5) * 0.35)),
  }
  const score = 1800 + Math.round(Math.random() * 3200)
  const prev = Math.round(Math.random() * 12000)
  const yearFasit = 1850 + Math.floor(Math.random() * 170)
  const yearGuess = yearFasit + Math.round((Math.random() - 0.5) * 40)
  return {
    score,
    totalScore: prev + score,
    round: 1 + Math.floor(Math.random() * 5),
    rounds: 5,
    player,
    fasit,
    yearGuess,
    yearFasit,
  }
}
