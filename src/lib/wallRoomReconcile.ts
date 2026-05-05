import { nanoid } from 'nanoid'
import type {
  FloorLevel,
  Id,
  PlanRegion,
  PointM,
  WallSheet,
} from '../types/project'
import {
  buildSegmentFaceMap,
  detectWallRoomFaces,
  roomLabelSlug,
  type SegmentFaceMap,
  type WallRoomFace,
} from './wallRoomTopology'
import {
  derivedPlanWallCode,
  floorLevelSortIndex,
  segmentLengthM,
  wallSegmentStableIndexMap,
  defaultWallHeightMForFloor,
} from './wallPlanSync'
import { computeRoomSpanOnSegment } from './wallPlanRoomBoundary'
import { planAlongSeg01FromOpeningXM } from './wallOpeningAlongSegment'
import { resyncGroupedOpeningPositionsForFloor } from './wallOpeningGroupSync'

const DEFAULT_NEW_ROOM_PREFIX = 'Room'

function polygonCentroid(verts: PointM[]): PointM {
  let sx = 0
  let sy = 0
  for (const v of verts) {
    sx += v.x
    sy += v.y
  }
  const n = verts.length
  return { x: sx / n, y: sy / n }
}

/** Ray-cast; `poly` is a closed CCW (or CW) simple polygon without repeated closing vertex. */
function pointInPolygon(pt: PointM, poly: PointM[]): boolean {
  if (poly.length < 3) return false
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x
    const yi = poly[i]!.y
    const xj = poly[j]!.x
    const yj = poly[j]!.y
    const denom = yj - yi
    const crossRay =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (Math.abs(denom) < 1e-18 ? 1e-18 : denom) + xi
    if (crossRay) inside = !inside
  }
  return inside
}

function neighborFaces(f: WallRoomFace, faces: WallRoomFace[]): WallRoomFace[] {
  const set = new Set(f.segmentIds)
  return faces.filter((g) => {
    if (g.cycleSignature === f.cycleSignature) return false
    for (const id of g.segmentIds) {
      if (set.has(id)) return true
    }
    return false
  })
}

/** Count of distinct wall segments shared by two faces (boundary overlap). */
function sharedSegmentCount(f: WallRoomFace, g: WallRoomFace): number {
  const setG = new Set(g.segmentIds)
  let n = 0
  for (const id of f.segmentIds) {
    if (setG.has(id)) n += 1
  }
  return n
}

/**
 * Set `parentRegionId` on auto-rooms:
 * 1) If another face’s polygon strictly contains this face’s centroid, use the
 *    **smallest-area** container (classic nested room).
 * 2) Else (e.g. alcove opening into a larger room — centroid lies in the “notch” and
 *    outside the outer polygon), pick the adjacent face with **larger area** that
 *    shares the **fewest** wall segments with this face (typically the corridor the
 *    pocket opens off), tie-breaking by smaller neighbor area.
 */
function withAutoRoomParents(faces: WallRoomFace[], regions: PlanRegion[]): PlanRegion[] {
  const faceBySig = new Map(faces.map((f) => [f.cycleSignature, f]))
  const idBySig = new Map(regions.map((r) => [r.wallCycleSignature!, r.id]))

  return regions.map((r) => {
    if (!r.wallCycleSignature) return r
    const f = faceBySig.get(r.wallCycleSignature)
    if (!f) return { ...r, parentRegionId: undefined }

    const c = polygonCentroid(f.vertices)
    let container: WallRoomFace | null = null
    let containerArea = Infinity
    for (const g of faces) {
      if (g.cycleSignature === f.cycleSignature) continue
      if (g.area <= f.area + 1e-5) continue
      if (!pointInPolygon(c, g.vertices)) continue
      if (g.area < containerArea) {
        containerArea = g.area
        container = g
      }
    }

    let chosen: WallRoomFace | null = container

    if (!chosen) {
      const nbrs = neighborFaces(f, faces).filter((g) => g.area > f.area + 1e-5)
      if (nbrs.length >= 2) {
        let best: WallRoomFace | null = null
        let bestShared = Infinity
        let bestNeighborArea = Infinity
        for (const g of nbrs) {
          const sh = sharedSegmentCount(f, g)
          if (sh <= 0) continue
          if (sh < bestShared || (sh === bestShared && g.area < bestNeighborArea)) {
            bestShared = sh
            bestNeighborArea = g.area
            best = g
          }
        }
        chosen = best
      }
    }

    const parentSig = chosen?.cycleSignature
    const parentId = parentSig ? idBySig.get(parentSig) : undefined
    return { ...r, parentRegionId: parentId }
  })
}

