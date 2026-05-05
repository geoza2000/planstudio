import { roomBucketForPoint } from './bom'
import type { BomLine } from './bom'
import { manufacturerLineForBomLine } from './bomManufacturer'
import { anchorSlotForCell } from './panelSpans'
import { deviceTypeRollupLabel } from '../types/project'
import type {
  FloorDevice,
  PlanRegion,
  PlanstudioProject,
  WallMountDevice,
} from '../types/project'

const OTHER_MFG_SORT_KEY = '__other__'

/** Floor + wall BOM lines only (excludes panel / rack from site shopping rollups). */
export function isFloorWallShoppingLine(ln: BomLine): boolean {
  return ln.source === 'floor' || ln.source === 'wall'
}

function knxLineLabel(p: PlanstudioProject, knxLineId?: string): string {
  if (!knxLineId) return ''
  return p.knxLines.find((l) => l.id === knxLineId)?.label?.trim() || knxLineId
}

function truncateCell(s: string, max = 120): string {
  const t = String(s).trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  return `${t.slice(0, max - 1)}…`
}

export function formatProjectMetaLines(p: PlanstudioProject): string[] {
  const lines: string[] = []
  lines.push(`Project: ${p.name}`)
  lines.push(`Schema version: ${String(p.schemaVersion)}`)
  lines.push(`Last updated: ${p.updatedAt}`)
  lines.push('')
  lines.push('Floors (order 0→N by sort order):')
  const floors = [...p.floors].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  )
  floors.forEach((f, i) => {
    lines.push(
      `  ${i}. ${f.label} — plan ${f.plan.label} (${f.plan.widthM}m × ${f.plan.depthM}m)`,
    )
  })
  lines.push('')
  lines.push('KNX / bus lines:')
  for (const l of [...p.knxLines].sort((a, b) => a.sortOrder - b.sortOrder)) {
    lines.push(`  · ${l.label}`)
  }
  lines.push('')
  lines.push(`Rack: ${p.rack.totalRU} RU · ${p.rack.widthLabel}`)
  lines.push(`Panel: ${p.panel.rows} rows × ${p.panel.widthTe} TE`)
  return lines
}

function regionNameForId(regions: PlanRegion[], id: string | undefined): string | null {
  if (!id) return null
  const r = regions.find((x) => x.id === id)
  if (!r) return null
  return r.label.trim() || r.kind
}

function catalogRowForDevice(
  p: PlanstudioProject,
  d: FloorDevice | WallMountDevice,
): { manufacturer: string; catalog: string } {
  if (!d.templateId) return { manufacturer: '', catalog: '' }
  const t = p.deviceCatalog.find((x) => x.id === d.templateId)
  if (!t) return { manufacturer: '', catalog: '' }
  return {
    manufacturer: (t.manufacturerLine ?? '').trim(),
    catalog: (t.catalogCode ?? '').trim(),
  }
}

function deviceDetailNotes(p: PlanstudioProject, d: FloorDevice | WallMountDevice): string {
  const bits: string[] = []
  if (d.requirements?.notes?.trim()) bits.push(d.requirements.notes.trim())
  if (d.templateId) {
    const t = p.deviceCatalog.find((x) => x.id === d.templateId)
    if (t?.displayName?.trim()) bits.push(`Catalog: ${t.displayName.trim()}`)
  }
  return truncateCell(bits.join(' · '), 140)
}

