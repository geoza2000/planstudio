import { nanoid } from 'nanoid'
import { DEFAULT_BILL_CATEGORY, DEFAULT_UNIT_PRICE, defaultPanelProductName } from './billable'
import { reconcilePanelSpans } from './panelSpans'
import type { PanelBoard, PanelModuleType, PanelSlot } from '../types/project'

function freshSlot(row: number, col: number): PanelSlot {
  const moduleType: PanelModuleType = 'blank'
  return {
    id: nanoid(),
    row,
    col,
    moduleType,
    label: '',
    circuitRef: '',
    spanWidthTe: 1,
    productName: defaultPanelProductName(row, col, moduleType, ''),
    unitPrice: DEFAULT_UNIT_PRICE,
    billCategory: DEFAULT_BILL_CATEGORY,
  }
}

/** Resize grid; preserve existing cells where coordinates still fit; fill gaps with blanks. */
export function resizePanelBoard(panel: PanelBoard, rows: number, widthTe: number): PanelBoard {
  const r = Math.max(1, Math.floor(rows))
  const w = Math.max(1, Math.floor(widthTe))
  const prevByPos = new Map<string, PanelSlot>()
  for (const slot of panel.slots) {
    if (!slot.spanAnchorId && slot.row < r && slot.col < w) {
      prevByPos.set(`${slot.row},${slot.col}`, {
        ...slot,
        spanWidthTe: Math.min(Math.max(1, slot.spanWidthTe), w - slot.col),
      })
    }
  }

  const next: PanelSlot[] = []
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < w; col++) {
      const key = `${row},${col}`
      const prev = prevByPos.get(key)
      if (prev) {
        next.push({
          ...prev,
          row,
          col,
          spanAnchorId: undefined,
        })
      } else {
        next.push(freshSlot(row, col))
      }
    }
  }

  return {
    rows: r,
    widthTe: w,
    slots: reconcilePanelSpans(next, w),
    modulePalette: panel.modulePalette ?? [],
  }
}
