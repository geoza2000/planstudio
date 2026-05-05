import { jsPDF } from 'jspdf'
import type { ShoppingFloorGroup, ShoppingManufacturerGroup } from './projectPdfData'

const M = 40

export type ProjectPdfWallPart = {
  wallLabel: string
  elevationDataUrl: string
  deviceNames: string[]
}

export type ProjectPdfRoomPart = {
  regionLabel: string
  /** Cropped plan: this region’s polygon, its walls, and in-room devices. */
  roomPlanDataUrl: string
  walls: ProjectPdfWallPart[]
}

export type ProjectPdfFloorPart = {
  floorLabel: string
  floorPlanDataUrl: string
  rooms: ProjectPdfRoomPart[]
}

export type ShoppingRow = {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
  manufacturer: string
}

export type ProjectPdfInput = {
  projectName: string
  generatedAtISO: string
  metaLines: string[]
  overviewFloorImages: { floorLabel: string; dataUrl: string }[]
  perFloor: ProjectPdfFloorPart[]
  deviceRows: string[][]
  panelDiagramDataUrl: string
  panelEquipment: string[][]
  panelShopping: ShoppingRow[]
  rackDiagramDataUrl: string
  rackEquipment: string[][]
  rackShopping: ShoppingRow[]
  shoppingByManufacturer: ShoppingManufacturerGroup[]
  shoppingByFloor: ShoppingFloorGroup[]
}

function pageSize(pdf: jsPDF) {
  return {
    w: pdf.internal.pageSize.getWidth(),
    h: pdf.internal.pageSize.getHeight(),
  }
}

function ensureY(pdf: jsPDF, y: number, need: number): number {
  const { h } = pageSize(pdf)
  if (y + need > h - M) {
    pdf.addPage()
    return M
  }
  return y
}

function drawTitle(pdf: jsPDF, y: number, text: string): number {
  const { w } = pageSize(pdf)
  const textW = w - 2 * M
  pdf.setFontSize(16)
  pdf.setFont('helvetica', 'bold')
  const lines = pdf.splitTextToSize(text, textW)
  y = ensureY(pdf, y, lines.length * 18 + 8)
  pdf.text(lines, M, y)
  return y + lines.length * 18 + 12
}

function drawHeading(pdf: jsPDF, y: number, text: string): number {
  const { w } = pageSize(pdf)
  const textW = w - 2 * M
  pdf.setFontSize(12)
  pdf.setFont('helvetica', 'bold')
  const lines = pdf.splitTextToSize(text, textW)
  y = ensureY(pdf, y, lines.length * 14)
  pdf.text(lines, M, y)
  return y + lines.length * 14 + 6
}

function drawSubheading(pdf: jsPDF, y: number, text: string): number {
  const { w } = pageSize(pdf)
  const textW = w - 2 * M
  pdf.setFontSize(10)
  pdf.setFont('helvetica', 'bold')
  const lines = pdf.splitTextToSize(text, textW)
  y = ensureY(pdf, y, lines.length * 12)
  pdf.text(lines, M, y)
  return y + lines.length * 12 + 4
}

function drawBodyLines(pdf: jsPDF, y: number, lines: string[], lineHeight = 11): number {
  const { w, h } = pageSize(pdf)
  const textW = w - 2 * M
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  for (const raw of lines) {
    const parts = pdf.splitTextToSize(raw, textW)
    const blockH = parts.length * lineHeight
    if (y + blockH > h - M) {
      pdf.addPage()
      y = M
    }
    pdf.text(parts, M, y)
    y += blockH + 3
  }
  return y + 4
}

function addImageFitWidth(pdf: jsPDF, y: number, dataUrl: string): number {
  const { w, h } = pageSize(pdf)
  const maxW = w - 2 * M
  let maxH = h - y - M - 8
  /** Tall canvases (e.g. 40+ U rack @ 2× pixel ratio) must shrink to page height, not only width. */
  if (maxH < 180) {
    pdf.addPage()
    y = M
    maxH = h - y - M - 8
  }
  return addImageFitMaxBox(pdf, y, dataUrl, maxW, Math.max(120, maxH))
}

