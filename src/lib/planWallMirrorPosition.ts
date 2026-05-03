import type { FloorLevel, PointM, WallSheet } from '../types/project'
import { computePlanViewport } from './geometry'
import { segmentLengthM } from './wallPlanSync'

const READABILITY_NORMAL_OFFSET_M = 0.12

function unitNormalLeftOfSegment(seg: { a: PointM; b: PointM }): PointM {
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return { x: 0, y: 1 }
  return { x: -dy / len, y: dx / len }
}

function pointOnSegmentClamped(seg: { a: PointM; b: PointM }, t01: number): PointM {
  const u = Math.min(1, Math.max(0, t01))
  return {
    x: seg.a.x + (seg.b.x - seg.a.x) * u,
    y: seg.a.y + (seg.b.y - seg.a.y) * u,
  }
}

/**
 * Map a wall-elevation `xM` (0…sheet length) to plan world (x,y) for a mirrored floor icon.
 *
 * When `wallSheet.wallSegmentId` is set, map `xM` along that segment’s `a`→`b` line (same
 * direction as the sheet) and nudge by a small normal offset so the icon sits slightly off
 * the wall stroke for readability.
 *
 * When the sheet has **no** `wallSegmentId`, ignore `xM` and place at the **midpoint** of the
 * plan wall segment whose midpoint is closest to the floor plan bounding-box center
 * (`computePlanViewport`); if there are no plan segments, use that bbox center (custom wall).
 */
export function worldXYForWallMirrorOnPlan(
  fl: FloorLevel,
  wallSheet: Pick<WallSheet, 'wallSegmentId' | 'lengthM'>,
  xM: number,
): PointM {
  const segments = fl.plan.wallSegments ?? []
  const seg =
    wallSheet.wallSegmentId != null
      ? segments.find((s) => s.id === wallSheet.wallSegmentId) ?? null
      : null

  if (!seg) {
    const vp = computePlanViewport(fl.plan)
    const center: PointM = {
      x: vp.originX + vp.widthM / 2,
      y: vp.originY + vp.depthM / 2,
    }
    if (segments.length === 0) {
      return center
    }
    let best: (typeof segments)[0] = segments[0]!
    let bestD = Infinity
    for (const s of segments) {
      const midX = (s.a.x + s.b.x) / 2
      const midY = (s.a.y + s.b.y) / 2
      const dx = midX - center.x
      const dy = midY - center.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestD) {
        bestD = d2
        best = s
      }
    }
    const core = pointOnSegmentClamped(best, 0.5)
    const n = unitNormalLeftOfSegment(best)
    return {
      x: core.x + n.x * READABILITY_NORMAL_OFFSET_M,
      y: core.y + n.y * READABILITY_NORMAL_OFFSET_M,
    }
  }

  const L = segmentLengthM(seg.a, seg.b)
  const lenRef =
    wallSheet.lengthM > 0 && Number.isFinite(wallSheet.lengthM) ? wallSheet.lengthM : L
  const u = lenRef > 1e-9 ? Math.min(1, Math.max(0, xM / lenRef)) : 0.5
  const core = pointOnSegmentClamped(seg, u)
  const n = unitNormalLeftOfSegment(seg)
  return {
    x: core.x + n.x * READABILITY_NORMAL_OFFSET_M,
    y: core.y + n.y * READABILITY_NORMAL_OFFSET_M,
  }
}

/**
 * Normalized position `xM / lengthRef` along the wall sheet (0…1), only when the sheet is
 * tied to a plan segment. Used to cluster mirrored plan icons that share the same “vertical”
 * position on the elevation / the same strip along the wall on plan.
 */
export function along01ForWallMirrorOnPlan(
  fl: FloorLevel,
  wallSheet: Pick<WallSheet, 'wallSegmentId' | 'lengthM'>,
  xM: number,
): number | null {
  const segments = fl.plan.wallSegments ?? []
  const seg =
    wallSheet.wallSegmentId != null
      ? segments.find((s) => s.id === wallSheet.wallSegmentId) ?? null
      : null

  if (!seg) return null

  const L = segmentLengthM(seg.a, seg.b)
  const lenRef =
    wallSheet.lengthM > 0 && Number.isFinite(wallSheet.lengthM) ? wallSheet.lengthM : L
  return lenRef > 1e-9 ? Math.min(1, Math.max(0, xM / lenRef)) : 0.5
}
