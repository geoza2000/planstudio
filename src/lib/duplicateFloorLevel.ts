import { nanoid } from 'nanoid'
import type { FloorLevel, Id } from '../types/project'

function remapWallCycleSignature(sig: string, segMap: Map<Id, Id>): string {
  const parts = sig.split('|').filter(Boolean)
  if (parts.length === 0) return sig
  return [...parts.map((p) => segMap.get(p) ?? p)].sort((a, b) => a.localeCompare(b)).join('|')
}

export type CloneFloorWithNewIdsResult = {
  floor: FloorLevel
  /** Old plan device id → new id (for rack patch links, etc.). */
  floorDeviceIdMap: Map<Id, Id>
  /** Old wall-mount device id → new id. */
  wallDeviceIdMap: Map<Id, Id>
}

/**
 * Deep-clone a floor with fresh ids for the floor, plan geometry, devices, regions,
 * wall sheets, wall devices, and openings. Preserves intra-floor links and
 * `wallCycleSignature` / opening groups in terms of the new segment and group ids.
 */
export function cloneFloorWithNewIds(source: FloorLevel): CloneFloorWithNewIdsResult {
  const floorId = nanoid()

  const segMap = new Map<Id, Id>()
  for (const seg of source.plan.wallSegments) {
    segMap.set(seg.id, nanoid())
  }

  const floorDeviceIdMap = new Map<Id, Id>()
  for (const d of source.plan.devices) {
    floorDeviceIdMap.set(d.id, nanoid())
  }

  const regionMap = new Map<Id, Id>()
  for (const r of source.plan.regions) {
    regionMap.set(r.id, nanoid())
  }

  const openingMap = new Map<Id, Id>()
  for (const ws of source.wallSheets) {
    for (const o of ws.openings) {
      openingMap.set(o.id, nanoid())
    }
  }

  const sheetMap = new Map<Id, Id>()
  for (const ws of source.wallSheets) {
    sheetMap.set(ws.id, nanoid())
  }

  const wallDeviceIdMap = new Map<Id, Id>()
  for (const ws of source.wallSheets) {
    for (const d of ws.devices) {
      wallDeviceIdMap.set(d.id, nanoid())
    }
  }

  const openingsGroupMap = new Map<Id, Id>()
  for (const ws of source.wallSheets) {
    const g = ws.openingsGroupId
    if (g && !openingsGroupMap.has(g)) {
      openingsGroupMap.set(g, nanoid())
    }
  }

  const plan = {
    ...source.plan,
    wallSegments: source.plan.wallSegments.map((seg) => ({
      ...seg,
      id: segMap.get(seg.id)!,
    })),
    devices: source.plan.devices.map((d) => ({
      ...d,
      id: floorDeviceIdMap.get(d.id)!,
      linkedWallDeviceId:
        d.linkedWallDeviceId && wallDeviceIdMap.has(d.linkedWallDeviceId)
          ? wallDeviceIdMap.get(d.linkedWallDeviceId)
          : undefined,
    })),
    furniture: (source.plan.furniture ?? []).map((f) => ({
      ...f,
      id: nanoid(),
      roomRegionId:
        f.roomRegionId && regionMap.has(f.roomRegionId)
          ? regionMap.get(f.roomRegionId)
          : undefined,
    })),
    regions: source.plan.regions.map((r) => ({
      ...r,
      id: regionMap.get(r.id)!,
      parentRegionId:
        r.parentRegionId && regionMap.has(r.parentRegionId)
          ? regionMap.get(r.parentRegionId)
          : undefined,
      wallCycleSignature: r.wallCycleSignature
        ? remapWallCycleSignature(r.wallCycleSignature, segMap)
        : undefined,
    })),
  }

  const wallSheets = source.wallSheets.map((ws) => ({
    ...ws,
    id: sheetMap.get(ws.id)!,
    floorLevelId: floorId,
    wallSegmentId:
      ws.wallSegmentId && segMap.has(ws.wallSegmentId) ? segMap.get(ws.wallSegmentId) : undefined,
    roomRegionId:
      ws.roomRegionId && regionMap.has(ws.roomRegionId) ? regionMap.get(ws.roomRegionId) : undefined,
    openingsGroupId:
      ws.openingsGroupId && openingsGroupMap.has(ws.openingsGroupId)
        ? openingsGroupMap.get(ws.openingsGroupId)
        : undefined,
    devices: ws.devices.map((d) => ({
      ...d,
      id: wallDeviceIdMap.get(d.id)!,
      linkedFloorDeviceId:
        d.linkedFloorDeviceId && floorDeviceIdMap.has(d.linkedFloorDeviceId)
          ? floorDeviceIdMap.get(d.linkedFloorDeviceId)
          : undefined,
    })),
    openings: ws.openings.map((o) => ({
      ...o,
      id: openingMap.get(o.id)!,
    })),
  }))

  const floor: FloorLevel = {
    id: floorId,
    label: source.label,
    sortOrder: source.sortOrder,
    plan,
    wallSheets,
  }

  return { floor, floorDeviceIdMap, wallDeviceIdMap }
}
