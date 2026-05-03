import { anchorSlotForCell } from './panelSpans'
import type { PanelSlot } from '../types/project'

/**
 * Number of TE columns that anchor `a` actually occupies, clamped to the rail.
 */
export function effectiveSpanForAnchorAt(a: PanelSlot, widthTe: number): number {
  return Math.max(1, Math.min(a.spanWidthTe ?? 1, widthTe - a.col))
}

/** Inclusive [from, to] column indices in this row. */
export function anchorFootprintColumns(
  a: PanelSlot,
  widthTe: number,
): { from: number; to: number } {
  const span = effectiveSpanForAnchorAt(a, widthTe)
  return { from: a.col, to: a.col + span - 1 }
}

/**
 * Whether an anchor of width `width` can start at (row, col) without colliding with any other
 * *anchor footprint* (followers count as their anchor's occupancy). The anchor being resized or
 * moved is passed as `ignoreSlotId` so its own cells are not treated as blockers.
 *
 * Only 1+ TE **blank** regions may be fully replaced; any MCB, spare, or non-blank in the
 * span causes rejection, as does another module whose footprint is only partly inside the span
 * (would be “cut through” if applied).
 */
export function canPlaceAt(
  slots: PanelSlot[],
  widthTe: number,
  row: number,
  col: number,
  width: number,
  ignoreSlotId?: string,
): boolean {
  if (col < 0 || col >= widthTe) return false
  const s = Math.min(Math.max(1, Math.floor(width)), widthTe - col)
  if (s < 1) return false
  for (let c = col; c < col + s; c++) {
    const a = anchorSlotForCell(slots, row, c)
    if (!a) return false
    if (ignoreSlotId && a.id === ignoreSlotId) continue
    if (a.moduleType !== 'blank') return false
    const { from, to } = anchorFootprintColumns(a, widthTe)
    if (from < col || to > col + s - 1) return false
  }
  return true
}

/** Maximum TE width (≥1) for an anchor at (row, col), or 0 if none. */
export function maxPlaceableWidth(
  slots: PanelSlot[],
  widthTe: number,
  row: number,
  col: number,
  ignoreSlotId?: string,
): number {
  for (let s = widthTe - col; s >= 1; s--) {
    if (canPlaceAt(slots, widthTe, row, col, s, ignoreSlotId)) {
      return s
    }
  }
  return 0
}
