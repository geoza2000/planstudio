import type { FloorLevel, WallOpening, WallSheet } from '../types/project'
import { segmentLengthM } from './wallPlanSync'
import {
  openingWithSyncedPlanAlong,
  planAlongSeg01FromOpeningXM,
} from './wallOpeningAlongSegment'

/**
 * Opening sync:
 * - **Plan segment** (`wallSegmentId`): one logical hole is shared across every sheet on
 *   that segment whose chord (`planSpanAlongSegment01`) overlaps the opening’s extent in
 *   segment t∈[0,1]. Inserts add copies; updates move geometry between sub-walls; removes
 *   strip all copies. `planAlongSeg01` is the canonical center along the parent segment.
 * - **Else** `openingsGroupId`: classic two-face partition (no segment id on custom walls
 *   falls through to single-sheet paths where group is absent).
 */

function cloneOpening(o: WallOpening): WallOpening {
  return { ...o }
}

function span01(w: WallSheet) {
  return w.planSpanAlongSegment01 ?? { t0: 0, t1: 1 }
}

function segmentOf(fl: FloorLevel, segmentId: string | undefined) {
  return segmentId ? (fl.plan.wallSegments?.find((s) => s.id === segmentId) ?? null) : null
}

/** Opening centre along segment (from `xM` on `sheet`) and extent [t0,t1] in 0…1. */
function planInterval01ForOpeningGeometry(
  fl: FloorLevel,
  sheet: WallSheet,
  o: Pick<WallOpening, 'xM' | 'widthM' | 'planAlongSeg01'>,
): { t0: number; t1: number; u: number } {
  const u = planAlongSeg01FromOpeningXM(fl, sheet, o.xM)
  const seg = segmentOf(fl, sheet.wallSegmentId)
  const L = seg ? segmentLengthM(seg.a, seg.b) : 0
  if (L < 1e-9) return { t0: u, t1: u, u }
  const half = (o.widthM / 2) / L
  return { t0: Math.max(0, u - half), t1: Math.min(1, u + half), u }
}

function spansOverlap01(
  a: { t0: number; t1: number },
  b: { t0: number; t1: number },
  eps = 1e-4,
): boolean {
  return Math.max(a.t0, b.t0) < Math.min(a.t1, b.t1) - eps
}

function withGroupedOpeningMutation(
  fl: FloorLevel,
  groupId: string,
  openingId: string,
  mutate: (current: WallOpening | null, sheet: WallSheet) => WallOpening | null,
): FloorLevel {
  return {
    ...fl,
    wallSheets: fl.wallSheets.map((w) => {
      if (w.openingsGroupId !== groupId) return w
      const idx = w.openings.findIndex((o) => o.id === openingId)
      const cur = idx >= 0 ? w.openings[idx]! : null
      const next = mutate(cur, w)
      if (!next) {
        return { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
      }
      if (idx < 0) {
        return { ...w, openings: [...w.openings, cloneOpening(next)] }
      }
      return {
        ...w,
        openings: w.openings.map((o, i) => (i === idx ? cloneOpening(next) : o)),
      }
    }),
  }
}

/**
 * Insert `opening` on the host sheet and every other plan-linked sheet on the same
 * `wallSegmentId` whose chord overlaps the opening along the segment; or same
 * `openingsGroupId` when there is no segment; else host only.
 */
export function insertGroupedOpening(
  fl: FloorLevel,
  wallSheetId: string,
  opening: WallOpening,
): FloorLevel {
  const host = fl.wallSheets.find((w) => w.id === wallSheetId)
  if (!host) return fl

  if (host.wallSegmentId) {
    const iv = planInterval01ForOpeningGeometry(fl, host, opening)
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) => {
        if (w.wallSegmentId !== host.wallSegmentId) return w
        if (!spansOverlap01(span01(w), { t0: iv.t0, t1: iv.t1 })) return w
        if (w.openings.some((o) => o.id === opening.id)) return w
        const next = openingWithSyncedPlanAlong(
          fl,
          w,
          { ...opening, planAlongSeg01: iv.u },
          iv.u,
        )
        return { ...w, openings: [...w.openings, cloneOpening(next)] }
      }),
    }
  }

  const groupId = host.openingsGroupId
  if (!groupId) {
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) =>
        w.id === wallSheetId
          ? { ...w, openings: [...w.openings, cloneOpening(opening)] }
          : w,
      ),
    }
  }
  const u =
    opening.planAlongSeg01 ?? planAlongSeg01FromOpeningXM(fl, host, opening.xM)
  return {
    ...fl,
    wallSheets: fl.wallSheets.map((w) => {
      if (w.openingsGroupId !== groupId) return w
      const next = openingWithSyncedPlanAlong(fl, w, { ...opening, planAlongSeg01: u }, u)
      return { ...w, openings: [...w.openings, cloneOpening(next)] }
    }),
  }
}

