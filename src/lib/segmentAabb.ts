/**
 * True if the closed segment (x1,y1)–(x2,y2) intersects the axis-aligned rectangle
 * [minX, maxX] × [minY, maxY] (inclusive bounds).
 */
export function segmentIntersectsAabb(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  const rx0 = Math.min(minX, maxX)
  const rx1 = Math.max(minX, maxX)
  const ry0 = Math.min(minY, maxY)
  const ry1 = Math.max(minY, maxY)
  const inside = (x: number, y: number) => x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1
  if (inside(x1, y1) || inside(x2, y2)) return true
  const sx0 = Math.min(x1, x2)
  const sx1 = Math.max(x1, x2)
  const sy0 = Math.min(y1, y2)
  const sy1 = Math.max(y1, y2)
  if (sx1 < rx0 || sx0 > rx1 || sy1 < ry0 || sy0 > ry1) return false
  let u0 = 0
  let u1 = 1
  const dx = x2 - x1
  const dy = y2 - y1
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > u1) return false
      if (r > u0) u0 = r
    } else {
      if (r < u0) return false
      if (r < u1) u1 = r
    }
    return true
  }
  if (!clip(-dx, x1 - rx0)) return false
  if (!clip(dx, rx1 - x1)) return false
  if (!clip(-dy, y1 - ry0)) return false
  if (!clip(dy, ry1 - y1)) return false
  return u0 <= u1
}
