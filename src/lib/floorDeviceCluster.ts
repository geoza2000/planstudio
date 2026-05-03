import type { FloorDevice, FloorLevel, PointM } from '../types/project'

export const FLOOR_DEVICE_CLUSTER_RADIUS_M = 0.25

export const DEFAULT_CEILING_HEIGHT_M = 2.4

export function floorPlanDevicesNear(
  devices: FloorDevice[],
  p: PointM,
  radiusM: number,
): FloorDevice[] {
  const r2 = radiusM * radiusM
  return devices.filter((d) => {
    const dx = d.x - p.x
    const dy = d.y - p.y
    return dx * dx + dy * dy <= r2
  })
}

/** Vertical position (m above floor) for ordering overlapping plan icons. */
export function floorDeviceVerticalSortM(d: FloorDevice, fl: FloorLevel): number {
  const mounting = d.mounting ?? 'floor'
  if (mounting === 'ceiling') {
    return Number.isFinite(d.ceilingHeightM)
      ? (d.ceilingHeightM as number)
      : DEFAULT_CEILING_HEIGHT_M
  }
  if (d.linkedWallDeviceId) {
    for (const ws of fl.wallSheets) {
      const w = ws.devices.find((x) => x.id === d.linkedWallDeviceId)
      if (w) return w.zM
    }
  }
  if (mounting === 'wall') return 1.2
  return 0
}

export function sortFloorDevicesByHeightDesc(
  ds: FloorDevice[],
  fl: FloorLevel,
): FloorDevice[] {
  return [...ds].sort(
    (a, b) => floorDeviceVerticalSortM(b, fl) - floorDeviceVerticalSortM(a, fl),
  )
}
