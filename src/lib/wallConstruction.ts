import {
  DEFAULT_WALL_THICKNESS_M,
  type EditorSettings,
  type WallMaterial,
  type WallSegment,
  type WallSheet,
} from '../types/project'

/** Sanity range for the thickness inputs (m) — a 5 cm stud partition up to a 1 m stone base. */
export const MIN_WALL_THICKNESS_M = 0.05
export const MAX_WALL_THICKNESS_M = 1

export function clampWallThicknessM(m: number): number {
  if (!Number.isFinite(m)) return DEFAULT_WALL_THICKNESS_M
  return Math.min(MAX_WALL_THICKNESS_M, Math.max(MIN_WALL_THICKNESS_M, m))
}

export function isWallMaterial(x: unknown): x is WallMaterial {
  return x === 'painted' || x === 'rock'
}

type WallDefaults = Pick<EditorSettings, 'defaultWallThicknessM' | 'defaultWallMaterial'>

/** Thickness actually used for a segment (own value, else the project default). */
export function effectiveWallThicknessM(
  seg: Pick<WallSegment, 'thicknessM'> | undefined,
  settings: WallDefaults,
): number {
  const own = seg?.thicknessM
  if (typeof own === 'number' && Number.isFinite(own)) return clampWallThicknessM(own)
  return clampWallThicknessM(settings.defaultWallThicknessM)
}

/** Material actually used for a segment (own value, else the project default). */
export function effectiveWallMaterial(
  seg: Pick<WallSegment, 'material'> | undefined,
  settings: WallDefaults,
): WallMaterial {
  if (isWallMaterial(seg?.material)) return seg.material
  return isWallMaterial(settings.defaultWallMaterial) ? settings.defaultWallMaterial : 'painted'
}

/**
 * Finish seen from inside one room: the sheet's own override wins, otherwise the
 * physical wall's material (or the project default for custom, plan-less sheets).
 */
export function effectiveWallFaceMaterial(
  sheet: Pick<WallSheet, 'materialOverride'> | undefined,
  seg: Pick<WallSegment, 'material'> | undefined,
  settings: WallDefaults,
): WallMaterial {
  if (isWallMaterial(sheet?.materialOverride)) return sheet.materialOverride
  return effectiveWallMaterial(seg, settings)
}

/** Plan stroke colour per finish (selected walls are drawn white by the editor). */
export function wallMaterialPlanStroke(m: WallMaterial): string {
  return m === 'rock' ? '#b7a99a' : '#e0e6ed'
}

/** Inner hatch colour drawn along rock walls so the finish reads at a glance. */
export function wallMaterialPlanHatch(m: WallMaterial): string | null {
  return m === 'rock' ? 'rgba(74, 60, 48, 0.75)' : null
}