/**
 * Reconcile auto-detected rooms (`PlanRegion` rows with `wallCycleSignature`) against
 * the current wall topology. Manual freehand regions (no `wallCycleSignature`) and
 * regions of kind ≠ 'room' are passed through unchanged.
 *
 * - Existing auto-rooms whose `wallCycleSignature` still matches a face → keep id +
 *   user-edited label, refresh `vertices`.
 * - Faces with no matching prior region → create a new auto-room (`Room N`).
 * - Auto-rooms whose signature no longer matches any face → drop.
 * - `parentRegionId` on auto-rooms: set when a room is nested in another (centroid inside a
 *   larger face’s polygon), or for alcoves that open between two larger neighbors by
 *   picking the neighbor that shares the fewest wall segments (when at least two larger
 *   neighbors exist).
 */
function reconcileRoomRegions(
  prior: PlanRegion[],
  faces: WallRoomFace[],
): { regions: PlanRegion[]; faceToRegionId: Map<string, Id> } {
  const priorBySig = new Map<string, PlanRegion>()
  const passthrough: PlanRegion[] = []
  for (const r of prior) {
    if (r.kind === 'room' && r.wallCycleSignature) {
      priorBySig.set(r.wallCycleSignature, r)
    } else {
      passthrough.push(r)
    }
  }

  const usedRoomLabels = new Set<string>()
  for (const r of passthrough) {
    if (r.kind === 'room' && r.label.trim()) usedRoomLabels.add(r.label.trim())
  }
  for (const r of priorBySig.values()) {
    if (r.label.trim()) usedRoomLabels.add(r.label.trim())
  }

  const faceToRegionId = new Map<string, Id>()
  const nextRoomRegions: PlanRegion[] = []

  let nextRoomNumber = 1
  const allocateRoomLabel = (): string => {
    while (usedRoomLabels.has(`${DEFAULT_NEW_ROOM_PREFIX} ${nextRoomNumber}`)) {
      nextRoomNumber += 1
    }
    const label = `${DEFAULT_NEW_ROOM_PREFIX} ${nextRoomNumber}`
    usedRoomLabels.add(label)
    nextRoomNumber += 1
    return label
  }

  for (const f of faces) {
    const existing = priorBySig.get(f.cycleSignature)
    if (existing) {
      nextRoomRegions.push({
        ...existing,
        kind: 'room',
        wallCycleSignature: f.cycleSignature,
        vertices: f.vertices.map((v) => ({ ...v })),
        parentRegionId: undefined,
      })
      faceToRegionId.set(f.cycleSignature, existing.id)
    } else {
      const id = nanoid()
      nextRoomRegions.push({
        id,
        kind: 'room',
        label: allocateRoomLabel(),
        vertices: f.vertices.map((v) => ({ ...v })),
        wallCycleSignature: f.cycleSignature,
        parentRegionId: undefined,
      })
      faceToRegionId.set(f.cycleSignature, id)
    }
  }

  const nested = withAutoRoomParents(faces, nextRoomRegions)

  // Keep manual / non-room regions, then auto-rooms (sort within auto-rooms is determined
  // by face traversal order which is itself sorted by signature inside detectWallRoomFaces).
  return { regions: [...passthrough, ...nested], faceToRegionId }
}

