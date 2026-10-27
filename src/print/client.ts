import { loadCalibration } from '../calibration/store'
import { bytesToBase64, canvasToEscPos } from './escposRaster'
import { renderReceiptCanvas } from './receiptLayout'
import type { ReceiptData } from './types'

type PrintResponse = {
  ok?: boolean
  error?: string
}

/** @deprecated Use printReceipt — kept as alias for older call sites. */
export type ScorePrintRequest = ReceiptData

/**
 * Fire-and-forget full receipt print (score + map + logo).
 * Respects kalibrering → «Skriv ut poeng ved fasit».
 */
export function printReceipt(data: ReceiptData): void {
  if (!loadCalibration().printEnabled) return

  void (async () => {
    try {
      const canvas = await renderReceiptCanvas(data)
      const escpos = canvasToEscPos(canvas)
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escposBase64: bytesToBase64(escpos) }),
      })
      const body = (await res.json()) as PrintResponse
      if (!res.ok || !body.ok) {
        console.warn('[print]', body.error ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      console.warn('[print]', err)
    }
  })()
}

/** Alias used by game reveal. */
export const printRoundScore = printReceipt
