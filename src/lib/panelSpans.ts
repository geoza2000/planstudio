import type { PanelSlot } from '../types/project'

/**
 * Clears and reapplies `spanAnchorId` / `spanWidthTe` so multi-TE modules stay consistent.
 * Follower cells point to the anchor slot `id`; anchor holds `spanWidthTe >= 1`.
 */
export function reconcilePanelSpans(slots: PanelSlot[], widthTe: number): PanelSlot[] {
  const byKey = new Map<string, PanelSlot>()
  for (const s of slots) {
    byKey.set(`${s.row},${s.col}`, { ...s, spanAnchorId: undefined })
  }

  const ordered = [...byKey.values()].sort((a, b) => (a.row - b.row) || (a.col - b.col))

  for (const anchor of ordered) {
    const w = Math.max(1, Math.floor(anchor.spanWidthTe ?? 1))
    const maxSpan = Math.max(1, widthTe - anchor.col)
    const span = Math.min(w, maxSpan)
    const anchorId = anchor.id
    for (let dc = 1; dc < span; dc++) {
      const c = anchor.col + dc
      if (c >= widthTe) break
      const key = `${anchor.row},${c}`
      const cell = byKey.get(key)
      if (cell) {
        byKey.set(key, { ...cell, spanAnchorId: anchorId, spanWidthTe: 1 })
      }
    }
    const self = byKey.get(`${anchor.row},${anchor.col}`)
    if (self) {
      byKey.set(`${anchor.row},${anchor.col}`, { ...self, spanWidthTe: span, spanAnchorId: undefined })
    }
  }

  return [...byKey.values()].sort((a, b) => (a.row - b.row) || (a.col - b.col))
}

export function slotPixelBounds(opts: {
  row: number
  col: number
  spanWidthTe: number
  cellW: number
  cellH: number
  gap: number
  pad: number
  header: number
}): { x: number; y: number; width: number; height: number } {
  const { row, col, spanWidthTe, cellW, cellH, gap, pad, header } = opts
  const w = spanWidthTe * cellW + (spanWidthTe - 1) * gap
  const x = pad + col * (cellW + gap)
  const y = pad + header + row * (cellH + gap)
  return { x, y, width: w, height: cellH }
}

export function anchorSlotForCell(
  slots: PanelSlot[],
  row: number,
  col: number,
): PanelSlot | undefined {
  const cell = slots.find((s) => s.row === row && s.col === col)
  if (!cell) return undefined
  if (!cell.spanAnchorId) return cell
  return slots.find((s) => s.id === cell.spanAnchorId)
}
