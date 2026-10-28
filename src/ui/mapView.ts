import { isInsideMap, type Point2 } from '../vision/homography'

const MAP_CANVAS_MAX = 1024

export type MapMarkerStyle = 'live' | 'locked' | 'answer'

export type MapMarker = {
  uv: Point2
  style?: MapMarkerStyle
  label?: string
}

export type MapView = {
  canvas: HTMLCanvasElement
  setMarker: (uv: Point2 | null, style?: MapMarkerStyle) => void
  setMarkers: (markers: MapMarker[]) => void
  /** Draw a line between two UV points (e.g. guess → fasit). */
  setLine: (from: Point2 | null, to: Point2 | null) => void
  getMarker: () => Point2 | null
  setClickable: (enabled: boolean) => void
  onClick: (handler: ((uv: Point2) => void) | null) => void
  redraw: () => void
  destroy: () => void
}

export type MountMapViewOptions = {
  clickable?: boolean
  onClick?: (uv: Point2) => void
}

function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
): void {
  ctx.fillStyle = '#1a2e24'
  ctx.fillRect(0, 0, w, h)

  ctx.strokeStyle = 'rgba(232, 197, 71, 0.2)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const x = (i / 4) * w
    const y = (i / 4) * h
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  ctx.strokeStyle = '#e8c547'
  ctx.lineWidth = 2
  ctx.strokeRect(1, 1, w - 2, h - 2)

  ctx.fillStyle = 'rgba(232, 197, 71, 0.7)'
  ctx.font = '11px "IBM Plex Sans", system-ui, sans-serif'
  ctx.fillText('NV', 6, 14)
  ctx.fillText('NØ', w - 24, 14)
  ctx.fillText('SV', 6, h - 6)
  ctx.fillText('SØ', w - 24, h - 6)
}

function markerColor(style: MapMarkerStyle): string {
  if (style === 'locked') return '#e53935'
  if (style === 'answer') return '#f5c518'
  return '#e53935'
}

function markerRadius(style: MapMarkerStyle): number {
  if (style === 'locked' || style === 'answer') return 14
  return 12
}

function sizeCanvasFromImage(
  canvas: HTMLCanvasElement,
  img: HTMLImageElement,
): void {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return
  const scale = Math.min(1, MAP_CANVAS_MAX / Math.max(nw, nh))
  canvas.width = Math.max(1, Math.round(nw * scale))
  canvas.height = Math.max(1, Math.round(nh * scale))
}

/**
 * Mount a map canvas that loads /map.png and draws UV marker(s).
 * Coordinates: (0,0)=NV top-left, (1,1)=SØ bottom-right.
 */
export function mountMapView(
  canvas: HTMLCanvasElement,
  options: MountMapViewOptions = {},
): MapView {
  const ctxOrNull = canvas.getContext('2d')
  if (!ctxOrNull) {
    throw new Error('2D context unavailable')
  }
  const ctx: CanvasRenderingContext2D = ctxOrNull

  let mapImage: HTMLImageElement | null = null
  let markers: MapMarker[] = []
  let lineFrom: Point2 | null = null
  let lineTo: Point2 | null = null
  let clickable = Boolean(options.clickable)
  let clickHandler: ((uv: Point2) => void) | null = options.onClick ?? null

  function redraw(): void {
    const w = canvas.width
    const h = canvas.height
    if (mapImage?.complete && mapImage.naturalWidth > 0) {
      ctx.drawImage(mapImage, 0, 0, w, h)
    } else {
      drawPlaceholder(ctx, w, h)
    }

    if (lineFrom && lineTo) {
      const x0 = lineFrom.x * w
      const y0 = lineFrom.y * h
      const x1 = lineTo.x * w
      const y1 = lineTo.y * h
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.lineWidth = 2.5
      ctx.setLineDash([8, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }

    for (const m of markers) {
      if (!isInsideMap(m.uv, 0.15)) continue
      const style = m.style ?? 'live'
      const px = m.uv.x * w
      const py = m.uv.y * h
      const r = markerRadius(style)
      ctx.beginPath()
      ctx.arc(px, py, r, 0, Math.PI * 2)
      ctx.fillStyle = markerColor(style)
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 3
      ctx.stroke()
      if (m.label) {
        ctx.fillStyle = '#fff'
        ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif'
        ctx.fillText(m.label, px + 16, py - 10)
      }
    }
  }

  function uvFromClick(ev: MouseEvent): Point2 | null {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const u = (ev.clientX - rect.left) / rect.width
    const v = (ev.clientY - rect.top) / rect.height
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    return { x: u, y: v }
  }

  function onCanvasClick(ev: MouseEvent): void {
    if (!clickable || !clickHandler) return
    const uv = uvFromClick(ev)
    if (!uv) return
    clickHandler(uv)
  }

  canvas.addEventListener('click', onCanvasClick)
  canvas.style.cursor = clickable ? 'crosshair' : 'default'

  const img = new Image()
  img.onload = () => {
    mapImage = img
    sizeCanvasFromImage(canvas, img)
    redraw()
  }
  img.onerror = () => {
    console.warn('Kunne ikke laste /map.png')
    mapImage = null
    redraw()
  }
  img.src = '/map.png'
  redraw()

  return {
    canvas,
    setMarker(uv, style = 'live') {
      markers = uv ? [{ uv: { x: uv.x, y: uv.y }, style }] : []
      redraw()
    },
    setMarkers(next) {
      markers = next.map((m) => ({
        uv: { x: m.uv.x, y: m.uv.y },
        style: m.style,
        label: m.label,
      }))
      redraw()
    },
    setLine(from, to) {
      lineFrom = from ? { x: from.x, y: from.y } : null
      lineTo = to ? { x: to.x, y: to.y } : null
      redraw()
    },
    getMarker() {
      const first = markers[0]
      return first ? { ...first.uv } : null
    },
    setClickable(enabled) {
      clickable = enabled
      canvas.style.cursor = enabled ? 'crosshair' : 'default'
    },
    onClick(handler) {
      clickHandler = handler
    },
    redraw,
    destroy() {
      canvas.removeEventListener('click', onCanvasClick)
    },
  }
}
