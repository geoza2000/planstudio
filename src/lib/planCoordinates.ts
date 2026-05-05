import type { PlanViewport } from './geometry'
import { FLOOR_PADDING_PX, PPM } from './renderScale'
import type { PointM } from '../types/project'

/** Insets of the wall elevation content rect in stage px — must match `WallElevationEditor` / `wallStageSize`. */
export const WALL_ELEVATION_INNER_X = 48
export const WALL_ELEVATION_INNER_Y = 36

/** Stage pixel coords → world meters (matches `computePlanViewport` origin + padding + PPM). */
export function planScreenPxToMeters(
  xPx: number,
  yPx: number,
  vp: PlanViewport,
): PointM {
  return {
    x: (xPx - FLOOR_PADDING_PX) / PPM + vp.originX,
    y: (yPx - FLOOR_PADDING_PX) / PPM + vp.originY,
  }
}

export function planMetersToScreenPx(
  p: PointM,
  vp: PlanViewport,
): { x: number; y: number } {
  return {
    x: FLOOR_PADDING_PX + (p.x - vp.originX) * PPM,
    y: FLOOR_PADDING_PX + (p.y - vp.originY) * PPM,
  }
}

type KonvaDragEventTarget = {
  getType(): string
  getParent(): KonvaDragEventTarget | null
  getAbsolutePosition: () => { x: number; y: number }
}

/** `onDragEnd` `target` is often a child; use the draggable Group in stage space. */
function stagePxFromDeviceDragEventTarget(target: KonvaDragEventTarget) {
  const g =
    target.getType() === 'Group' ? target : (target.getParent() as KonvaDragEventTarget)
  return g.getAbsolutePosition()
}

/** Meters for a floor plan device after drag, matching `planScreenPxToMeters` / FLOOR padding. */
export function planMetersFromFloorDeviceDragEnd(
  eventTarget: KonvaDragEventTarget,
  vp: PlanViewport,
): PointM {
  const { x, y } = stagePxFromDeviceDragEventTarget(eventTarget)
  return planScreenPxToMeters(x, y, vp)
}

/** Wall-elevation meters (along wall, height) from a pointer in **stage** pixels. */
export function wallPointerStagePxToMeters(
  xPx: number,
  yPx: number,
  heightM: number,
  innerX = WALL_ELEVATION_INNER_X,
  innerY = WALL_ELEVATION_INNER_Y,
  opts?: { lengthM: number; roomViewFlip: boolean },
) {
  let xM = (xPx - innerX) / PPM
  if (opts?.roomViewFlip) {
    xM = opts.lengthM - xM
  }
  const zM = heightM - (yPx - innerY) / PPM
  return { xM, zM }
}

/**
 * Map stored `xM` (segment chord, same as paired-face sync) → horizontal distance from
 * the left edge of the elevation **as seen from inside the room** facing the wall.
 * `wallFace === 'b'` reverses so the kitchen / “far” side matches the living-room view.
 */
export function wallElevationDisplayXM(
  storedXM: number,
  lengthM: number,
  wallFace: 'a' | 'b' | undefined,
): number {
  if (wallFace !== 'b' || lengthM <= 0) return storedXM
  return lengthM - storedXM
}

export function wallMetersFromWallDeviceDragEnd(
  eventTarget: KonvaDragEventTarget,
  heightM: number,
  innerX = WALL_ELEVATION_INNER_X,
  innerY = WALL_ELEVATION_INNER_Y,
  opts?: { lengthM: number; roomViewFlip: boolean },
) {
  const p = stagePxFromDeviceDragEventTarget(eventTarget)
  let xM = (p.x - innerX) / PPM
  if (opts?.roomViewFlip) {
    xM = opts.lengthM - xM
  }
  const zM = heightM - (p.y - innerY) / PPM
  return { xM, zM }
}