/** Device documentation table (plan + wall marks; mirrors BOM wall skip rules). */
export function buildPdfDeviceRows(p: PlanstudioProject): string[][] {
  const header = [
    'Floor',
    'Room / area',
    'Location',
    'Label',
    'Type',
    'Product',
    'Unit €',
    'Manufacturer',
    'Catalog',
    'Circuit',
    'KNX line',
    'Mount / link',
    'Description',
  ]
  const rows: string[][] = [header]
  const floors = [...p.floors].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
  )
  for (const fl of floors) {
    const regions = fl.plan.regions
    for (const d of fl.plan.devices) {
      const b = roomBucketForPoint({ x: d.x, y: d.y }, regions)
      const cat = catalogRowForDevice(p, d)
      const noteParts: string[] = []
      if (d.linkedWallDeviceId) noteParts.push('linked wall')
      if (d.mounting === 'ceiling') noteParts.push('ceiling')
      if (d.mounting === 'wall') noteParts.push('wall mirror')
      rows.push([
        fl.label,
        b.name,
        'Plan',
        d.label,
        deviceTypeRollupLabel(d.type, d.connectorSubtype),
        d.productName,
        String(d.unitPrice),
        cat.manufacturer || (d.templateId ? '' : '—'),
        cat.catalog,
        d.circuitRef,
        knxLineLabel(p, d.knxLineId),
        noteParts.join(' · '),
        deviceDetailNotes(p, d),
      ])
    }
    const regionsW = fl.plan.regions
    for (const ws of fl.wallSheets) {
      const fromWall = regionNameForId(regionsW, ws.roomRegionId)
      for (const d of ws.devices) {
        if (d.linkedFloorDeviceId) {
          const fd = fl.plan.devices.find((x) => x.id === d.linkedFloorDeviceId)
          if (fd) continue
        }
        let roomCol = fromWall || '—'
        if (d.linkedFloorDeviceId) {
          const linked = fl.plan.devices.find((x) => x.id === d.linkedFloorDeviceId)
          if (linked) {
            roomCol = roomBucketForPoint({ x: linked.x, y: linked.y }, regionsW).name
          }
        }
        const cat = catalogRowForDevice(p, d)
        rows.push([
          fl.label,
          roomCol,
          `Wall · ${ws.label}`,
          d.label,
          deviceTypeRollupLabel(d.type, d.connectorSubtype),
          d.productName,
          String(d.unitPrice),
          cat.manufacturer || (d.templateId ? '' : '—'),
          cat.catalog,
          d.circuitRef,
          knxLineLabel(p, d.knxLineId),
          d.linkedFloorDeviceId ? 'linked plan' : '',
          deviceDetailNotes(p, d),
        ])
      }
    }
  }
  return rows
}

export function panelEquipmentRows(p: PlanstudioProject): string[][] {
  const rows: string[][] = [
    [
      'Row',
      'Col',
      'Type',
      'Label',
      'Product',
      'Unit €',
      'Bill cat.',
      'Circuit',
      'Rating A',
      'KNX line',
      'Mfg',
      'Catalog',
      'Description',
      'DIN mm',
      'Rail mm',
      'Span TE',
    ],
  ]
  const { slots, widthTe, rows: nRows } = p.panel
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < widthTe; c++) {
      const anchor = anchorSlotForCell(slots, r, c)
      if (!anchor || anchor.row !== r || anchor.col !== c) continue
      if (anchor.moduleType === 'blank' && !String(anchor.productName).trim()) continue
      rows.push([
        String(r + 1),
        String(c + 1),
        anchor.moduleType,
        anchor.label,
        anchor.productName,
        String(anchor.unitPrice),
        anchor.billCategory,
        anchor.circuitRef,
        anchor.ratingA != null ? String(anchor.ratingA) : '',
        knxLineLabel(p, anchor.knxLineId),
        anchor.manufacturerLine ?? '',
        anchor.catalogCode ?? '',
        truncateCell(anchor.description ?? '', 80),
        anchor.dinRailSegmentMm != null ? String(anchor.dinRailSegmentMm) : '',
        anchor.railConsumeMm != null ? String(anchor.railConsumeMm) : '',
        String(anchor.spanWidthTe ?? 1),
      ])
    }
  }
  return rows
}

