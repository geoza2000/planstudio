import { forBillable } from './billable'
import { pointInPolygon } from './geometry'
import type {
  FloorDevice,
  FloorLevel,
  PlanRegion,
  PlanstudioProject,
  PointM,
  WallMountDevice,
} from '../types/project'
import { deviceTypeRollupLabel } from '../types/project'

export type BomLineSource = 'floor' | 'wall' | 'panel' | 'rack' | 'rack_enclosure'

export type BomLine = {
  id: string
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  room: string
  sectionPath: string
  floor: string
  floorLevelId: string
  source: BomLineSource
  kindLabel: string
  note?: string
}

export type BomSubsection = {
  title: string
  lines: BomLine[]
  subtotalBilled: number
}

export type BomSection = {
  title: string
  subsections: BomSubsection[]
  subtotalBilled: number
}

export type BuiltBom = {
  projectName: string
  generatedAt: string
  lines: BomLine[]
  grandTotalBilled: number
  sections: BomSection[]
  bom: {
    projectName: string
    generatedAt: string
    lines: BomLine[]
    grandTotalBilled: number
    note: string
  }
}

/** Patio first, then room, then other, else unassigned. */
export function roomBucketForPoint(
  p: PointM,
  regions: PlanRegion[],
): { key: string; name: string } {
  for (const r of regions) {
    if (r.kind === 'patio' && pointInPolygon(p, r.vertices)) {
      return { key: `patio:${r.id}`, name: (r.label.trim() || 'Patio') + ' (patio)' }
    }
  }
  for (const r of regions) {
    if (r.kind === 'room' && pointInPolygon(p, r.vertices)) {
      return { key: `room:${r.id}`, name: r.label.trim() || 'Room' }
    }
  }
  for (const r of regions) {
    if (r.kind === 'other' && pointInPolygon(p, r.vertices)) {
      return { key: `other:${r.id}`, name: r.label.trim() || 'Area' }
    }
  }
  return { key: 'unassigned', name: 'Unassigned' }
}

function findFloorDevice(
  fl: FloorLevel,
  id: string | undefined,
): FloorDevice | undefined {
  if (!id) return undefined
  return fl.plan.devices.find((d) => d.id === id)
}

function lineForFloorDevice(
  fl: FloorLevel,
  d: FloorDevice,
  sectionPath: string,
  roomCol: string,
  note?: string,
): BomLine {
  const fb = forBillable(d)
  return {
    id: d.id,
    name: d.productName || d.label || deviceTypeRollupLabel(d.type, d.connectorSubtype),
    qty: 1,
    unitPrice: d.unitPrice,
    lineTotal: fb.lineTotal,
    room: roomCol,
    sectionPath,
    floor: fl.label,
    floorLevelId: fl.id,
    source: 'floor',
    kindLabel: deviceTypeRollupLabel(d.type, d.connectorSubtype),
    note,
  }
}

function lineForWallDevice(
  fl: FloorLevel,
  _wallLabel: string,
  d: WallMountDevice,
  roomCol: string,
  sectionPath: string,
): BomLine {
  const fb = forBillable(d)
  return {
    id: d.id,
    name: d.productName || d.label || deviceTypeRollupLabel(d.type, d.connectorSubtype),
    qty: 1,
    unitPrice: d.unitPrice,
    lineTotal: fb.lineTotal,
    room: roomCol,
    sectionPath,
    floor: fl.label,
    floorLevelId: fl.id,
    source: 'wall',
    kindLabel: deviceTypeRollupLabel(d.type, d.connectorSubtype),
  }
}

function regionNameForId(regions: PlanRegion[], id: string | undefined): string | null {
  if (!id) return null
  const r = regions.find((x) => x.id === id)
  if (!r) return null
  return r.label.trim() || r.kind
}

function subtotalBilledFor(lines: BomLine[]): number {
  return lines.reduce((s, l) => s + l.lineTotal, 0)
}

function groupBySection(uniq: BomLine[]): BomSection[] {
  const byTop = new Map<string, Map<string, BomLine[]>>()
  for (const ln of uniq) {
    const isGlobal = ln.sectionPath.startsWith('Electrical / rack')
    const top = isGlobal ? 'Electrical / rack (global)' : ln.floor
    if (!byTop.has(top)) {
      byTop.set(top, new Map())
    }
    const m = byTop.get(top)!
    if (!m.has(ln.sectionPath)) {
      m.set(ln.sectionPath, [])
    }
    m.get(ln.sectionPath)!.push(ln)
  }

  const out: BomSection[] = []
  for (const [title, subMap] of byTop) {
    const subsections: BomSubsection[] = []
    for (const [st, lns] of subMap) {
      subsections.push({
        title: st,
        lines: lns,
        subtotalBilled: subtotalBilledFor(lns),
      })
    }
    const all = [...subMap.values()].flat()
    out.push({ title, subsections, subtotalBilled: subtotalBilledFor(all) })
  }
  return out
}

