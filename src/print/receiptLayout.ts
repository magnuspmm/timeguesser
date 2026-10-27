import type { Point2 } from '../vision/homography'
import { RECEIPT_WIDTH_PX, type ReceiptData } from './types'

const MAP_SRC = '/map.png'
const LOGO_SRC = '/expology-logo.png'
/** Small wordmark width on the 576px receipt. */
const LOGO_WIDTH_PX = 160

let mapImagePromise: Promise<HTMLImageElement> | null = null
let logoImagePromise: Promise<HTMLImageElement> | null = null

function loadImage(src: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Kunne ikke laste ${label}`))
    img.src = src
  })
}

function loadMapImage(): Promise<HTMLImageElement> {
  if (!mapImagePromise) mapImagePromise = loadImage(MAP_SRC, '/map.png')
  return mapImagePromise
}

function loadLogoImage(): Promise<HTMLImageElement> {
  if (!logoImagePromise) {
    logoImagePromise = loadImage(LOGO_SRC, '/expology-logo.png')
  }
  return logoImagePromise
}

/**
 * Draw logo as solid black ink on white (source is purple on black).
 * Non-black colored pixels → black; near-black background → transparent/white.
 */
function drawBlackLogo(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  destW: number,
  destY: number,
): number {
  const destH = Math.round(destW * (logo.naturalHeight / logo.naturalWidth))
  const tmp = document.createElement('canvas')
  tmp.width = destW
  tmp.height = destH
  const tctx = tmp.getContext('2d')
  if (!tctx) return destY

  tctx.drawImage(logo, 0, 0, destW, destH)
  const image = tctx.getImageData(0, 0, destW, destH)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i]!
    const g = d[i + 1]!
    const b = d[i + 2]!
    const a = d[i + 3]!
    const isInk = a > 20 && Math.max(r, g, b) > 40
    d[i] = 0
    d[i + 1] = 0
    d[i + 2] = 0
    d[i + 3] = isInk ? 255 : 0
  }
  tctx.putImageData(image, 0, 0)

  const x = Math.round((RECEIPT_WIDTH_PX - destW) / 2)
  ctx.drawImage(tmp, x, destY)
  return destY + destH + 8
}

function drawCenteredText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  weight = '600',
): number {
  ctx.font = `${weight} ${size}px "IBM Plex Sans", system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#000'
  ctx.fillText(text, RECEIPT_WIDTH_PX / 2, y)
  return y + size * 1.25
}

function drawRule(ctx: CanvasRenderingContext2D, y: number): number {
  const pad = 24
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(pad, y)
  ctx.lineTo(RECEIPT_WIDTH_PX - pad, y)
  ctx.stroke()
  return y + 16
}

