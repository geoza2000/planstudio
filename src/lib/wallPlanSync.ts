import { nanoid } from 'nanoid'
import type { FloorLevel, Id, PointM, PlanstudioProject, WallSegment, WallSheet } from '../types/project'
import { wallSheetChordFromPlanGeometry } from './wallPlanRoomBoundary'

export { wallSheetChordFromPlanGeometry }

export const DEFAULT_WALL_HEIGHT_M = 2.8

/** Floors sorted by `sortOrder`, then `id` (stable tie-break). */
export function floorsSortedForLevelIndex(floors: FloorLevel[]): FloorLevel[] {
  return [...floors].sort((a, b) => {
    const d = a.sortOrder - b.sortOrder
    if (d !== 0) return d
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 0-based level index used in plan wall codes (`L0_…`, `L1_…`). */
export function floorLevelSortIndex(allFloors: FloorLevel[], floorId: Id): number {
  const sorted = floorsSortedForLevelIndex(allFloors)
  const i = sorted.findIndex((f) => f.id === floorId)
  return i >= 0 ? i : 0
}

/**
 * Deterministic wall order for stable `_*` indices: sort by endpoint `a`
 * (`y` asc, `x` asc), then segment `id`.
 */
export function wallSegmentsSortedForStableLabels(segments: WallSegment[]): WallSegment[] {
  return [...segments].sort((a, b) => {
    const dy = a.a.y - b.a.y
    if (dy !== 0) return dy
    const dx = a.a.x - b.a.x
    if (dx !== 0) return dx
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/** 1-based stable index per segment id for the given floor's `wallSegments`. */
export function wallSegmentStableIndexMap(segments: WallSegment[]): Map<Id, number> {
  const sorted = wallSegmentsSortedForStableLabels(segments)
  const m = new Map<Id, number>()
  sorted.forEach((s, i) => m.set(s.id, i + 1))
  return m
}

export function derivedPlanWallCode(levelIndex: number, stableWallIndex1Based: number): string {
  return `L${levelIndex}_${stableWallIndex1Based}`
}

export function segmentLengthM(a: PointM, b: PointM): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return Math.hypot(dx, dy)
}

/** Bearing of `a`→`b` in degrees from +X (same convention as `Math.atan2(dy, dx)`). */
export function segmentAngleDegFromPlusX(a: PointM, b: PointM): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return (Math.atan2(dy, dx) * 180) / Math.PI
}

/** Konva `Text` rotation so labels read roughly upright on screen (not inverted). */
export function readableWallLabelRotationDeg(alongDegFromPlusX: number): number {
  let a = alongDegFromPlusX
  a = ((((a + 180) % 360) + 360) % 360) - 180
  if (a > 90 || a < -90) return alongDegFromPlusX + 180
  return alongDegFromPlusX
}

/** Set `lengthM` + `planSpanAlongSegment01` on every sheet for this segment from each sheet's room chord. */
export function syncLinkedWallSheetLengthForSegment(
  fl: FloorLevel,
  segmentId: string,
  seg: WallSegment,
): FloorLevel {
  return {
    ...fl,
    wallSheets: fl.wallSheets.map((w) => {
      if (w.wallSegmentId !== segmentId) return w
      const { lengthM, planSpanAlongSegment01 } = wallSheetChordFromPlanGeometry(fl, w, seg)
      return { ...w, lengthM, planSpanAlongSegment01 }
    }),
  }
}

export function defaultWallHeightMForFloor(fl: FloorLevel): number {
  for (const w of fl.wallSheets) {
    if (Number.isFinite(w.heightM) && w.heightM > 0) {
      return w.heightM
    }
  }
  return DEFAULT_WALL_HEIGHT_M
}

export function newWallSheetForSegment(
  seg: WallSegment,
  fl: FloorLevel,
  allFloors: FloorLevel[],
): WallSheet {
  const len = segmentLengthM(seg.a, seg.b)
  const segs = fl.plan.wallSegments ?? []
  const levelIdx = floorLevelSortIndex(allFloors, fl.id)
  const stable = wallSegmentStableIndexMap(segs).get(seg.id) ?? segs.length
  return {
    id: nanoid(),
    floorLevelId: fl.id,
    label: derivedPlanWallCode(levelIdx, stable),
    lengthM: len,
    heightM: defaultWallHeightMForFloor(fl),
    devices: [],
    openings: [],
    wallSegmentId: seg.id,
  }
}

export function clearPlanLinksToWallDeviceIds(
  fl: FloorLevel,
  wallDeviceIds: Set<string>,
): FloorLevel {
  if (wallDeviceIds.size === 0) return fl
  return {
    ...fl,
    plan: {
      ...fl.plan,
      devices: fl.plan.devices.map((d) =>
        d.linkedWallDeviceId && wallDeviceIds.has(d.linkedWallDeviceId)
          ? { ...d, linkedWallDeviceId: undefined }
          : d,
      ),
    },
  }
}

/**
 * For every floor, set `label` on plan-linked wall sheets (`wallSegmentId` set) to
 * `derivedPlanWallCode` from the current segment order. Skips custom walls (no
 * `wallSegmentId`) and sheets whose segment id is missing from the plan.
 *
 * Called after successful project normalize/load: any JSON open or paste (same path
 * as `loadProject`) reapplies names so they match the embedded floor plan, including
 * when reopening older files.
 */
export function syncAllPlanWallSheetLabels(project: PlanstudioProject): PlanstudioProject {
  return {
    ...project,
    floors: project.floors.map((fl) => {
      const segs = fl.plan.wallSegments ?? []
      const levelIdx = floorLevelSortIndex(project.floors, fl.id)
      const idxMap = wallSegmentStableIndexMap(segs)
      const wallSheets = fl.wallSheets.map((w) => {
        if (!w.wallSegmentId) return w
        const seg = segs.find((s) => s.id === w.wallSegmentId)
        if (!seg) return w
        const stable = idxMap.get(seg.id)
        if (stable == null) return w
        return { ...w, label: derivedPlanWallCode(levelIdx, stable) }
      })
      return { ...fl, wallSheets }
    }),
  }
}

/**
 * For each plan segment, ensure a linked wall sheet; refresh length from the segment
 * for existing linked sheets. Does not remove extra custom sheets.
 */
export function syncFloorWallsFromPlan(
  fl: FloorLevel,
  allFloors: FloorLevel[],
): FloorLevel {
  const segs = fl.plan.wallSegments ?? []
  const levelIdx = floorLevelSortIndex(allFloors, fl.id)
  const idxMap = wallSegmentStableIndexMap(segs)
  let nextSheets = fl.wallSheets.map((w) => {
    if (!w.wallSegmentId) return w
    const seg = segs.find((s) => s.id === w.wallSegmentId)
    if (!seg) return w
    const stable = idxMap.get(seg.id)
    const nextLabel =
      stable != null ? derivedPlanWallCode(levelIdx, stable) : w.label
    const { lengthM, planSpanAlongSegment01 } = wallSheetChordFromPlanGeometry(fl, w, seg)
    return {
      ...w,
      lengthM,
      planSpanAlongSegment01,
      label: nextLabel,
    }
  })
  for (const seg of segs) {
    if (nextSheets.some((w) => w.wallSegmentId === seg.id)) continue
    const w = newWallSheetForSegment(seg, { ...fl, wallSheets: nextSheets }, allFloors)
    nextSheets = [...nextSheets, w]
  }
  return { ...fl, wallSheets: nextSheets }
}
