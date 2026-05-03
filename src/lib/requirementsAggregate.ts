import type {
  ConnectorSubtype,
  DeviceRequirements,
  DeviceType,
  FloorDevice,
  FloorLevel,
  Id,
  PlanstudioProject,
  RackFrame,
  WallMountDevice,
} from '../types/project'
import { deviceTypeRollupLabel } from '../types/project'
import { mergeRequirementsWithDeviceTypeDefaults } from './requirementDefaults'

export type RequirementsSummary = {
  deviceCount: number
  totalDinTe: number
  totalDinRailMm: number
  totalPoeWatts: number
  totalEthernetPorts: number
  cameraCount: number
  readerCount: number
  knxOutputActuatorCount: number
  knxBinaryInputCount: number
  knxBusSensorCount: number
}

function addReq(acc: RequirementsSummary, r: DeviceRequirements | undefined) {
  if (!r) return
  acc.totalDinTe += r.dinTe ?? 0
  acc.totalDinRailMm += r.dinRailMm ?? 0
  acc.totalPoeWatts += r.poeWatts ?? 0
  acc.totalEthernetPorts += r.ethernetPorts ?? 0
  if (r.knxChannelRole === 'output_actuator') acc.knxOutputActuatorCount += 1
  if (r.knxChannelRole === 'binary_input') acc.knxBinaryInputCount += 1
  if (r.knxChannelRole === 'bus_sensor') acc.knxBusSensorCount += 1
}

function collectFromFloorLevel(fl: FloorLevel, acc: RequirementsSummary) {
  for (const d of fl.plan.devices) {
    acc.deviceCount += 1
    addReq(acc, d.requirements)
    if (d.type === 'camera') acc.cameraCount += 1
    if (d.type === 'access_reader') acc.readerCount += 1
  }
  for (const ws of fl.wallSheets) {
    for (const w of ws.devices) {
      if (w.linkedFloorDeviceId) continue
      acc.deviceCount += 1
      addReq(acc, w.requirements)
      if (w.type === 'camera') acc.cameraCount += 1
      if (w.type === 'access_reader') acc.readerCount += 1
    }
  }
}

/** Occupied TE on the DIN panel (anchor cells only) and optional rail mm from slot fields. */
export function panelDinRollup(project: PlanstudioProject): {
  occupiedTe: number
  railMm: number
} {
  let occupiedTe = 0
  let railMm = 0
  for (const slot of project.panel.slots) {
    if (slot.spanAnchorId) continue
    const hasIdentity =
      Boolean(slot.catalogCode?.trim()) ||
      Boolean(slot.manufacturerLine?.trim()) ||
      Boolean(slot.description?.trim()) ||
      slot.moduleType !== 'blank'
    if (!hasIdentity) continue
    occupiedTe += Math.max(1, slot.spanWidthTe ?? 1)
    railMm += slot.dinRailSegmentMm ?? slot.railConsumeMm ?? 0
  }
  return { occupiedTe, railMm }
}

export type PlanVsInfraCell = { text: string; hint?: string }

export type PlanVsInfraRow = {
  metric: string
  required: PlanVsInfraCell
  panel: PlanVsInfraCell
  rack: PlanVsInfraCell
  gap: PlanVsInfraCell
}

/** Stable keys for `buildPlanVsPanelRackRows` — used to filter the rail by active editor tab. */
export const PLAN_VS_METRIC = {
  dinTe: 'DIN TE (Σ device metrics)',
  dinRail: 'DIN rail mm (Σ device metrics vs slot rail fields)',
  poe: 'PoE watts (Σ)',
  eth: 'Ethernet ports (Σ)',
  cameras: 'Cameras (by device kind)',
  readers: 'Access readers (by device kind)',
  knxOut: 'KNX / bus — outputs & actuators (loads)',
  knxIn: 'KNX / bus — binary inputs (switches)',
  knxSens: 'KNX / bus — sensors (e.g. motion)',
  rackU: 'Rack U (max used / total RU)',
} as const

export function planVsRowsForRequirementsRailTab(
  tab: 'panel' | 'rack' | 'full',
  rows: PlanVsInfraRow[],
): PlanVsInfraRow[] {
  if (tab === 'full') return rows
  if (tab === 'panel') {
    return rows.filter((r) => r.metric !== PLAN_VS_METRIC.rackU)
  }
  return rows.filter(
    (r) => r.metric !== PLAN_VS_METRIC.dinTe && r.metric !== PLAN_VS_METRIC.dinRail,
  )
}

const STRUCTURAL_ETH_TYPES: DeviceType[] = [
  'access_point',
  'generic_eth_device',
  'camera',
  'access_reader',
]

/** Ethernet / structured-cable class devices for rack BOM and patch planning (aligned with defaults + BOM kinds). */
export function deviceIsEthernetClassForRackRollup(d: {
  type: DeviceType
  connectorSubtype?: ConnectorSubtype
  requirements?: DeviceRequirements
}): boolean {
  if (d.type === 'connector') return (d.connectorSubtype ?? 'ethernet') !== 'fiber'
  if (STRUCTURAL_ETH_TYPES.includes(d.type)) return true
  const merged = mergeRequirementsWithDeviceTypeDefaults(
    d.type,
    d.requirements,
    d.connectorSubtype,
  )
  return (merged.ethernetPorts ?? 0) > 0
}

