import { MM_PER_DIN_ROW, MM_PER_TE } from './dinScale'

/** Screen scale: px per real mm (see PanelEditor). */
export const PANEL_PX_PER_MM = 2.35
export const PANEL_GRID_GAP = 4
export const PANEL_PAD = 20
export const PANEL_HEADER = 48

export function panelCellMetrics(): { cellW: number; cellH: number } {
  const cellW = MM_PER_TE * PANEL_PX_PER_MM
  const cellH = MM_PER_DIN_ROW * PANEL_PX_PER_MM
  return { cellW, cellH }
}

export function panelStageSize(widthTe: number, rows: number): { width: number; height: number } {
  const { cellW, cellH } = panelCellMetrics()
  const w = PANEL_PAD * 2 + widthTe * cellW + (widthTe - 1) * PANEL_GRID_GAP
  const h = PANEL_PAD * 2 + PANEL_HEADER + rows * cellH + (rows - 1) * PANEL_GRID_GAP
  return { width: w, height: h }
}

/**
 * Map a pointer position inside a panel editor element to a DIN grid (row, col), or `null` if
 * the point is in padding, header, or the inter-cell gap.
 */
export function clientToPanelDinCell(
  clientX: number,
  clientY: number,
  el: HTMLElement,
  widthTe: number,
  rows: number,
): { row: number; col: number } | null {
  const r = el.getBoundingClientRect()
  const x = clientX - r.left
  const y = clientY - r.top
  const { cellW, cellH } = panelCellMetrics()
  if (x < PANEL_PAD || y < PANEL_PAD + PANEL_HEADER) return null
  if (x >= r.width - PANEL_PAD || y >= r.height - PANEL_PAD) return null

  const innerX = x - PANEL_PAD
  const innerY = y - PANEL_PAD - PANEL_HEADER
  const cPitch = cellW + PANEL_GRID_GAP
  const rPitch = cellH + PANEL_GRID_GAP

  const col = Math.floor(innerX / cPitch)
  if (col < 0 || col >= widthTe) return null
  if (innerX - col * cPitch > cellW) return null

  const row = Math.floor(innerY / rPitch)
  if (row < 0 || row >= rows) return null
  if (innerY - row * rPitch > cellH) return null

  return { row, col }
}