type SheetSlotPlan = {
  segmentId: string
  face: 'a' | 'b' | 'orphan'
  roomRegionId: Id | undefined
  /** Group id for syncing openings between paired faces; see `reconcileFloorWallTopology`. */
  openingsGroupId: Id
  label: string
  lengthM: number
  heightM: number
  planSpanAlongSegment01?: { t0: number; t1: number }
}

function slotGroupKey(
  segmentId: string,
  face: 'a' | 'b' | 'orphan',
  roomRegionId: Id | undefined,
): string {
  return `${segmentId}|${face}|${roomRegionId ?? ''}`
}

/**
 * Drop openings whose center along the parent segment lies outside this sheet’s
 * `planSpanAlongSegment01` (e.g. after splitting shared `openingsGroupId` on T-junctions).
 */
function pruneOpeningsOutsideSheetChord(
  fl: FloorLevel,
  sheets: WallSheet[],
): WallSheet[] {
  const eps = 0.002
  return sheets.map((w) => {
    const span = w.planSpanAlongSegment01
    if (!w.wallSegmentId || !span) return w
    const prev = w.openings ?? []
    const next = prev.filter((o) => {
      const u = planAlongSeg01FromOpeningXM(fl, w, o.xM)
      return u >= span.t0 - eps && u <= span.t1 + eps
    })
    return next.length === prev.length ? w : { ...w, openings: next }
  })
}

function planSheetSlotsForFloor(
  fl: FloorLevel,
  allFloors: FloorLevel[],
  faceToRegionId: Map<string, Id>,
  segMap: SegmentFaceMap,
  /** One id per segment when there is exactly one `a` and one `b` face (partition wall). */
  priorOpeningsGroupBySegment: Map<string, Id>,
  priorOpeningsGroupBySlotKey: Map<string, Id>,
  priorGroupCountsBySegment: Map<string, Map<string, number>>,
): SheetSlotPlan[] {
  const segs = fl.plan.wallSegments ?? []
  const levelIdx = floorLevelSortIndex(allFloors, fl.id)
  const idxMap = wallSegmentStableIndexMap(segs)
  const defaultHeight = defaultWallHeightMForFloor(fl)

  const plans: SheetSlotPlan[] = []
  for (const seg of segs) {
    const stable = idxMap.get(seg.id) ?? 0
    const baseCode = derivedPlanWallCode(levelIdx, stable)
    const lenM = segmentLengthM(seg.a, seg.b)
    const chordForRoom = (roomId: Id | undefined): {
      lengthM: number
      planSpan: { t0: number; t1: number }
    } => {
      if (!roomId) return { lengthM: lenM, planSpan: { t0: 0, t1: 1 } }
      const region = (fl.plan.regions ?? []).find((r) => r.id === roomId)
      const planSpan = computeRoomSpanOnSegment(region?.vertices, seg)
      const chord = Math.max((planSpan.t1 - planSpan.t0) * lenM, 1e-4)
      return { lengthM: chord, planSpan }
    }
    const slot = segMap.get(seg.id) ?? { abSideFaces: [], baSideFaces: [] }
    /** Exactly one room face per side — the usual shared partition between two rooms. */
    const isSimpleOppositePair =
      slot.abSideFaces.length === 1 && slot.baSideFaces.length === 1
    const pairGroupId = priorOpeningsGroupBySegment.get(seg.id) ?? nanoid()
    const groupCounts = priorGroupCountsBySegment.get(seg.id)

    const groupIdForFace = (face: 'a' | 'b', roomId: Id | undefined): Id => {
      if (isSimpleOppositePair) return pairGroupId
      const key = slotGroupKey(seg.id, face, roomId)
      const gFromPrior = priorOpeningsGroupBySlotKey.get(key)
      const exclusive =
        gFromPrior != null && (groupCounts?.get(gFromPrior) ?? 0) === 1
      return exclusive ? gFromPrior : nanoid()
    }

    const ab = slot.abSideFaces
    const ba = slot.baSideFaces

    if (ab.length === 0 && ba.length === 0) {
      const key = slotGroupKey(seg.id, 'orphan', undefined)
      const gFromPrior = priorOpeningsGroupBySlotKey.get(key)
      const exclusive =
        gFromPrior != null && (groupCounts?.get(gFromPrior) ?? 0) === 1
      const orphanGid = exclusive
        ? gFromPrior
        : priorOpeningsGroupBySegment.get(seg.id) ?? nanoid()
      plans.push({
        segmentId: seg.id,
        face: 'orphan',
        roomRegionId: undefined,
        openingsGroupId: orphanGid,
        label: baseCode,
        lengthM: lenM,
        heightM: defaultHeight,
      })
      continue
    }

    for (const roomFace of ab) {
      const roomId = faceToRegionId.get(roomFace.cycleSignature)
      const { lengthM: chordM, planSpan } = chordForRoom(roomId)
      plans.push({
        segmentId: seg.id,
        face: 'a',
        roomRegionId: roomId,
        openingsGroupId: groupIdForFace('a', roomId),
        label: baseCode,
        lengthM: chordM,
        heightM: defaultHeight,
        planSpanAlongSegment01: planSpan,
      })
    }
    for (const roomFace of ba) {
      const roomId = faceToRegionId.get(roomFace.cycleSignature)
      const { lengthM: chordM, planSpan } = chordForRoom(roomId)
      plans.push({
        segmentId: seg.id,
        face: 'b',
        roomRegionId: roomId,
        openingsGroupId: groupIdForFace('b', roomId),
        label: baseCode,
        lengthM: chordM,
        heightM: defaultHeight,
        planSpanAlongSegment01: planSpan,
      })
    }
  }
  return plans
}