function drawTable(pdf: jsPDF, y: number, rows: string[][]): number {
  const { w, h } = pageSize(pdf)
  const textW = w - 2 * M
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'normal')
  for (const row of rows) {
    const t = row.map((c) => String(c).replace(/\n/g, ' ')).join('  ·  ')
    const parts = pdf.splitTextToSize(t, textW)
    const blockH = parts.length * 9
    if (y + blockH > h - M) {
      pdf.addPage()
      y = M
    }
    pdf.text(parts, M, y)
    y += blockH + 3
  }
  return y + 8
}

function addImageFitMaxBox(
  pdf: jsPDF,
  y: number,
  dataUrl: string,
  maxW: number,
  maxH: number,
): number {
  if (!dataUrl) return y
  const props = pdf.getImageProperties(dataUrl)
  const iw = props.width
  const ih = props.height
  if (!iw || !ih) return y
  let rw = maxW
  let rh = (ih * rw) / iw
  if (rh > maxH) {
    rh = maxH
    rw = (iw * rh) / ih
  }
  y = ensureY(pdf, y, rh + 8)
  pdf.addImage(dataUrl, 'PNG', M, y, rw, rh, undefined, 'FAST')
  return y + rh + 10
}

function addWallElevationGrid(
  pdf: jsPDF,
  startY: number,
  walls: ProjectPdfWallPart[],
  contentW: number,
): number {
  const { h } = pageSize(pdf)
  if (walls.length === 0) {
    return drawBodyLines(pdf, startY, ['(no walls in this group)'])
  }

  const cols = Math.min(2, walls.length)
  const rows = Math.ceil(walls.length / cols)
  const gap = 10
  let available = h - startY - M - 8

  const cellW = (contentW - gap * (cols - 1)) / cols
  const labelLineH = 9
  let maxImgH = (available - rows * (labelLineH + 2) - (rows - 1) * gap) / rows - 6
  maxImgH = Math.max(40, Math.min(120, maxImgH))
  if (available < 90) {
    maxImgH = Math.max(32, maxImgH - 20)
  }
  let y = startY
  let idx = 0
  for (let r = 0; r < rows; r++) {
    let rowBottom = y
    for (let c = 0; c < cols && idx < walls.length; c++) {
      const wall = walls[idx]!
      idx++
      const x = M + c * (cellW + gap)
      let cellTop = y
      pdf.setFontSize(8)
      pdf.setFont('helvetica', 'bold')
      const wlab = pdf.splitTextToSize(wall.wallLabel, cellW)
      pdf.text(wlab, x, cellTop)
      let cellY = cellTop + wlab.length * labelLineH + 2

      if (wall.elevationDataUrl) {
        const props = pdf.getImageProperties(wall.elevationDataUrl)
        let rw = cellW
        let rh = (props.height * rw) / props.width
        if (rh > maxImgH) {
          rh = maxImgH
          rw = (props.width * rh) / props.height
        }
        const maxBottom = h - M - 4
        if (cellY + rh > maxBottom) {
          rh = Math.max(28, maxBottom - cellY)
          rw = (props.width * rh) / props.height
        }
        pdf.addImage(wall.elevationDataUrl, 'PNG', x, cellY, rw, rh, undefined, 'FAST')
        cellY += rh + 4
      }

      if (wall.deviceNames.length > 0) {
        pdf.setFont('helvetica', 'normal')
        const cap = wall.deviceNames.slice(0, 3).join(' · ')
        const more = wall.deviceNames.length > 3 ? '…' : ''
        const parts = pdf.splitTextToSize(`${cap}${more}`, cellW)
        const capH = parts.length * 8
        const maxBottom = h - M - 4
        if (cellY + capH > maxBottom) {
          const keep = Math.max(1, Math.floor((maxBottom - cellY) / 8))
          const parts2 = parts.slice(0, keep)
          pdf.text(parts2, x, cellY)
          cellY += parts2.length * 8 + 2
        } else {
          pdf.text(parts, x, cellY)
          cellY += capH + 2
        }
      }

      rowBottom = Math.max(rowBottom, cellY)
    }
    y = rowBottom + gap
  }
  return y
}

