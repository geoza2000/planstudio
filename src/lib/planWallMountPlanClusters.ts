import type { DeviceTemplate, FloorLevel, WallMountDevice, WallSheet } from '../types/project'
import { filterWallDevicesForElevationView } from './deviceCatalog'
import { along01ForWallMirrorOnPlan, worldXYForWallMirrorOnPlan } from './planWallMirrorPosition'
import { PPM } from './renderScale'
import { segmentLengthM } from './wallPlanSync'

/** Default ~10px along the wall at {@link PPM} px/m (see clustering rule in feature notes). */
export const PLAN_WALL_MOUNT_CLUSTER_EPS_PX = 10

export type PlanWallMountClusterItem = {
  sheet: WallSheet
  device: WallMountDevice
}

export type PlanWallMountCluster = {
  id: string
  segmentId: string
  items: PlanWallMountClusterItem[]
  /** Mean plan world (m) for icon placement */
  worldX: number
  worldY: number
}

type Placement = {
  segmentId: string
  u: number
  worldX: number
  worldY: number
  sheet: WallSheet
  device: WallMountDevice
}

/**
 * Groups wall-mount devices that mirror to nearby positions along the same plan wall segment.
 * Clustering uses distance along the segment in meters: `epsilonM = epsPx / PPM` (same scale as
 * the floor plan canvas).
 */
export function clusterWallMountDevicesForPlan(
  floorLevel: FloorLevel,
  catalog: DeviceTemplate[],
  epsPx: number = PLAN_WALL_MOUNT_CLUSTER_EPS_PX,
): PlanWallMountCluster[] {
  const plan = floorLevel.plan
  const epsM = epsPx / PPM
  const placements: Placement[] = []

  for (const sheet of floorLevel.wallSheets) {
    if (!sheet.wallSegmentId) continue
    const seg = plan.wallSegments.find((s) => s.id === sheet.wallSegmentId)
    if (!seg) continue

    const visible = filterWallDevicesForElevationView(sheet.devices, catalog)
    for (const device of visible) {
      const u = along01ForWallMirrorOnPlan(floorLevel, sheet, device.xM)
      if (u == null) continue
      const { x, y } = worldXYForWallMirrorOnPlan(floorLevel, sheet, device.xM)
      placements.push({
        segmentId: sheet.wallSegmentId,
        u,
        worldX: x,
        worldY: y,
        sheet,
        device,
      })
    }
  }

  const bySeg = new Map<string, Placement[]>()
  for (const p of placements) {
    const arr = bySeg.get(p.segmentId)
    if (arr) arr.push(p)
    else bySeg.set(p.segmentId, [p])
  }

  const clusters: PlanWallMountCluster[] = []
  let clusterSeq = 0

  for (const [segmentId, list] of bySeg) {
    const seg = plan.wallSegments.find((s) => s.id === segmentId)
    const L = seg ? segmentLengthM(seg.a, seg.b) : 0
    const duMax = L > 1e-9 ? epsM / L : 1

    list.sort((a, b) => a.u - b.u)

    let run: Placement[] = []
    const flush = () => {
      if (run.length === 0) return
      const sx = run.reduce((s, p) => s + p.worldX, 0) / run.length
      const sy = run.reduce((s, p) => s + p.worldY, 0) / run.length
      clusters.push({
        id: `wm-plan-${segmentId}-${clusterSeq++}`,
        segmentId,
        worldX: sx,
        worldY: sy,
        items: run.map((p) => ({ sheet: p.sheet, device: p.device })),
      })
      run = []
    }

    for (const p of list) {
      if (run.length === 0) {
        run.push(p)
        continue
      }
      const last = run[run.length - 1]!
      if (p.u - last.u <= duMax) {
        run.push(p)
      } else {
        flush()
        run.push(p)
      }
    }
    flush()
  }

  return clusters
}
