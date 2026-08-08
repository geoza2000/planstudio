import type { BomLine } from './bom'
import { manufacturerLineForBomLine } from './bomManufacturer'
import {
  templateListBomSubtitle,
  templateListDisplayTitle,
  templateListMetaLine,
} from './deviceCatalog'
import { anchorSlotForCell } from './panelSpans'
import type { PanelSlot, PlanstudioProject, RackGear } from '../types/project'

const OTHER_MFG_SORT_KEY = '__other__'

/** Floor + wall BOM lines only (excludes panel / rack from site shopping rollups). */
export function isFloorWallShoppingLine(ln: BomLine): boolean {
  return ln.source === 'floor' || ln.source === 'wall'
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

/** Panel grid: label / name first (like template display), then product (BOM) when distinct. */
function pdfPanelProductCell(anchor: PanelSlot): string {
  const label = anchor.label?.trim() ?? ''
  const product = String(anchor.productName ?? '').trim()
  const title = label || product || anchor.moduleType
  const second = product && product !== title ? product : undefined
  return second ? `${title}\n${second}` : title
}

/** One catalog template row — same layout as the Devices tab template list (not per plan mark). */
export type PdfDeviceListEntry = {
  context: string
  displayTitle: string
  bom?: string
  meta: string
  tail?: string
}

export function buildPdfDeviceListEntries(p: PlanstudioProject): PdfDeviceListEntry[] {
  const cat = p.deviceCatalog ?? []
  return [...cat]
    .sort(
      (a, b) =>
        templateListDisplayTitle(a).localeCompare(templateListDisplayTitle(b)) ||
        a.id.localeCompare(b.id),
    )
    .map((t) => {
      const placement =
        t.mounting === 'both' ? 'Plan + wall' : t.mounting === 'wall' ? 'Wall' : 'Ceiling / plan'
      const title = templateListDisplayTitle(t)
      const bom = templateListBomSubtitle(t)
      const meta = templateListMetaLine(t)
      const bits: string[] = []
      if (t.manufacturerLine?.trim()) bits.push(t.manufacturerLine.trim())
      if (t.requirements?.notes?.trim()) bits.push(t.requirements.notes.trim())
      const tail = bits.length ? truncateCell(bits.join(' · '), 160) : undefined
      return {
        context: `${placement} · template id ${t.id}`,
        displayTitle: title,
        bom,
        meta,
        tail,
      }
    })
}

/** Panel / rack equipment or shopping line for PDF price tables. */
export type PdfEquipmentPriceRow = {
  name: string
  note?: string
  qty: number
  unitPrice: number
  lineTotal: number
  /** Bold total row; unit column left blank when zero. */
  isTotal?: boolean
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100
}

function panelSlotNameNote(anchor: PanelSlot, row1: number, col1: number): { name: string; note?: string } {
  const cell = pdfPanelProductCell(anchor)
  const lines = cell.split('\n').map((s) => s.trim()).filter(Boolean)
  const name = lines[0] ?? anchor.moduleType
  const fromCell = lines.slice(1).join('\n')
  const noteParts = [
    fromCell || undefined,
    anchor.description?.trim() || undefined,
    `Row ${row1} · Col ${col1} · ${anchor.moduleType}`,
    anchor.manufacturerLine?.trim() || undefined,
  ].filter(Boolean) as string[]
  const note = noteParts.length ? noteParts.join('\n') : undefined
  return { name, note }
}

function rackGearNameNote(g: RackGear): { name: string; note?: string } {
  const name = g.productName.trim() || 'Rack item'
  const noteParts = [
    g.notes?.trim() || undefined,
    `${g.startRU} U · ${g.heightRU} U high`,
    g.rj45PortCount != null || g.sfpPortCount != null
      ? `RJ45 ${g.rj45PortCount ?? 0} · SFP ${g.sfpPortCount ?? 0}`
      : undefined,
  ].filter(Boolean) as string[]
  const note = noteParts.length ? noteParts.join('\n') : undefined
  return { name, note }
}

export function buildPanelEquipmentPriceTable(p: PlanstudioProject): PdfEquipmentPriceRow[] {
  const body: PdfEquipmentPriceRow[] = []
  const { slots, widthTe, rows: nRows } = p.panel
  for (let r = 0; r < nRows; r++) {
    for (let c = 0; c < widthTe; c++) {
      const anchor = anchorSlotForCell(slots, r, c)
      if (!anchor || anchor.row !== r || anchor.col !== c) continue
      if (anchor.moduleType === 'blank' && !String(anchor.productName).trim()) continue
      const { name, note } = panelSlotNameNote(anchor, r + 1, c + 1)
      const unit = Number(anchor.unitPrice) || 0
      body.push({
        name,
        note,
        qty: 1,
        unitPrice: unit,
        lineTotal: roundMoney(unit),
      })
    }
  }
  if (body.length === 0) return []
  const sumQty = body.reduce((s, x) => s + x.qty, 0)
  const sumTot = roundMoney(body.reduce((s, x) => s + x.lineTotal, 0))
  body.push({
    name: 'Total',
    qty: sumQty,
    unitPrice: 0,
    lineTotal: sumTot,
    isTotal: true,
  })
  return body
}

export function buildRackEquipmentPriceTable(p: PlanstudioProject): PdfEquipmentPriceRow[] {
  const body: PdfEquipmentPriceRow[] = []
  for (const g of [...p.rack.gear].sort((a, b) => a.startRU - b.startRU)) {
    const { name, note } = rackGearNameNote(g)
    const unit = Number(g.unitPrice) || 0
    body.push({
      name,
      note,
      qty: 1,
      unitPrice: unit,
      lineTotal: roundMoney(unit),
    })
  }
  const encName = (p.rack.enclosureProductName || 'Rack enclosure').trim()
  const encUnit = Number(p.rack.enclosureUnitPrice) || 0
  body.push({
    name: encName,
    note: 'Cabinet / frame',
    qty: 1,
    unitPrice: encUnit,
    lineTotal: roundMoney(encUnit),
  })
  const sumQty = body.reduce((s, x) => s + x.qty, 0)
  const sumTot = roundMoney(body.reduce((s, x) => s + x.lineTotal, 0))
  body.push({
    name: 'Total',
    qty: sumQty,
    unitPrice: 0,
    lineTotal: sumTot,
    isTotal: true,
  })
  return body
}

export function buildShoppingPriceTable(
  items: { name: string; qty: number; unitPrice: number; lineTotal: number; manufacturer: string }[],
): PdfEquipmentPriceRow[] {
  const body: PdfEquipmentPriceRow[] = items.map((it) => ({
    name: it.name,
    note: it.manufacturer?.trim() || undefined,
    qty: it.qty,
    unitPrice: it.unitPrice,
    lineTotal: roundMoney(it.lineTotal),
  }))
  if (body.length === 0) return []
  const sumQty = body.reduce((s, x) => s + x.qty, 0)
  const sumTot = roundMoney(body.reduce((s, x) => s + x.lineTotal, 0))
  body.push({
    name: 'Total',
    qty: sumQty,
    unitPrice: 0,
    lineTotal: sumTot,
    isTotal: true,
  })
  return body
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
  rows: PdfEquipmentPriceRow[]
}

export function shoppingGroupsByManufacturer(
  p: PlanstudioProject,
  lines: BomLine[],
): ShoppingManufacturerGroup[] {
  const siteLines = lines.filter(isFloorWallShoppingLine)
  const m = new Map<string, { displayTitle: string; items: BomLine[] }>()
  for (const ln of siteLines) {
    const raw = manufacturerLineForBomLine(p, ln).trim()
    const sortKey = raw ? raw.toLowerCase() : OTHER_MFG_SORT_KEY
    const displayTitle = raw || 'Other'
    if (!m.has(sortKey)) {
      m.set(sortKey, { displayTitle, items: [] })
    }
    m.get(sortKey)!.items.push(ln)
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
      /** Same table shape as panel/rack shopping: Equipment, Qty, Unit €, Total €, plus Total row. */
      rows: buildShoppingPriceTable(
        aggregateShoppingLines(p, v.items).map((it) => ({ ...it, manufacturer: '' })),
      ),
    }))
}

export type ShoppingFloorGroup = {
  sortKey: string
  displayTitle: string
  rows: PdfEquipmentPriceRow[]
}

export function shoppingGroupsByFloor(
  p: PlanstudioProject,
  lines: BomLine[],
): ShoppingFloorGroup[] {
  const floorLines = lines.filter(isFloorWallShoppingLine).filter((l) => l.floor !== '—')
  const m = new Map<string, { displayTitle: string; items: BomLine[] }>()
  for (const ln of floorLines) {
    const sortKey = ln.floor.trim().toLowerCase() || '(no floor)'
    const displayTitle = ln.floor.trim() || '(No floor)'
    if (!m.has(sortKey)) {
      m.set(sortKey, { displayTitle, items: [] })
    }
    m.get(sortKey)!.items.push(ln)
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sortKey, v]) => ({
      sortKey,
      displayTitle: v.displayTitle,
      rows: buildShoppingPriceTable(aggregateShoppingLines(p, v.items)),
    }))
}