/**
 * Replace the slot label `L{lvl}_{idx}` with `L{lvl}_{idx}_<roomSlug>` once we know
 * each room's user-editable label.
 */
function withRoomLabelsApplied(
  plans: SheetSlotPlan[],
  regions: PlanRegion[],
): SheetSlotPlan[] {
  const labelById = new Map<Id, string>()
  for (const r of regions) labelById.set(r.id, r.label)
  return plans.map((p) => {
    if (p.face === 'orphan') return p
    const slug = p.roomRegionId
      ? roomLabelSlug(labelById.get(p.roomRegionId) ?? '')
      : 'room'
    return { ...p, label: `${p.label}_${slug}` }
  })
}

/**
 * For each desired slot, either reuse an existing sheet (preserve its devices, openings,
 * height override, custom data) or create a fresh sheet. Strategy:
 *
 * 1) Prefer the prior sheet that already had `(segmentId, wallFace, roomRegionId)` matching
 *    the slot (multiple rooms can share the same segment side at a T-junction).
 * 2) Otherwise, prefer a prior sheet for the same segment whose `roomRegionId` matches.
 * 3) Otherwise, create a brand-new sheet (do not reuse an unrelated sheet for the same
 *    segment — avoids mis-assigning faces when several plan-linked sheets share one segment).
 *
 * Sheets that are not claimed by any slot are dropped. Their device ids that floor
 * devices linked to are returned so callers can clear the dangling links.
 */