function drawShoppingAggregates(pdf: jsPDF, y: number, items: ShoppingRow[]): number {
  pdf.setFontSize(9)
  pdf.setFont('helvetica', 'normal')
  const { w, h } = pageSize(pdf)
  const textW = w - 2 * M
  for (const it of items) {
    const man = it.manufacturer ? `${it.manufacturer} · ` : ''
    const line = `${man}${it.name} × ${it.qty} · unit €${it.unitPrice.toFixed(2)} · total €${it.lineTotal.toFixed(2)}`
    const parts = pdf.splitTextToSize(line, textW)
    const blockH = parts.length * 11
    if (y + blockH > h - M) {
      pdf.addPage()
      y = M
    }
    pdf.text(parts, M, y)
    y += blockH + 2
  }
  return y + 8
}

/** Assembles the full multi-section project PDF from pre-captured PNG data URLs and tables. */
export function buildProjectPdfBlob(input: ProjectPdfInput): Blob {
  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  let y = M

  y = drawTitle(pdf, y, input.projectName)
  y = drawSubheading(pdf, y, `Generated ${input.generatedAtISO}`)
  y = drawBodyLines(pdf, y, input.metaLines)

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Floor plans (overview)')
  for (const { floorLabel, dataUrl } of input.overviewFloorImages) {
    y = drawSubheading(pdf, y, floorLabel)
    y = addImageFitWidth(pdf, y, dataUrl)
  }

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Floors · rooms · walls (detail)')
  for (const fl of input.perFloor) {
    pdf.addPage()
    y = M
    y = drawHeading(pdf, y, fl.floorLabel)
    y = drawSubheading(pdf, y, 'Floor plan')
    y = addImageFitWidth(pdf, y, fl.floorPlanDataUrl)

    for (const room of fl.rooms) {
      pdf.addPage()
      y = M
      y = drawHeading(pdf, y, `${fl.floorLabel} · ${room.regionLabel}`)
      if (room.roomPlanDataUrl) {
        y = drawSubheading(pdf, y, 'Room plan (isolated)')
        const { w } = pageSize(pdf)
        const textW = w - 2 * M
        const wn = room.walls.length
        const isolationMaxH = wn === 0 ? 220 : wn <= 2 ? 185 : wn <= 4 ? 135 : 100
        y = addImageFitMaxBox(pdf, y, room.roomPlanDataUrl, textW, isolationMaxH)
      } else {
        y = drawBodyLines(pdf, y, ['(Isolated room plan not available for this group.)'])
      }
      y = drawSubheading(pdf, y, 'Wall elevations (this room)')
      const { w } = pageSize(pdf)
      y = addWallElevationGrid(pdf, y, room.walls, w - 2 * M)
    }
  }

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Device list')
  y = drawTable(pdf, y, input.deviceRows)

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Panel')
  y = drawSubheading(pdf, y, 'Panel diagram')
  y = addImageFitWidth(pdf, y, input.panelDiagramDataUrl)
  y = drawSubheading(pdf, y, 'Panel equipment')
  y = drawTable(pdf, y, input.panelEquipment)
  y = drawSubheading(pdf, y, 'Panel shopping list')
  y = drawShoppingAggregates(pdf, y, input.panelShopping)

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Rack')
  y = drawSubheading(pdf, y, 'Rack diagram')
  y = addImageFitWidth(pdf, y, input.rackDiagramDataUrl)
  y = drawSubheading(pdf, y, 'Rack equipment')
  y = drawTable(pdf, y, input.rackEquipment)
  y = drawSubheading(pdf, y, 'Rack shopping list')
  y = drawShoppingAggregates(pdf, y, input.rackShopping)

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Shopping list by manufacturer (floor & wall)')
  for (const grp of input.shoppingByManufacturer) {
    y = drawSubheading(pdf, y, grp.displayTitle)
    y = drawBodyLines(pdf, y, grp.lines)
  }

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Shopping list by floor (floor & wall)')
  for (const grp of input.shoppingByFloor) {
    y = drawSubheading(pdf, y, grp.displayTitle)
    y = drawBodyLines(pdf, y, grp.lines)
  }

  return pdf.output('blob')
}