/**
 * Merge `partial` into the opening on `wallSheetId` and mirror to every linked sheet
 * (same segment overlap, or same `openingsGroupId`).
 */
export function updateGroupedOpening(
  fl: FloorLevel,
  wallSheetId: string,
  openingId: string,
  partial: Partial<Omit<WallOpening, 'id' | 'kind'>>,
): FloorLevel {
  const host = fl.wallSheets.find((w) => w.id === wallSheetId)
  if (!host) return fl
  const hostOpening = host.openings.find((o) => o.id === openingId)
  if (!hostOpening) {
    return fl
  }
  const hostMerged = { ...hostOpening, ...partial }

  if (host.wallSegmentId) {
    const uCanon = planAlongSeg01FromOpeningXM(fl, host, hostMerged.xM)
    const iv = planInterval01ForOpeningGeometry(fl, host, hostMerged)
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) => {
        if (w.wallSegmentId !== host.wallSegmentId && w.openings.some((o) => o.id === openingId)) {
          return { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
        }
        if (w.wallSegmentId !== host.wallSegmentId) return w

        const should = spansOverlap01(span01(w), { t0: iv.t0, t1: iv.t1 })
        const has = w.openings.some((o) => o.id === openingId)
        if (!should && has) {
          return { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
        }
        if (!should) return w

        const base = w.openings.find((o) => o.id === openingId) ?? hostOpening
        const mergedForSheet = {
          ...base,
          ...hostMerged,
          id: openingId,
          kind: hostMerged.kind,
        }
        const next = openingWithSyncedPlanAlong(fl, w, mergedForSheet, uCanon)
        if (has) {
          return {
            ...w,
            openings: w.openings.map((o) => (o.id === openingId ? next : o)),
          }
        }
        return { ...w, openings: [...w.openings, cloneOpening(next)] }
      }),
    }
  }

  const groupId = host.openingsGroupId
  if (!groupId) {
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) =>
        w.id === wallSheetId
          ? {
              ...w,
              openings: w.openings.map((o) =>
                o.id === openingId ? { ...o, ...partial } : o,
              ),
            }
          : w,
      ),
    }
  }
  const u = planAlongSeg01FromOpeningXM(fl, host, hostMerged.xM)
  return withGroupedOpeningMutation(fl, groupId, openingId, (cur, w) => {
    const base = cur ?? hostOpening
    return openingWithSyncedPlanAlong(
      fl,
      w,
      {
        ...base,
        ...hostMerged,
        id: openingId,
        kind: hostMerged.kind,
      },
      u,
    )
  })
}

/** Remove an opening everywhere it is linked (same plan segment chords, or group). */
export function removeGroupedOpening(
  fl: FloorLevel,
  wallSheetId: string,
  openingId: string,
): FloorLevel {
  const host = fl.wallSheets.find((w) => w.id === wallSheetId)
  if (!host) return fl

  if (host.wallSegmentId) {
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) => {
        if (w.wallSegmentId !== host.wallSegmentId) return w
        return { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
      }),
    }
  }

  const groupId = host.openingsGroupId
  if (!groupId) {
    return {
      ...fl,
      wallSheets: fl.wallSheets.map((w) =>
        w.id === wallSheetId
          ? { ...w, openings: w.openings.filter((o) => o.id !== openingId) }
          : w,
      ),
    }
  }
  return withGroupedOpeningMutation(fl, groupId, openingId, () => null)
}

/**
 * After geometry / sheet length changes, recompute each grouped opening’s `planAlongSeg01`
 * and per-sheet `xM` from the first sheet in the group that already carries the opening.
 */
