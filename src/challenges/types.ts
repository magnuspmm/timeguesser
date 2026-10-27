export type ChallengeAnswer = {
  u: number
  v: number
  /** Fasit-årstall (4 siffer), valgfritt. */
  year?: number
}

export type Challenge = {
  id: string
  /** Relativ sti under public/, f.eks. "challenges/abc.jpg" */
  image: string
  answer: ChallengeAnswer
}

export type ChallengesFile = {
  challenges: Challenge[]
}

export function hasYearAnswer(c: Challenge): boolean {
  return typeof c.answer.year === 'number' && Number.isFinite(c.answer.year)
}

export function normalizeYear(year: number): number | null {
  const y = Math.round(year)
  if (y < 1000 || y > 9999) return null
  return y
}
