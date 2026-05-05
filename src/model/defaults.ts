import { nanoid } from 'nanoid'
import {
  DEFAULT_UNIT_PRICE,
  defaultBillableFields,
  defaultPanelProductName,
} from '../lib/billable'
import { reconcilePanelSpans } from '../lib/panelSpans'
import type { FloorLevel, KnxLine, PanelSlot, PlanstudioProject } from '../types/project'
import { SCHEMA_VERSION } from '../types/project'

export function emptyPanelSlot(row: number, col: number): PanelSlot {
  const moduleType: PanelSlot['moduleType'] = 'blank'
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
    billCategory: 'standard',
  }
}

export function initPanelSlots(rows: number, widthTe: number): PanelSlot[] {
  const slots: PanelSlot[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < widthTe; c++) {
      slots.push(emptyPanelSlot(r, c))
    }
  }
  return reconcilePanelSpans(slots, widthTe)
}

function emptyPlan(label: string, widthM: number, depthM: number) {
  return {
    label,
    widthM,
    depthM,
    wallSegments: [] as FloorLevel['plan']['wallSegments'],
    devices: [] as FloorLevel['plan']['devices'],
    regions: [] as FloorLevel['plan']['regions'],
  }
}

/** Default KNX / bus line names (ids stable for JSON); user may rename or add lines on the Panel tab. */
export const DEFAULT_KNX_LINES: KnxLine[] = [
  { id: 'knx-line-ground', label: 'Ground floor apartment', sortOrder: 0 },
  { id: 'knx-line-first', label: 'First floor apartment', sortOrder: 1 },
  { id: 'knx-line-common', label: 'Common areas', sortOrder: 2 },
]

export function createFloorLevel(
  label: string,
  sortOrder: number,
  planLabel: string,
  widthM: number,
  depthM: number,
): FloorLevel {
  const id = nanoid()
  const plan = emptyPlan(planLabel, widthM, depthM)
  const wallSheets = [] as FloorLevel['wallSheets']
  return { id, label, sortOrder, plan, wallSheets }
}

export function createInitialProject(): PlanstudioProject {
  const now = new Date().toISOString()
  const ground = createFloorLevel('Ground', 0, 'Ground plan', 14, 10)
  const upper = createFloorLevel('Upper', 1, 'Upper plan', 12, 9)

  return {
    schemaVersion: SCHEMA_VERSION,
    name: 'Untitled project',
    updatedAt: now,
    floors: [ground, upper],
    knxLines: DEFAULT_KNX_LINES.map((l) => ({ ...l })),
    panel: {
      rows: 3,
      widthTe: 18,
      slots: initPanelSlots(3, 18),
      modulePalette: [],
    },
    rack: {
      totalRU: 12,
      widthLabel: '19" / 600mm',
      enclosureProductName: 'Rack enclosure',
      enclosureUnitPrice: 0,
      enclosureBillCategory: 'standard',
      gear: [
        {
          id: nanoid(),
          ...defaultBillableFields({ productName: 'Patch panel 24p' }),
          startRU: 1,
          heightRU: 1,
          notes: '',
        },
        {
          id: nanoid(),
          ...defaultBillableFields({ productName: 'PoE switch' }),
          startRU: 2,
          heightRU: 1,
          notes: '',
        },
      ],
      patchPanelLinks: [],
      portLinks: [],
    },
    editorSettings: {
      snapGridM: 0.1,
      wallOrtho: true,
    },
    deviceCatalog: [],
  }
}
