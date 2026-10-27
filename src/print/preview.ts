import { bytesToBase64, canvasToEscPos } from './escposRaster'
import { renderReceiptCanvas } from './receiptLayout'
import { SAMPLE_RECEIPT, randomSampleReceipt } from './sample'
import type { ReceiptData } from './types'

export type ReceiptPreview = {
  /** Re-render with given (or sample) data. */
  render: (data?: ReceiptData) => Promise<void>
  destroy: () => void
}

/**
 * Mounts an on-screen thermal-paper preview of the receipt layout.
 * MVP only — not wired into game reveal yet.
 */
export function mountReceiptPreview(host: HTMLElement): ReceiptPreview {
  host.innerHTML = `
    <div class="receipt-preview">
      <div class="receipt-preview-toolbar">
        <button type="button" class="btn secondary" id="receipt-sample">
          Fast eksempel
        </button>
        <button type="button" class="btn secondary" id="receipt-random">
          Tilfeldig eksempel
        </button>
        <button type="button" class="btn primary" id="receipt-print">
          Skriv ut preview
        </button>
      </div>
      <div class="receipt-paper-wrap">
        <canvas class="receipt-paper" id="receipt-canvas" aria-label="Forhåndsvisning av kvittering"></canvas>
      </div>
      <p class="receipt-preview-meta muted" id="receipt-meta"></p>
    </div>
  `

  const canvas = host.querySelector<HTMLCanvasElement>('#receipt-canvas')!
  const meta = host.querySelector<HTMLElement>('#receipt-meta')!
  const sampleBtn = host.querySelector<HTMLButtonElement>('#receipt-sample')!
  const randomBtn = host.querySelector<HTMLButtonElement>('#receipt-random')!
  const printBtn = host.querySelector<HTMLButtonElement>('#receipt-print')!

  let cancelled = false
  let current: ReceiptData = SAMPLE_RECEIPT

  async function render(data: ReceiptData = SAMPLE_RECEIPT): Promise<void> {
    current = data
    meta.textContent = 'Renderer…'
    try {
      const offscreen = await renderReceiptCanvas(data)
      if (cancelled) return
      canvas.width = offscreen.width
      canvas.height = offscreen.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('2D context unavailable')
      ctx.drawImage(offscreen, 0, 0)
      meta.textContent = `${offscreen.width}×${offscreen.height} px · runde ${data.round}/${data.rounds} · ${data.score} poeng`
    } catch (err) {
      if (cancelled) return
      meta.textContent =
        err instanceof Error ? err.message : 'Kunne ikke rendere preview'
    }
  }

  sampleBtn.addEventListener('click', () => {
    void render(SAMPLE_RECEIPT)
  })
  randomBtn.addEventListener('click', () => {
    void render(randomSampleReceipt())
  })
  printBtn.addEventListener('click', () => {
    void (async () => {
      printBtn.disabled = true
      sampleBtn.disabled = true
      randomBtn.disabled = true
      const prev = meta.textContent
      meta.textContent = 'Skriver ut preview…'
      try {
        // Re-render fresh so we print exactly the current sample layout
        const offscreen = await renderReceiptCanvas(current)
        if (cancelled) return
        canvas.width = offscreen.width
        canvas.height = offscreen.height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('2D context unavailable')
        ctx.drawImage(offscreen, 0, 0)

        const escpos = canvasToEscPos(canvas)
        const res = await fetch('/api/print', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ escposBase64: bytesToBase64(escpos) }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          error?: string
          bytesWritten?: number
        }
        if (!res.ok || !data.ok) {
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        meta.textContent = `Skrevet ut · ${data.bytesWritten ?? escpos.length} bytes`
      } catch (err) {
        if (cancelled) return
        meta.textContent =
          err instanceof Error ? `Utskrift feilet: ${err.message}` : 'Utskrift feilet'
        if (prev) {
          // keep error visible; no auto-restore
        }
      } finally {
        printBtn.disabled = false
        sampleBtn.disabled = false
        randomBtn.disabled = false
      }
    })()
  })

  void render(SAMPLE_RECEIPT)

  return {
    render,
    destroy() {
      cancelled = true
      host.innerHTML = ''
    },
  }
}