export function resyncGroupedOpeningPositionsForFloor(fl: FloorLevel): FloorLevel {
  const byGroup = new Map<string, WallSheet[]>()
  for (const w of fl.wallSheets) {
    if (!w.openingsGroupId) continue
    if (!byGroup.has(w.openingsGroupId)) byGroup.set(w.openingsGroupId, [])
    byGroup.get(w.openingsGroupId)!.push(w)
  }

  let wallSheets = fl.wallSheets
  for (const [, group] of byGroup) {
    if (group.length < 2) continue
    const host =
      group.find((g) => (g.openings?.length ?? 0) > 0) ?? group[0]!
    const ids = new Set<string>()
    for (const g of group) {
      for (const o of g.openings ?? []) ids.add(o.id)
    }
    for (const oid of ids) {
      const ho = host.openings?.find((o) => o.id === oid)
      if (!ho) continue
      const u = planAlongSeg01FromOpeningXM(fl, host, ho.xM)
      wallSheets = wallSheets.map((w) => {
        if (!group.some((g) => g.id === w.id)) return w
        const o = w.openings.find((x) => x.id === oid)
        if (!o) return w
        const next = openingWithSyncedPlanAlong(fl, w, { ...ho, id: oid, kind: ho.kind }, u)
        return {
          ...w,
          openings: w.openings.map((x) => (x.id === oid ? next : x)),
        }
      })
    }
  }
  wallSheets = resyncSegmentLinkedOpeningsForFloor({ ...fl, wallSheets })
  return { ...fl, wallSheets }
}

/**
 * Recompute `xM` / `planAlongSeg01` for every opening id shared across sheets on the same
 * `wallSegmentId`, using the widest chord sheet as canonical host (stable after reconcile).
 */
function resyncSegmentLinkedOpeningsForFloor(fl: FloorLevel): WallSheet[] {
  const bySeg = new Map<string, WallSheet[]>()
  for (const w of fl.wallSheets) {
    if (!w.wallSegmentId) continue
    if (!bySeg.has(w.wallSegmentId)) bySeg.set(w.wallSegmentId, [])
    bySeg.get(w.wallSegmentId)!.push(w)
  }

  let sheets = fl.wallSheets
  for (const [, list] of bySeg) {
    if (list.length < 2) continue
    const ids = new Set<string>()
    for (const w of list) {
      for (const o of w.openings ?? []) ids.add(o.id)
    }
    for (const oid of ids) {
      const holders = list.filter((w) => w.openings.some((o) => o.id === oid))
      if (holders.length === 0) continue
      const hostW = holders.reduce((a, b) => (a.lengthM >= b.lengthM ? a : b))
      const ho = hostW.openings.find((o) => o.id === oid)!
      const uCanon = planAlongSeg01FromOpeningXM(fl, hostW, ho.xM)
      const iv = planInterval01ForOpeningGeometry(fl, hostW, ho)
      sheets = sheets.map((w) => {
        if (w.wallSegmentId !== hostW.wallSegmentId && w.openings.some((o) => o.id === oid)) {
          return { ...w, openings: w.openings.filter((o) => o.id !== oid) }
        }
        if (w.wallSegmentId !== hostW.wallSegmentId) return w
        const should = spansOverlap01(span01(w), { t0: iv.t0, t1: iv.t1 })
        const has = w.openings.some((o) => o.id === oid)
        if (!should && has) {
          return { ...w, openings: w.openings.filter((o) => o.id !== oid) }
        }
        if (!should) return w
        const next = openingWithSyncedPlanAlong(fl, w, { ...ho, id: oid, kind: ho.kind }, uCanon)
        if (has) {
          return {
            ...w,
            openings: w.openings.map((o) => (o.id === oid ? next : o)),
          }
        }
        return { ...w, openings: [...w.openings, cloneOpening(next)] }
      })
    }
  }
  return sheets
}

/** True when this sheet shares an opening (same `openingsGroupId` or same plan segment). */
export function sheetHasPairedOpenings(fl: FloorLevel, sheet: WallSheet): boolean {
  if (sheet.wallSegmentId) {
    for (const o of sheet.openings ?? []) {
      for (const w of fl.wallSheets) {
        if (w.id === sheet.id || w.wallSegmentId !== sheet.wallSegmentId) continue
        if (w.openings?.some((x) => x.id === o.id)) return true
      }
    }
  }
  if (!sheet.openingsGroupId) return false
  let count = 0
  for (const w of fl.wallSheets) {
    if (w.openingsGroupId === sheet.openingsGroupId) {
      count += 1
      if (count > 1) return true
    }
  }
  return false
}
