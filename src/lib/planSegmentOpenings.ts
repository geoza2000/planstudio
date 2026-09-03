import type { FloorLevel, PointM, WallOpening, WallSegment } from '../types/project'
import { along01ForWallMirrorOnPlan } from './planWallMirrorPosition'

export type SegmentOpening = {
  opening: WallOpening
  /** Fraction along the parent segment a→b (0…1) of the opening centre. */
  t: number
  /** Opening centre on the wall centreline (plan metres). */
  world: PointM
}

/**
 * All openings on a segment, de-duplicated across the two room faces that share them, at
 * their position **on the wall centreline**. `worldXYForWallMirrorOnPlan` deliberately
 * nudges icons off the wall for editor readability; a drawing or a 3D model needs the true
 * point.
 */
export function uniqueOpeningsForSegment(fl: FloorLevel, seg: WallSegment): SegmentOpening[] {
  const seen = new Set<string>()
  const out: SegmentOpening[] = []
  for (const sheet of fl.wallSheets) {
    if (sheet.wallSegmentId !== seg.id) continue
    for (const o of sheet.openings ?? []) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      const u = along01ForWallMirrorOnPlan(fl, sheet, o.xM)
      const t = u == null ? 0.5 : Math.min(1, Math.max(0, u))
      out.push({
        opening: o,
        t,
        world: {
          x: seg.a.x + (seg.b.x - seg.a.x) * t,
          y: seg.a.y + (seg.b.y - seg.a.y) * t,
        },
      })
    }
  }
  return out
}