function materializeSheetsForPlan(
  fl: FloorLevel,
  plans: SheetSlotPlan[],
): { sheets: WallSheet[]; droppedWallDeviceIds: Set<string> } {
  const priorBySegment = new Map<string, WallSheet[]>()
  for (const w of fl.wallSheets) {
    if (!w.wallSegmentId) continue
    if (!priorBySegment.has(w.wallSegmentId)) priorBySegment.set(w.wallSegmentId, [])
    priorBySegment.get(w.wallSegmentId)!.push(w)
  }
  const claimed = new Set<string>()
  const dropped = new Set<string>()

  const sheets: WallSheet[] = []
  // First pass: exact (segment, wall face, room) match.
  const slotResults: (WallSheet | null)[] = plans.map(() => null)
  for (let i = 0; i < plans.length; i++) {
    const slot = plans[i]!
    const candidates = priorBySegment.get(slot.segmentId) ?? []
    const exact = candidates.find(
      (w) =>
        !claimed.has(w.id) &&
        ((slot.face === 'orphan' && !w.wallFace && !w.roomRegionId) ||
          (slot.face !== 'orphan' &&
            w.wallFace === slot.face &&
            w.roomRegionId === slot.roomRegionId)),
    )
    if (exact) {
      claimed.add(exact.id)
      slotResults[i] = exact
    }
  }
  // Second pass: same segment, roomRegionId match (handles wallFace flip after geometry edit).
  for (let i = 0; i < plans.length; i++) {
    if (slotResults[i]) continue
    const slot = plans[i]!
    if (slot.face === 'orphan' || !slot.roomRegionId) continue
    const candidates = priorBySegment.get(slot.segmentId) ?? []
    const byRoom = candidates.find(
      (w) => !claimed.has(w.id) && w.roomRegionId === slot.roomRegionId,
    )
    if (byRoom) {
      claimed.add(byRoom.id)
      slotResults[i] = byRoom
    }
  }

  for (let i = 0; i < plans.length; i++) {
    const slot = plans[i]!
    const prior = slotResults[i]
    if (prior) {
      sheets.push({
        ...prior,
        wallSegmentId: slot.segmentId,
        wallFace: slot.face === 'orphan' ? undefined : slot.face,
        roomRegionId: slot.roomRegionId,
        openingsGroupId: slot.openingsGroupId,
        label: slot.label,
        lengthM: slot.lengthM,
        ...(slot.planSpanAlongSegment01
          ? { planSpanAlongSegment01: slot.planSpanAlongSegment01 }
          : {}),
        // heightM intentionally preserved — users can override per face.
      })
    } else {
      sheets.push({
        id: nanoid(),
        floorLevelId: fl.id,
        label: slot.label,
        lengthM: slot.lengthM,
        heightM: slot.heightM,
        devices: [],
        openings: [],
        wallSegmentId: slot.segmentId,
        wallFace: slot.face === 'orphan' ? undefined : slot.face,
        roomRegionId: slot.roomRegionId,
        openingsGroupId: slot.openingsGroupId,
        ...(slot.planSpanAlongSegment01
          ? { planSpanAlongSegment01: slot.planSpanAlongSegment01 }
          : {}),
      })
    }
  }

  // Custom (non plan-linked) sheets are preserved as-is.
  for (const w of fl.wallSheets) {
    if (!w.wallSegmentId) sheets.push(w)
  }

  // Anything from priorBySegment not claimed is dropped — collect linked device ids
  // so callers can clear dangling floor↔wall device links.
  for (const [, list] of priorBySegment) {
    for (const w of list) {
      if (!claimed.has(w.id)) {
        for (const d of w.devices) dropped.add(d.id)
      }
    }
  }

  return { sheets, droppedWallDeviceIds: dropped }
}

/**
 * After paired-face sheet creation, propagate openings from one face to its paired
 * face whenever exactly one of them is empty. This covers the common case where the
 * user added openings on the existing single-face sheet *before* a second room
 * appeared on the other side: the new face inherits the same openings.
 */
function syncOpeningsAcrossPairedFaces(sheets: WallSheet[]): WallSheet[] {
  const byGroup = new Map<string, WallSheet[]>()
  for (const w of sheets) {
    if (!w.openingsGroupId) continue
    if (!byGroup.has(w.openingsGroupId)) byGroup.set(w.openingsGroupId, [])
    byGroup.get(w.openingsGroupId)!.push(w)
  }
  const next = new Map<string, WallSheet>()
  for (const w of sheets) next.set(w.id, w)

  for (const [, group] of byGroup) {
    if (group.length < 2) continue
    const withOpenings = group.find((g) => (g.openings?.length ?? 0) > 0)
    if (!withOpenings) continue
    for (const g of group) {
      if (g.id === withOpenings.id) continue
      if ((g.openings?.length ?? 0) > 0) continue
      next.set(g.id, {
        ...g,
        openings: withOpenings.openings.map((o) => ({ ...o })),
      })
    }
  }
  return [...next.values()]
}

