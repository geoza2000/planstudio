import type { PointM, WallSegment } from '../types/project'
import { segmentLengthM } from './wallPlanSync'

const TOL_M = 0.004

function pointToSegmentDistanceM(p: PointM, a: PointM, b: PointM): number {
  const lx = b.x - a.x
  const ly = b.y - a.y
  const len2 = lx * lx + ly * ly
  if (len2 < 1e-22) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * lx + (p.y - a.y) * ly) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = a.x + t * lx
  const qy = a.y + t * ly
  return Math.hypot(p.x - qx, p.y - qy)
}

function projectTClampedOnSegment(p: PointM, a: PointM, b: PointM): number {
  const lx = b.x - a.x
  const ly = b.y - a.y
  const len2 = lx * lx + ly * ly
  if (len2 < 1e-22) return 0
  return Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / len2))
}

function mergeIntervals(intervals: [number, number][]): [number, number][] {
  if (intervals.length === 0) return []
  const s = [...intervals].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let cur = s[0]!
  for (let i = 1; i < s.length; i++) {
    const n = s[i]!
    if (n[0] <= cur[1] + 1e-5) cur = [cur[0], Math.max(cur[1], n[1])]
    else {
      out.push(cur)
      cur = n
    }
  }
  out.push(cur)
  return out
}

/**
 * Closed-room polygon edge coverage of a plan wall segment, as a parameter interval on
 * `seg` from `a` (t=0) to `b` (t=1). Used to size per-room wall sheets and to place openings
 * on the correct sub-span of a shared physical segment.
 */
export function computeRoomSpanOnSegment(
  regionVertices: PointM[] | undefined,
  seg: WallSegment,
): { t0: number; t1: number } {
  if (!regionVertices || regionVertices.length < 2) return { t0: 0, t1: 1 }
  const L = segmentLengthM(seg.a, seg.b)
  if (L < 1e-9) return { t0: 0, t1: 1 }

  const intervals: [number, number][] = []
  const n = regionVertices.length
  for (let i = 0; i < n; i++) {
    const p0 = regionVertices[i]!
    const p1 = regionVertices[(i + 1) % n]!
    if (pointToSegmentDistanceM(p0, seg.a, seg.b) > TOL_M) continue
    if (pointToSegmentDistanceM(p1, seg.a, seg.b) > TOL_M) continue
    const ta = projectTClampedOnSegment(p0, seg.a, seg.b)
    const tb = projectTClampedOnSegment(p1, seg.a, seg.b)
    const lo = Math.min(ta, tb)
    const hi = Math.max(ta, tb)
    if (hi - lo < 1e-6) continue
    intervals.push([lo, hi])
  }

  if (intervals.length === 0) return { t0: 0, t1: 1 }
  const merged = mergeIntervals(intervals)
  let t0 = merged[0]![0]
  let t1 = merged[0]![1]
  for (const [a, b] of merged) {
    t0 = Math.min(t0, a)
    t1 = Math.max(t1, b)
  }
  t0 = Math.max(0, Math.min(1, t0))
  t1 = Math.max(0, Math.min(1, t1))
  if (t1 - t0 < 1e-4) return { t0: 0, t1: 1 }
  return { t0, t1 }
}
