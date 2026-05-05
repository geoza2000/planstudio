import type { FloorLevel, WallOpening, WallSheet } from '../types/project'
import { segmentLengthM } from './wallPlanSync'

/** Fraction along parent segment (a→b) from local `xM` on this sheet (0…lengthM). */
export function planAlongSeg01FromOpeningXM(
  fl: FloorLevel,
  ws: WallSheet,
  xM: number,
): number {
  const seg = fl.plan.wallSegments?.find((s) => s.id === ws.wallSegmentId)
  if (!seg || ws.lengthM < 1e-9) return 0.5
  const span = ws.planSpanAlongSegment01 ?? { t0: 0, t1: 1 }
  const f = Math.min(1, Math.max(0, xM / ws.lengthM))
  return span.t0 + f * (span.t1 - span.t0)
}

/** Local `xM` (meters along this sheet’s visible chord) from canonical segment fraction. */
export function openingXMFromPlanAlongSeg01(
  fl: FloorLevel,
  ws: WallSheet,
  planAlongSeg01: number,
): number {
  const seg = fl.plan.wallSegments?.find((s) => s.id === ws.wallSegmentId)
  if (!seg) return ws.lengthM / 2
  const L = segmentLengthM(seg.a, seg.b)
  if (L < 1e-9) return 0
  const span = ws.planSpanAlongSegment01 ?? { t0: 0, t1: 1 }
  const posM = planAlongSeg01 * L
  const startM = span.t0 * L
  const localM = posM - startM
  return Math.min(Math.max(localM, 0), Math.max(ws.lengthM, 1e-9))
}

export function openingWithSyncedPlanAlong(
  fl: FloorLevel,
  w: WallSheet,
  base: WallOpening,
  planAlongSeg01: number,
): WallOpening {
  const xM = openingXMFromPlanAlongSeg01(fl, w, planAlongSeg01)
  return { ...base, xM, planAlongSeg01 }
}