export function rackEquipmentRows(p: PlanstudioProject): string[][] {
  const rows: string[][] = [
    [
      'Start RU',
      'Height U',
      'Product',
      'Unit €',
      'Bill cat.',
      'RJ45',
      'SFP',
      'Notes',
    ],
  ]
  for (const g of [...p.rack.gear].sort((a, b) => a.startRU - b.startRU)) {
    rows.push([
      String(g.startRU),
      String(g.heightRU),
      g.productName,
      String(g.unitPrice),
      g.billCategory,
      g.rj45PortCount != null ? String(g.rj45PortCount) : '',
      g.sfpPortCount != null ? String(g.sfpPortCount) : '',
      truncateCell(g.notes ?? '', 120),
    ])
  }
  rows.push([
    '—',
    '—',
    p.rack.enclosureProductName || 'Rack enclosure',
    String(p.rack.enclosureUnitPrice),
    p.rack.enclosureBillCategory,
    '',
    '',
    'Cabinet / frame',
  ])
  return rows
}

export function aggregateShoppingLines(
  p: PlanstudioProject,
  lines: BomLine[],
): { name: string; qty: number; unitPrice: number; lineTotal: number; manufacturer: string }[] {
  const m = new Map<
    string,
    { name: string; qty: number; unitPrice: number; lineTotal: number; manufacturer: string }
  >()
  for (const ln of lines) {
    const man = manufacturerLineForBomLine(p, ln)
    const k = `${ln.name}\0${ln.unitPrice}\0${man.toLowerCase()}`
    const cur = m.get(k)
    if (cur) {
      cur.qty += ln.qty
      cur.lineTotal += ln.lineTotal
    } else {
      m.set(k, {
        name: ln.name,
        qty: ln.qty,
        unitPrice: ln.unitPrice,
        lineTotal: ln.lineTotal,
        manufacturer: man,
      })
    }
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export type ShoppingManufacturerGroup = {
  sortKey: string
  displayTitle: string
  lines: string[]
}

export function shoppingGroupsByManufacturer(
  p: PlanstudioProject,
  lines: BomLine[],
): ShoppingManufacturerGroup[] {
  const siteLines = lines.filter(isFloorWallShoppingLine)
  const m = new Map<string, { displayTitle: string; lines: string[] }>()
  for (const ln of siteLines) {
    const raw = manufacturerLineForBomLine(p, ln).trim()
    const sortKey = raw ? raw.toLowerCase() : OTHER_MFG_SORT_KEY
    const displayTitle = raw || 'Other'
    if (!m.has(sortKey)) {
      m.set(sortKey, { displayTitle, lines: [] })
    }
    m.get(sortKey)!.lines.push(
      `${ln.name} × ${ln.qty} · unit €${ln.unitPrice.toFixed(2)} · line €${ln.lineTotal.toFixed(2)} · ${ln.sectionPath}`,
    )
  }
  return [...m.entries()]
    .sort(([a], [b]) => {
      if (a === OTHER_MFG_SORT_KEY) return 1
      if (b === OTHER_MFG_SORT_KEY) return -1
      return a.localeCompare(b)
    })
    .map(([sortKey, v]) => ({
      sortKey,
      displayTitle: v.displayTitle,
      lines: v.lines.sort((x, y) => x.localeCompare(y)),
    }))
}

export type ShoppingFloorGroup = {
  sortKey: string
  displayTitle: string
  lines: string[]
}

export function shoppingGroupsByFloor(lines: BomLine[]): ShoppingFloorGroup[] {
  const floorLines = lines.filter(isFloorWallShoppingLine).filter((l) => l.floor !== '—')
  const m = new Map<string, { displayTitle: string; lines: string[] }>()
  for (const ln of floorLines) {
    const sortKey = ln.floor.trim().toLowerCase() || '(no floor)'
    const displayTitle = ln.floor.trim() || '(No floor)'
    if (!m.has(sortKey)) {
      m.set(sortKey, { displayTitle, lines: [] })
    }
    m.get(sortKey)!.lines.push(
      `${ln.name} × ${ln.qty} · €${ln.lineTotal.toFixed(2)} · ${ln.room} · ${ln.sectionPath}`,
    )
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sortKey, v]) => ({
      sortKey,
      displayTitle: v.displayTitle,
      lines: v.lines.sort((x, y) => x.localeCompare(y)),
    }))
}
