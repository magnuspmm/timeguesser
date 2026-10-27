import type { Challenge, ChallengesFile } from './types'
import { normalizeYear } from './types'

export function emptyChallengesFile(): ChallengesFile {
  return { challenges: [] }
}

export async function fetchChallenges(): Promise<ChallengesFile> {
  try {
    const res = await fetch('/api/challenges')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as ChallengesFile
    if (!Array.isArray(data.challenges)) return emptyChallengesFile()
    return { challenges: data.challenges }
  } catch {
    // Fallback: static file (preview / uten API)
    try {
      const res = await fetch('/challenges.json')
      if (!res.ok) return emptyChallengesFile()
      const data = (await res.json()) as ChallengesFile
      if (!Array.isArray(data.challenges)) return emptyChallengesFile()
      return { challenges: data.challenges }
    } catch {
      return emptyChallengesFile()
    }
  }
}

export async function saveChallenges(
  challenges: Challenge[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/challenges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenges }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      return { ok: false, error: err?.error ?? `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch {
    return {
      ok: false,
      error: 'Kunne ikke lagre (kjører du npm run dev?)',
    }
  }
}

export async function uploadChallengeImage(
  id: string,
  file: File,
): Promise<{ ok: true; image: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/challenges/image', {
      method: 'POST',
      headers: {
        'X-Challenge-Id': id,
        'X-Filename': file.name,
      },
      body: file,
    })
    const data = (await res.json().catch(() => null)) as {
      image?: string
      error?: string
    } | null
    if (!res.ok || !data?.image) {
      return { ok: false, error: data?.error ?? `HTTP ${res.status}` }
    }
    return { ok: true, image: data.image }
  } catch {
    return {
      ok: false,
      error: 'Kunne ikke laste opp bilde (kjører du npm run dev?)',
    }
  }
}

export function downloadChallengesJson(challenges: Challenge[]): void {
  const blob = new Blob(
    [`${JSON.stringify({ challenges }, null, 2)}\n`],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'challenges.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function parseChallengesJson(text: string): Challenge[] {
  const data = JSON.parse(text) as ChallengesFile
  if (!Array.isArray(data.challenges)) {
    throw new Error('Ugyldig JSON: mangler challenges[]')
  }
  return data.challenges
    .filter(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.image === 'string' &&
        c.answer &&
        typeof c.answer.u === 'number' &&
        typeof c.answer.v === 'number',
    )
    .map((c) => {
      const year =
        typeof c.answer.year === 'number' ? normalizeYear(c.answer.year) : null
      if (year === null) {
        const { year: _drop, ...rest } = c.answer
        void _drop
        return { ...c, answer: rest }
      }
      return { ...c, answer: { ...c.answer, year } }
    })
}
