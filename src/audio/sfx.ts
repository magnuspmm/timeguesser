/**
 * Game SFX via uisfx (MIT runtime, CC0 audio recipes).
 * Sounds are synthesized locally in the browser — no network / CDN.
 */
import { createUISFX } from 'uisfx'

const ui = createUISFX({
  pack: 'organic',
  volume: 0.75,
  cooldownMs: 100,
})

const PLACE_CUE = 'snap' as const
const COUNTDOWN_CUE = 'progress-step' as const

let unlockPromise: Promise<void> | null = null

/** Unlock Web Audio + preload cues (call from a user gesture). */
export async function resumeAudio(): Promise<void> {
  if (!unlockPromise) {
    unlockPromise = (async () => {
      await ui.unlock()
      await ui.preload([PLACE_CUE, COUNTDOWN_CUE])
    })().catch(() => {
      unlockPromise = null
    })
  }
  await unlockPromise
}

/** Soft snap when a token settles on map or timeline. */
export function playPlace(): void {
  void resumeAudio()
  ui.play(PLACE_CUE, { cooldownMs: 100, retrigger: 'ignore' })
}

/**
 * Tick each countdown second. Slightly higher pitch as remaining seconds drop.
 * @param sec Remaining seconds (ceil), typically 3, 2, or 1
 */
export function playCountdownTick(sec: number): void {
  void resumeAudio()
  const clamped = Math.max(1, Math.min(3, Math.round(sec)))
  const playbackRate = 0.92 + (3 - clamped) * 0.14
  ui.play(COUNTDOWN_CUE, {
    playbackRate,
    retrigger: 'restart',
    cooldownMs: 0,
  })
}
