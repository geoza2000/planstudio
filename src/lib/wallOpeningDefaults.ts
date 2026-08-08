import type { WallOpening, WallOpeningKind, WallSheet } from '../types/project'

const DOOR_W = 0.9
const DOOR_H = 2.0
const WIN_W = 1.2
const WIN_H = 1.2

function clamp2(
  w: WallSheet,
  o: { xM: number; zM: number; widthM: number; heightM: number; kind: WallOpeningKind },
): { xM: number; zM: number; widthM: number; heightM: number; kind: WallOpeningKind } {
  const halfW = o.widthM / 2
  const halfH = o.heightM / 2
  return {
    kind: o.kind,
    xM: Math.min(w.lengthM - halfW, Math.max(halfW, o.xM)),
    zM: Math.min(w.heightM - halfH, Math.max(halfH, o.zM)),
    widthM: o.widthM,
    heightM: o.heightM,
  }
}

/**
 * `xM` = click position along the wall; vertical center follows typical sill / floor rules.
 */
export function newWallOpeningMeters(
  w: WallSheet,
  kind: WallOpeningKind,
  xM: number,
  zMClick: number,
): Omit<WallOpening, 'id' | 'label'> {
  if (kind === 'door') {
    return clamp2(w, {
      kind: 'door',
      xM,
      zM: zMClick,
      widthM: DOOR_W,
      heightM: DOOR_H,
    })
  }
  return clamp2(w, {
    kind: 'window',
    xM,
    zM: zMClick,
    widthM: WIN_W,
    heightM: WIN_H,
  })
}

/** Smallest usable opening dimension (m). */
export const MIN_WALL_OPENING_SIZE_M = 0.2

/**
 * Keep a width / height edit positive and no larger than the wall itself, so
 * `clampWallOpeningMeters` always has a valid rectangle to place.
 */
export function clampWallOpeningSizeM(value: number, wallExtentM: number): number {
  if (!Number.isFinite(value)) return MIN_WALL_OPENING_SIZE_M
  const max = Math.max(MIN_WALL_OPENING_SIZE_M, wallExtentM)
  return Math.min(max, Math.max(MIN_WALL_OPENING_SIZE_M, value))
}

/**
 * Re-clamp an opening after a drag or size edit so it stays within the wall rectangle.
 */
export function clampWallOpeningMeters(
  w: WallSheet,
  o: WallOpening,
): WallOpening {
  return {
    ...o,
    ...clamp2(w, {
      kind: o.kind,
      xM: o.xM,
      zM: o.zM,
      widthM: o.widthM,
      heightM: o.heightM,
    }),
  }
}
