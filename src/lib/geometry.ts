import type { FloorPlan, PointM, WallSegment } from '../types/project'

export function snapMeters(p: PointM, gridM: number): PointM {
  const g = Math.max(0.001, gridM)
  return {
    x: Math.round(p.x / g) * g,
    y: Math.round(p.y / g) * g,
  }
}

/** Axis-aligned wall through B from corner A */
export function orthogonalWallPoint(a: PointM, b: PointM): PointM {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: b.x, y: a.y }
  }
  return { x: a.x, y: b.y }
}

export type WallDrawComputeInput = {
  anchor: PointM
  pointer: PointM
  /** Parsed positive length (m); omit or null = follow pointer only */
  lengthM: number | null
  /** Absolute bearing from +X (degrees); only used together with lengthM */
  angleDeg: number | null
  wallOrtho: boolean
  /** Same meaning as wall tool: Shift inverts ortho for this gesture */
  shiftKey: boolean
}

/**
 * Second endpoint for an in-progress wall: ortho / free angle, optional fixed length
 * and optional numeric angle. Call `snapMeters` on the result if desired.
 */
export function computeWallDrawB(p: WallDrawComputeInput): PointM {
  const useOrtho = p.wallOrtho !== p.shiftKey
  const L = p.lengthM != null && p.lengthM > 0 ? p.lengthM : null
  const hasAngle = p.angleDeg != null && Number.isFinite(p.angleDeg)

  if (L != null && hasAngle) {
    const rad = ((p.angleDeg as number) * Math.PI) / 180
    let b = {
      x: p.anchor.x + L * Math.cos(rad),
      y: p.anchor.y + L * Math.sin(rad),
    }
    if (useOrtho) b = orthogonalWallPoint(p.anchor, b)
    return b
  }

  if (L != null) {
    if (useOrtho) {
      const hint =
        p.pointer.x === p.anchor.x && p.pointer.y === p.anchor.y
          ? { x: p.anchor.x + 1, y: p.anchor.y }
          : p.pointer
      const axis = orthogonalWallPoint(p.anchor, hint)
      const dx = axis.x - p.anchor.x
      const dy = axis.y - p.anchor.y
      if (Math.abs(dx) >= Math.abs(dy)) {
        const sign =
          Math.sign(dx) || Math.sign(p.pointer.x - p.anchor.x) || 1
        return { x: p.anchor.x + sign * L, y: p.anchor.y }
      }
      const sign = Math.sign(dy) || Math.sign(p.pointer.y - p.anchor.y) || 1
      return { x: p.anchor.x, y: p.anchor.y + sign * L }
    }
    const hint =
      p.pointer.x === p.anchor.x && p.pointer.y === p.anchor.y
        ? { x: p.anchor.x + L, y: p.anchor.y }
        : p.pointer
    const ang = Math.atan2(hint.y - p.anchor.y, hint.x - p.anchor.x)
    return {
      x: p.anchor.x + L * Math.cos(ang),
      y: p.anchor.y + L * Math.sin(ang),
    }
  }

  let b: PointM = { x: p.pointer.x, y: p.pointer.y }
  if (useOrtho) b = orthogonalWallPoint(p.anchor, b)
  return b
}

export type PlanViewport = {
  originX: number
  originY: number
  widthM: number
  depthM: number
}

export function computePlanViewport(plan: FloorPlan, padM = 0.6): PlanViewport {
  let minX = 0
  let minY = 0
  let maxX = plan.widthM
  let maxY = plan.depthM

  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }

  for (const s of plan.wallSegments ?? []) {
    grow(s.a.x, s.a.y)
    grow(s.b.x, s.b.y)
  }
  for (const d of plan.devices) {
    grow(d.x, d.y)
  }
  for (const r of plan.regions) {
    for (const v of r.vertices) {
      grow(v.x, v.y)
    }
  }
  for (const f of plan.furniture ?? []) {
    const hx = (f.widthM + f.depthM) / 2
    grow(f.x - hx, f.y - hx)
    grow(f.x + hx, f.y + hx)
  }

  minX -= padM
  minY -= padM
  maxX += padM
  maxY += padM

  const widthM = Math.max(3, maxX - minX)
  const depthM = Math.max(3, maxY - minY)

  return { originX: minX, originY: minY, widthM, depthM }
}

export function flattenPolygon(vertices: PointM[]): number[] {
  const pts: number[] = []
  for (const v of vertices) {
    pts.push(v.x, v.y)
  }
  return pts
}

export function pointInPolygon(p: PointM, vertices: PointM[]): boolean {
  if (vertices.length < 3) return false
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x
    const yi = vertices[i].y
    const xj = vertices[j].x
    const yj = vertices[j].y
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

const WALL_SEG_LEN2_EPS = 1e-18

/** Default snap radius (m) to other wall **vertices** when drawing or editing. */
export const SNAP_PLAN_WALL_ENDPOINT_M = 0.25
/** Default snap radius (m) to nearest point along another wall **edge**. */
export const SNAP_PLAN_WALL_EDGE_M = 0.22

/** Closest point on segment `a`→`b` (clamped) to `p`. */
export function closestPointOnWallSegment(p: PointM, a: PointM, b: PointM): PointM {
  const ax = b.x - a.x
  const ay = b.y - a.y
  const len2 = ax * ax + ay * ay
  if (len2 < WALL_SEG_LEN2_EPS) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * ax + (p.y - a.y) * ay) / len2
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + t * ax, y: a.y + t * ay }
}

export type SnapWallPointOpts = {
  toleranceEndpointM?: number
  toleranceEdgeM?: number
  /** Segment id whose geometry is partially excluded (moving one of its endpoints). */
  ignoreSegmentId?: string
  /** Do not use this vertex of `ignoreSegmentId` as an endpoint snap target. */
  ignoreVertex?: 'a' | 'b'
}

/**
 * Snap `p` to the nearest other wall vertex or to a point along another wall edge, when
 * within tolerance. Call after grid snap; tolerances are in meters.
 */
export function snapWallPointToPlanGeometry(
  p: PointM,
  segments: WallSegment[],
  opts: SnapWallPointOpts = {},
): PointM {
  const tolE = opts.toleranceEndpointM ?? SNAP_PLAN_WALL_ENDPOINT_M
  const tolEd = opts.toleranceEdgeM ?? SNAP_PLAN_WALL_EDGE_M
  const ignId = opts.ignoreSegmentId
  const ignVx = opts.ignoreVertex

  let best: PointM = p
  let bestD = Infinity

  for (const s of segments) {
    for (const lab of ['a', 'b'] as const) {
      const q = lab === 'a' ? s.a : s.b
      if (ignId != null && s.id === ignId && lab === ignVx) continue
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d <= tolE && d < bestD - 1e-12) {
        bestD = d
        best = { x: q.x, y: q.y }
      }
    }
    if (ignId != null && s.id === ignId) continue
    const q = closestPointOnWallSegment(p, s.a, s.b)
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d <= tolEd && d < bestD - 1e-12) {
      bestD = d
      best = { x: q.x, y: q.y }
    }
  }
  return best
}
