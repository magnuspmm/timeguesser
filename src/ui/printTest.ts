import { mountReceiptPreview } from '../print/preview'
import { renderNav } from './nav'

type PrintResponse = {
  ok?: boolean
  bytesWritten?: number
  printer?: string
  error?: string
}

export function mountPrintTest(root: HTMLElement): void {
  root.innerHTML = `
    <div class="app">
      <header class="header">
        <div class="brand">
          <h1>TimeGuesser</h1>
          <p class="tagline">Printer (MVP)</p>
        </div>
        <div class="header-meta">
          ${renderNav('print')}
        </div>
      </header>

      <div class="print-layout">
        <section class="panel print-test">
          <h2>Layout-preview</h2>
          <p class="muted">
            Eksempel på kvittering med poeng + kart (du / fasit).
            Kun forhåndsvisning — ikke koblet til spillogikk ennå.
          </p>
          <div id="receipt-preview-host"></div>
        </section>

        <section class="panel print-test">
          <h2>USB-test</h2>
          <p class="muted">
            Sender enkel ESC/POS-tekst direkte over USB til
            <code>GEZHI micro-printer</code>.
          </p>
          <div class="print-test-actions">
            <button type="button" class="btn primary" id="print-hello">
              Skriv ut «Hello World»
            </button>
          </div>
          <p class="print-status muted" id="print-status" aria-live="polite"></p>
        </section>
      </div>
    </div>
  `

  const previewHost = root.querySelector<HTMLElement>('#receipt-preview-host')!
  const preview = mountReceiptPreview(previewHost)
  ;(window as unknown as { __tgCleanup?: () => void }).__tgCleanup = () => {
    preview.destroy()
  }

  const btn = root.querySelector<HTMLButtonElement>('#print-hello')
  const status = root.querySelector<HTMLParagraphElement>('#print-status')
  if (!btn || !status) return

  const setStatus = (msg: string, kind: 'ok' | 'err' | 'info' = 'info') => {
    status.textContent = msg
    status.classList.toggle('print-status-ok', kind === 'ok')
    status.classList.toggle('print-status-err', kind === 'err')
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true
    setStatus('Sender til printer…', 'info')
    try {
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hello World' }),
      })
      const data = (await res.json()) as PrintResponse
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setStatus(
        `OK — ${data.bytesWritten ?? '?'} bytes til ${data.printer ?? 'printer'}`,
        'ok',
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(`Feil: ${msg}`, 'err')
    } finally {
      btn.disabled = false
    }
  })
}