function drawMapSection(
  ctx: CanvasRenderingContext2D,
  map: HTMLImageElement,
  player: Point2,
  fasit: Point2,
  startY: number,
): number {
  const pad = 16
  const mapW = RECEIPT_WIDTH_PX - pad * 2
  const mapH = Math.round(mapW * (map.naturalHeight / map.naturalWidth))
  const x0 = pad
  const y0 = startY

  // Grayscale map (how thermal ink will read tones)
  ctx.save()
  ctx.filter = 'grayscale(1) contrast(1.15)'
  ctx.drawImage(map, x0, y0, mapW, mapH)
  ctx.restore()

  ctx.strokeStyle = '#000'
  ctx.lineWidth = 3
  ctx.strokeRect(x0 + 1.5, y0 + 1.5, mapW - 3, mapH - 3)

  const px = x0 + player.x * mapW
  const py = y0 + player.y * mapH
  const fx = x0 + fasit.x * mapW
  const fy = y0 + fasit.y * mapH

  // Line guess → fasit
  ctx.beginPath()
  ctx.moveTo(px, py)
  ctx.lineTo(fx, fy)
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 3
  ctx.setLineDash([10, 8])
  ctx.stroke()
  ctx.setLineDash([])

  // Player: filled circle (Du)
  ctx.beginPath()
  ctx.arc(px, py, 14, 0, Math.PI * 2)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.stroke()

  // Fasit: hollow circle with inner ring
  ctx.beginPath()
  ctx.arc(fx, fy, 14, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(fx, fy, 5, 0, Math.PI * 2)
  ctx.fillStyle = '#000'
  ctx.fill()

  // Legend under map
  let y = y0 + mapH + 18
  ctx.font = '500 22px "IBM Plex Sans", system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#000'

  const legendY = y + 8
  const mid = RECEIPT_WIDTH_PX / 2

  ctx.beginPath()
  ctx.arc(pad + 16, legendY, 9, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillText('Du', pad + 32, legendY)

  ctx.beginPath()
  ctx.arc(mid + 8, legendY, 9, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(mid + 8, legendY, 3.5, 0, Math.PI * 2)
  ctx.fillStyle = '#000'
  ctx.fill()
  ctx.fillText('Fasit', mid + 24, legendY)

  return y + 36
}

function hasYear(data: ReceiptData): boolean {
  return (
    typeof data.yearGuess === 'number' &&
    Number.isFinite(data.yearGuess) &&
    typeof data.yearFasit === 'number' &&
    Number.isFinite(data.yearFasit)
  )
}

/** Two-column year block: Ditt svar | Fasit */
function drawYearSection(
  ctx: CanvasRenderingContext2D,
  yearGuess: number,
  yearFasit: number,
  startY: number,
): number {
  const mid = RECEIPT_WIDTH_PX / 2
  let y = startY

  ctx.fillStyle = '#000'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '500 18px "IBM Plex Sans", system-ui, sans-serif'
  ctx.fillText('Ditt svar', mid / 2, y)
  ctx.fillText('Fasit', mid + mid / 2, y)
  y += 26

  ctx.font = '700 36px "IBM Plex Sans", system-ui, sans-serif'
  ctx.fillText(String(Math.round(yearGuess)), mid / 2, y)
  ctx.fillText(String(Math.round(yearFasit)), mid + mid / 2, y)
  return y + 48
}

/**
 * Renders a full receipt bitmap (white paper, black ink) ready for preview
 * or later ESC/POS rasterization. Does not talk to the printer.
 */
export async function renderReceiptCanvas(
  data: ReceiptData,
): Promise<HTMLCanvasElement> {
  const [map, logo] = await Promise.all([loadMapImage(), loadLogoImage()])
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')

  const mapW = RECEIPT_WIDTH_PX - 32
  const mapH = Math.round(mapW * (map.naturalHeight / map.naturalWidth))
  const logoH = Math.round(
    LOGO_WIDTH_PX * (logo.naturalHeight / logo.naturalWidth),
  )
  const showYear = hasYear(data)
  const yearBlockH = showYear ? 16 + 74 : 0
  const height =
    28 + // top pad
    36 + // title
    28 + // round
    16 + // rule
    56 + // score
    28 + // "poeng"
    16 + // rule
    mapH +
    54 + // legend
    yearBlockH +
    16 + // rule
    logoH +
    8 + // logo spacing
    40 // bottom pad

  canvas.width = RECEIPT_WIDTH_PX
  canvas.height = height

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  let y = 28
  y = drawCenteredText(ctx, 'TimeGuesser', y, 28, '700')
  y = drawCenteredText(
    ctx,
    `Runde ${data.round}/${data.rounds}`,
    y,
    22,
    '500',
  )
  y += 4
  y = drawRule(ctx, y)

  y = drawCenteredText(ctx, String(Math.round(data.score)), y, 48, '700')
  y = drawCenteredText(ctx, 'poeng', y, 22, '500')
  y += 4
  y = drawRule(ctx, y)

  y = drawMapSection(ctx, map, data.player, data.fasit, y)

  if (showYear) {
    y = drawRule(ctx, y)
    y = drawYearSection(ctx, data.yearGuess!, data.yearFasit!, y)
  }

  y = drawRule(ctx, y)
  drawBlackLogo(ctx, logo, LOGO_WIDTH_PX, y)

  return canvas
}