export function buildBom(p: PlanstudioProject): BuiltBom {
  const now = new Date().toISOString()
  const lines: BomLine[] = []
  const floorLevels = [...p.floors].sort((a, b) => a.sortOrder - b.sortOrder)

  for (const fl of floorLevels) {
    const plan = fl.plan
    const regions = plan.regions

    for (const d of plan.devices) {
      const b = roomBucketForPoint({ x: d.x, y: d.y }, regions)
      const sectionPath = `${fl.label} / ${b.name}`
      const roomCol = b.name
      const noteBits: string[] = []
      if (d.linkedWallDeviceId) noteBits.push('Linked wall device on sheet')
      if (d.mounting === 'ceiling') noteBits.push('Ceiling mount')
      if (d.mounting === 'wall') noteBits.push('Wall mirror')
      const note = noteBits.length ? noteBits.join(' · ') : undefined
      lines.push(lineForFloorDevice(fl, d, sectionPath, roomCol, note))
    }

    const regionsW = fl.plan.regions
    for (const ws of fl.wallSheets) {
      const fromWall = regionNameForId(regionsW, ws.roomRegionId)
      for (const d of ws.devices) {
        if (d.linkedFloorDeviceId) {
          const fd = findFloorDevice(fl, d.linkedFloorDeviceId)
          if (fd) {
            continue
          }
        }
        let roomCol = fromWall || '—'
        if (d.linkedFloorDeviceId) {
          const linked = findFloorDevice(fl, d.linkedFloorDeviceId)
          if (linked) {
            roomCol = roomBucketForPoint({ x: linked.x, y: linked.y }, regionsW).name
          }
        }
        lines.push(
          lineForWallDevice(
            fl,
            ws.label,
            d,
            roomCol,
            `${fl.label} / Wall · ${ws.label}`,
          ),
        )
      }
    }
  }

  for (const slot of p.panel.slots) {
    if (slot.spanAnchorId) {
      continue
    }
    if (slot.moduleType === 'blank' && !String(slot.productName).trim()) {
      continue
    }
    const fb = forBillable(slot)
    lines.push({
      id: slot.id,
      name: slot.productName || slot.label || `Panel R${slot.row + 1}C${slot.col + 1}`,
      qty: 1,
      unitPrice: slot.unitPrice,
      lineTotal: fb.lineTotal,
      room: '—',
      sectionPath: 'Electrical / rack / Panel',
      floor: '—',
      floorLevelId: '—',
      source: 'panel',
      kindLabel: slot.moduleType,
    })
  }

  const rackEnc = p.rack
  const encBill = forBillable({
    unitPrice: rackEnc.enclosureUnitPrice,
  })
  lines.push({
    id: 'rack:enclosure',
    name: rackEnc.enclosureProductName.trim() || 'Rack enclosure',
    qty: 1,
    unitPrice: rackEnc.enclosureUnitPrice,
    lineTotal: encBill.lineTotal,
    room: '—',
    sectionPath: 'Electrical / rack / Rack enclosure',
    floor: '—',
    floorLevelId: '—',
    source: 'rack_enclosure',
    kindLabel: 'Enclosure',
  })

  for (const g of p.rack.gear) {
    const fb = forBillable(g)
    lines.push({
      id: g.id,
      name: g.productName,
      qty: 1,
      unitPrice: g.unitPrice,
      lineTotal: fb.lineTotal,
      room: '—',
      sectionPath: 'Electrical / rack / Rack',
      floor: '—',
      floorLevelId: '—',
      source: 'rack',
      kindLabel: `${g.heightRU}U`,
    })
  }

  const dedup = new Map<string, BomLine>()
  for (const ln of lines) {
    dedup.set(ln.id, ln)
  }
  const uniq = [...dedup.values()]

  const grandTotalBilled = uniq.reduce((s, l) => s + l.lineTotal, 0)
  const sections = groupBySection(uniq)

  return {
    projectName: p.name,
    generatedAt: now,
    lines: uniq,
    grandTotalBilled,
    sections,
    bom: {
      projectName: p.name,
      generatedAt: now,
      lines: uniq,
      grandTotalBilled,
      note: 'All BOM lines are included in the grand total.',
    },
  }
}
