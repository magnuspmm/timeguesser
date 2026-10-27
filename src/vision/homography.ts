/** Point in pixel or normalized map space. */
export type Point2 = { x: number; y: number }

/** Row-major 3×3 matrix. */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
]

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Map corners in normalized (u,v) space: NW, NE, SE, SW. */
export const MAP_CORNERS: Point2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

export const CORNER_LABELS = ['NV', 'NØ', 'SØ', 'SV'] as const

function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])

  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]

    const div = m[col][col]
    for (let j = col; j <= n; j++) m[col][j] /= div

    for (let row = 0; row < n; row++) {
      if (row === col) continue
      const factor = m[row][col]
      for (let j = col; j <= n; j++) m[row][j] -= factor * m[col][j]
    }
  }

  return m.map((row) => row[n])
}

/**
 * Compute homography H such that H * [src.x, src.y, 1]^T → dest.
 * Uses Direct Linear Transform with 4 point pairs.
 */
export function computeHomography(
  src: Point2[],
  dest: Point2[],
): Mat3 | null {
  if (src.length !== 4 || dest.length !== 4) return null

  const a: number[][] = []
  const b: number[] = []

  for (let i = 0; i < 4; i++) {
    const { x: xs, y: ys } = src[i]
    const { x: xd, y: yd } = dest[i]
    a.push([xs, ys, 1, 0, 0, 0, -xs * xd, -ys * xd])
    b.push(xd)
    a.push([0, 0, 0, xs, ys, 1, -xs * yd, -ys * yd])
    b.push(yd)
  }

  const h = solveLinearSystem(a, b)
  if (!h) return null
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]
}

export function invertHomography(h: Mat3): Mat3 | null {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = h
  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20)
  if (Math.abs(det) < 1e-12) return null
  const invDet = 1 / det
  return [
    (m11 * m22 - m12 * m21) * invDet,
    (m02 * m21 - m01 * m22) * invDet,
    (m01 * m12 - m02 * m11) * invDet,
    (m12 * m20 - m10 * m22) * invDet,
    (m00 * m22 - m02 * m20) * invDet,
    (m02 * m10 - m00 * m12) * invDet,
    (m10 * m21 - m11 * m20) * invDet,
    (m01 * m20 - m00 * m21) * invDet,
    (m00 * m11 - m01 * m10) * invDet,
  ]
}

export function applyHomography(h: Mat3, p: Point2): Point2 {
  const w = h[6] * p.x + h[7] * p.y + h[8]
  if (Math.abs(w) < 1e-12) return { x: 0, y: 0 }
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  }
}

/** Pixel coords → normalized map (u,v) using camera→map homography. */
export function pixelToMap(cameraToMap: Mat3, pixel: Point2): Point2 {
  return applyHomography(cameraToMap, pixel)
}

/** Extra margin in normalized map space so edge pieces are still tracked. */
export const MAP_TRACK_BUFFER = 0.08

export function isInsideMap(uv: Point2, margin = 0.05): boolean {
  return (
    uv.x >= -margin &&
    uv.x <= 1 + margin &&
    uv.y >= -margin &&
    uv.y <= 1 + margin
  )
}

/** Expanded map corners in UV space (used for ROI / overlay). */
export function bufferedMapCorners(buffer = MAP_TRACK_BUFFER): Point2[] {
  const b = buffer
  return [
    { x: -b, y: -b },
    { x: 1 + b, y: -b },
    { x: 1 + b, y: 1 + b },
    { x: -b, y: 1 + b },
  ]
}

/** Project buffered UV corners into camera pixel space. */
export function mapRoiCameraCorners(
  cameraToMap: Mat3,
  buffer = MAP_TRACK_BUFFER,
): Point2[] | null {
  const mapToCamera = invertHomography(cameraToMap)
  if (!mapToCamera) return null
  return bufferedMapCorners(buffer).map((uv) => applyHomography(mapToCamera, uv))
}