export type EthernetPlanSurface = 'floor' | 'wall'

export type EthernetPlanDeviceRow = {
  deviceId: Id
  floorLevelId: Id
  floorLabel: string
  surface: EthernetPlanSurface
  label: string
  kindLabel: string
  ethernetPorts: number
  circuitRef: string
}

function pushIfEthernet(
  fl: FloorLevel,
  surface: EthernetPlanSurface,
  d: FloorDevice | WallMountDevice,
  out: EthernetPlanDeviceRow[],
) {
  if (!deviceIsEthernetClassForRackRollup(d)) return
  const merged = mergeRequirementsWithDeviceTypeDefaults(
    d.type,
    d.requirements,
    d.connectorSubtype,
  )
  out.push({
    deviceId: d.id,
    floorLevelId: fl.id,
    floorLabel: fl.label,
    surface,
    label: d.label.trim() || d.productName || d.id.slice(0, 8),
    kindLabel: deviceTypeRollupLabel(d.type, d.connectorSubtype),
    ethernetPorts: merged.ethernetPorts ?? 0,
    circuitRef: d.circuitRef,
  })
}

/** Floor + unlinked wall devices (same scope as requirements rollup / BOM floor rows). */
export function collectEthernetClassPlanDevices(
  project: PlanstudioProject,
): EthernetPlanDeviceRow[] {
  const out: EthernetPlanDeviceRow[] = []
  for (const fl of project.floors) {
    for (const d of fl.plan.devices) {
      pushIfEthernet(fl, 'floor', d, out)
    }
    for (const ws of fl.wallSheets) {
      for (const w of ws.devices) {
        if (w.linkedFloorDeviceId) continue
        pushIfEthernet(fl, 'wall', w, out)
      }
    }
  }
  return out
}

/** Highest occupied U index (1-based startRU + height). */
export function rackOccupiedRUHigh(rack: RackFrame): number {
  let hi = 0
  for (const g of rack.gear) {
    const end = g.startRU + Math.max(0, g.heightRU) - 1
    if (end > hi) hi = end
  }
  return hi
}

export function buildPlanVsPanelRackRows(
  project: PlanstudioProject,
): PlanVsInfraRow[] {
  const req = buildRequirementsSummary(project)
  const { occupiedTe, railMm } = panelDinRollup(project)
  const rackHi = rackOccupiedRUHigh(project.rack)
  const totalRU = project.rack.totalRU
  const gearCount = project.rack.gear.length

  const dash = (hint: string): PlanVsInfraCell => ({ text: '—', hint })

  const num = (n: number): PlanVsInfraCell => ({ text: String(n) })

  const rows: PlanVsInfraRow[] = [
    {
      metric: PLAN_VS_METRIC.dinTe,
      required: num(req.totalDinTe),
      panel: num(occupiedTe),
      rack: dash('Rack has no DIN model'),
      gap: num(req.totalDinTe - occupiedTe),
    },
    {
      metric: PLAN_VS_METRIC.dinRail,
      required: num(req.totalDinRailMm),
      panel: num(railMm),
      rack: dash('Rack has no DIN rail model'),
      gap: num(req.totalDinRailMm - railMm),
    },
    {
      metric: PLAN_VS_METRIC.poe,
      required: num(req.totalPoeWatts),
      panel: dash('Not modeled on panel slots'),
      rack: dash('Not modeled on rack gear'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.eth,
      required: num(req.totalEthernetPorts),
      panel: dash('Not modeled on panel slots'),
      rack: dash('Not modeled on rack gear'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.cameras,
      required: num(req.cameraCount),
      panel: dash('Not modeled on panel'),
      rack: dash('Not modeled on rack'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.readers,
      required: num(req.readerCount),
      panel: dash('Not modeled on panel'),
      rack: dash('Not modeled on rack'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.knxOut,
      required: num(req.knxOutputActuatorCount),
      panel: dash('Not modeled on panel'),
      rack: dash('Not modeled on rack'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.knxIn,
      required: num(req.knxBinaryInputCount),
      panel: dash('Not modeled on panel'),
      rack: dash('Not modeled on rack'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.knxSens,
      required: num(req.knxBusSensorCount),
      panel: dash('Not modeled on panel'),
      rack: dash('Not modeled on rack'),
      gap: dash('Treat as unallocated in this view'),
    },
    {
      metric: PLAN_VS_METRIC.rackU,
      required: dash('No project device metric for rack height'),
      panel: dash('—'),
      rack: { text: `${rackHi} / ${totalRU} U · ${gearCount} gear row(s)` },
      gap: {
        text: `${Math.max(0, totalRU - rackHi)} U spare`,
        hint: 'Spare = total RU minus highest occupied U index',
      },
    },
  ]

  return rows
}

export function buildRequirementsSummary(
  project: PlanstudioProject,
): RequirementsSummary {
  const acc: RequirementsSummary = {
    deviceCount: 0,
    totalDinTe: 0,
    totalDinRailMm: 0,
    totalPoeWatts: 0,
    totalEthernetPorts: 0,
    cameraCount: 0,
    readerCount: 0,
    knxOutputActuatorCount: 0,
    knxBinaryInputCount: 0,
    knxBusSensorCount: 0,
  }
  for (const fl of project.floors) {
    collectFromFloorLevel(fl, acc)
  }
  return acc
}