/** Clear `linkedWallDeviceId` on plan devices whose target was dropped. */
function clearStalePlanDeviceLinks(
  fl: FloorLevel,
  droppedWallDeviceIds: Set<string>,
): FloorLevel {
  if (droppedWallDeviceIds.size === 0) return fl
  return {
    ...fl,
    plan: {
      ...fl.plan,
      devices: fl.plan.devices.map((d) =>
        d.linkedWallDeviceId && droppedWallDeviceIds.has(d.linkedWallDeviceId)
          ? { ...d, linkedWallDeviceId: undefined }
          : d,
      ),
    },
  }
}

/**
 * Recompute auto-rooms and per-face wall sheets for a floor.
 *
 * Idempotent: calling twice with the same input returns the same shape (modulo new
 * `nanoid` ids for genuinely new rooms / sheets on the first call).
 */
export function reconcileFloorWallTopology(
  fl: FloorLevel,
  allFloors: FloorLevel[],
): FloorLevel {
  const flSeg = fl

  const faces = detectWallRoomFaces(flSeg.plan.wallSegments ?? [])
  const segMap = buildSegmentFaceMap(faces)

  const priorRegions = flSeg.plan.regions ?? []
  const { regions, faceToRegionId } = reconcileRoomRegions(priorRegions, faces)

  /** Only used when a segment has exactly one `a` and one `b` face (true partition wall). */
  const priorOpeningsGroupBySegment = new Map<string, Id>()
  const priorOpeningsGroupBySlotKey = new Map<string, Id>()
  const priorGroupCountsBySegment = new Map<string, Map<string, number>>()
  for (const w of flSeg.wallSheets) {
    if (!w.wallSegmentId || !w.openingsGroupId) continue
    if (!priorOpeningsGroupBySegment.has(w.wallSegmentId)) {
      priorOpeningsGroupBySegment.set(w.wallSegmentId, w.openingsGroupId)
    }
    const face: 'a' | 'b' | 'orphan' =
      w.wallFace === 'a' || w.wallFace === 'b' ? w.wallFace : 'orphan'
    priorOpeningsGroupBySlotKey.set(
      slotGroupKey(w.wallSegmentId, face, w.roomRegionId),
      w.openingsGroupId,
    )
    if (!priorGroupCountsBySegment.has(w.wallSegmentId)) {
      priorGroupCountsBySegment.set(w.wallSegmentId, new Map())
    }
    const m = priorGroupCountsBySegment.get(w.wallSegmentId)!
    m.set(w.openingsGroupId, (m.get(w.openingsGroupId) ?? 0) + 1)
  }

  const planRaw = planSheetSlotsForFloor(
    flSeg,
    allFloors,
    faceToRegionId,
    segMap,
    priorOpeningsGroupBySegment,
    priorOpeningsGroupBySlotKey,
    priorGroupCountsBySegment,
  )
  const plan = withRoomLabelsApplied(planRaw, regions)

  const { sheets, droppedWallDeviceIds } = materializeSheetsForPlan(flSeg, plan)
  const synced = syncOpeningsAcrossPairedFaces(sheets)
  const resynced = resyncGroupedOpeningPositionsForFloor({
    ...flSeg,
    plan: { ...flSeg.plan, regions },
    wallSheets: synced,
  }).wallSheets

  const geomFloor: FloorLevel = {
    ...flSeg,
    plan: { ...flSeg.plan, regions },
    wallSheets: resynced,
  }
  const prunedSheets = pruneOpeningsOutsideSheetChord(geomFloor, resynced)

  let next: FloorLevel = {
    ...flSeg,
    plan: { ...flSeg.plan, regions },
    wallSheets: prunedSheets,
  }
  next = clearStalePlanDeviceLinks(next, droppedWallDeviceIds)
  return next
}

/** Apply {@link reconcileFloorWallTopology} to every floor of a project. */
export function reconcileAllFloorsWallTopology(
  floors: FloorLevel[],
): FloorLevel[] {
  return floors.map((fl, _i, arr) => reconcileFloorWallTopology(fl, arr))
}
