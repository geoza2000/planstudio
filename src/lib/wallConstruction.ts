import {
  DEFAULT_LOW_WALL_HEIGHT_M,
  DEFAULT_WALL_THICKNESS_M,
  type EditorSettings,
  type WallForm,
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

export function isWallForm(x: unknown): x is WallForm {
  return x === 'full' || x === 'low' || x === 'open'
}

/** Sanity range for low-wall heights (m): a kerb up to a tall garden wall. */
export const MIN_LOW_WALL_HEIGHT_M = 0.1
export const MAX_LOW_WALL_HEIGHT_M = 2

export function clampLowWallHeightM(m: number): number {
  if (!Number.isFinite(m)) return DEFAULT_LOW_WALL_HEIGHT_M
  return Math.min(MAX_LOW_WALL_HEIGHT_M, Math.max(MIN_LOW_WALL_HEIGHT_M, m))
}

/** Vertical form actually used for a segment (unset → full height). */
export function effectiveWallForm(seg: Pick<WallSegment, 'form'> | undefined): WallForm {
  return isWallForm(seg?.form) ? seg.form : 'full'
}

/** Height of a low wall (own value, else the default parapet height). */
export function effectiveLowWallHeightM(seg: Pick<WallSegment, 'lowHeightM'> | undefined): number {
  const own = seg?.lowHeightM
  if (typeof own === 'number' && Number.isFinite(own)) return clampLowWallHeightM(own)
  return DEFAULT_LOW_WALL_HEIGHT_M
}

/** Plan dash pattern per form so fences and open edges read differently from real walls. */
export function wallFormPlanDash(f: WallForm): number[] | undefined {
  if (f === 'open') return [6, 6]
  if (f === 'low') return [14, 4]
  return undefined
}

/** Plan stroke opacity per form. */
export function wallFormPlanOpacity(f: WallForm): number {
  if (f === 'open') return 0.45
  if (f === 'low') return 0.75
  return 1
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
