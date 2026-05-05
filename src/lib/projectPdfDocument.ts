import { jsPDF } from 'jspdf'
import type {
  PdfDeviceListEntry,
  PdfEquipmentPriceRow,
  ShoppingFloorGroup,
  ShoppingManufacturerGroup,
} from './projectPdfData'

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

export type ProjectPdfInput = {
  projectName: string
  generatedAtISO: string
  metaLines: string[]
  overviewFloorImages: { floorLabel: string; dataUrl: string }[]
  perFloor: ProjectPdfFloorPart[]
  deviceListEntries: PdfDeviceListEntry[]
  panelDiagramDataUrl: string
  panelEquipment: PdfEquipmentPriceRow[]
  panelShopping: PdfEquipmentPriceRow[]
  rackDiagramDataUrl: string
  rackEquipment: PdfEquipmentPriceRow[]
  rackShopping: PdfEquipmentPriceRow[]
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

function drawDeviceListEntries(pdf: jsPDF, y: number, entries: PdfDeviceListEntry[]): number {
  const { w, h } = pageSize(pdf)
  const textW = w - 2 * M
  const lineH = 9
  for (const e of entries) {
    const segments: { text: string; bold: boolean; size: number }[] = [
      { text: e.context, bold: true, size: 8 },
      { text: e.displayTitle, bold: true, size: 9 },
    ]
    if (e.bom) segments.push({ text: e.bom, bold: false, size: 8 })
    segments.push({ text: e.meta, bold: false, size: 8 })
    if (e.tail) segments.push({ text: e.tail, bold: false, size: 8 })

    for (const seg of segments) {
      pdf.setFontSize(seg.size)
      pdf.setFont('helvetica', seg.bold ? 'bold' : 'normal')
      const parts = pdf.splitTextToSize(seg.text, textW)
      const blockH = parts.length * lineH
      if (y + blockH > h - M) {
        pdf.addPage()
        y = M
      }
      pdf.text(parts, M, y)
      y += blockH + 1
    }
    y += 8
  }
  return y + 4
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
        pdf.setFontSize(8)
        pdf.setFont('helvetica', 'normal')
        const lineH = 8
        const maxBottom = h - M - 4
        for (const name of wall.deviceNames) {
          const raw = String(name).replace(/\r\n/g, '\n')
          const parts = pdf.splitTextToSize(raw, cellW)
          const blockH = parts.length * lineH
          if (cellY + blockH > maxBottom) {
            const ell = pdf.splitTextToSize('…', cellW)
            pdf.text(ell, x, cellY)
            cellY += ell.length * lineH + 2
            break
          }
          pdf.text(parts, x, cellY)
          cellY += blockH + 3
        }
      }

      rowBottom = Math.max(rowBottom, cellY)
    }
    y = rowBottom + gap
  }
  return y
}

function fmtEuro(n: number): string {
  return `€${n.toFixed(2)}`
}

/** Price table: equipment (name + optional note), qty, unit, line total; last row may be total. */
function drawEquipmentPriceTable(
  pdf: jsPDF,
  startY: number,
  rows: PdfEquipmentPriceRow[],
  emptyMessage: string,
): number {
  const { w, h } = pageSize(pdf)
  const tableW = w - 2 * M
  if (rows.length === 0) {
    return drawBodyLines(pdf, startY, [emptyMessage])
  }

  const colGap = 10
  const wQty = 32
  const wUnit = 56
  const wTot = 60
  const wName = Math.max(120, tableW - wQty - wUnit - wTot - 3 * colGap)
  const xName = M
  const xQty = xName + wName + colGap
  const xUnit = xQty + wQty + colGap
  const xTot = xUnit + wUnit + colGap
  const lineH = 9
  let y = startY

  const drawHeaderRow = () => {
    pdf.setFontSize(9)
    pdf.setFont('helvetica', 'bold')
    pdf.text('Equipment', xName, y)
    pdf.text('Qty', xQty + wQty, y, { align: 'right' })
    pdf.text('Unit €', xUnit + wUnit, y, { align: 'right' })
    pdf.text('Total €', xTot + wTot, y, { align: 'right' })
    y += lineH + 2
    pdf.setDrawColor(190)
    pdf.setLineWidth(0.35)
    pdf.line(M, y, M + tableW, y)
    y += 6
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
  }

  drawHeaderRow()

  for (const row of rows) {
    if (row.isTotal) {
      pdf.setDrawColor(190)
      pdf.line(M, y - 2, M + tableW, y - 2)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.text(row.name, xName, y)
      pdf.text(row.qty > 0 ? String(row.qty) : '', xQty + wQty, y, { align: 'right' })
      pdf.text(row.unitPrice > 0 ? fmtEuro(row.unitPrice) : '', xUnit + wUnit, y, { align: 'right' })
      pdf.text(fmtEuro(row.lineTotal), xTot + wTot, y, { align: 'right' })
      pdf.setFont('helvetica', 'normal')
      y += lineH + 10
      continue
    }

    const nameBlock = row.note ? `${row.name}\n${row.note}` : row.name
    const nameParts = pdf.splitTextToSize(nameBlock, wName)
    const nameH = nameParts.length * lineH
    const rowH = Math.max(nameH, lineH)

    if (y + rowH + 24 > h - M) {
      pdf.addPage()
      y = M
      drawHeaderRow()
    }

    pdf.setFontSize(8)
    pdf.setFont('helvetica', 'normal')
    pdf.text(nameParts, xName, y)
    pdf.text(String(row.qty), xQty + wQty, y, { align: 'right' })
    pdf.text(fmtEuro(row.unitPrice), xUnit + wUnit, y, { align: 'right' })
    pdf.text(fmtEuro(row.lineTotal), xTot + wTot, y, { align: 'right' })
    y += rowH + 4
  }

  return y + 4
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
  y = drawHeading(pdf, y, 'Device catalog (templates)')
  if (input.deviceListEntries.length === 0) {
    y = drawBodyLines(pdf, y, ['(no rows in deviceCatalog — add templates on the Devices tab.)'])
  } else {
    y = drawDeviceListEntries(pdf, y, input.deviceListEntries)
  }

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Panel')
  y = drawSubheading(pdf, y, 'Panel diagram')
  y = addImageFitWidth(pdf, y, input.panelDiagramDataUrl)
  y = drawSubheading(pdf, y, 'Panel equipment')
  y = drawEquipmentPriceTable(pdf, y, input.panelEquipment, '(no modules on the panel grid.)')
  y = drawSubheading(pdf, y, 'Panel shopping list')
  y = drawEquipmentPriceTable(pdf, y, input.panelShopping, '(no panel BOM lines.)')

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Rack')
  y = drawSubheading(pdf, y, 'Rack diagram')
  y = addImageFitWidth(pdf, y, input.rackDiagramDataUrl)
  y = drawSubheading(pdf, y, 'Rack equipment')
  y = drawEquipmentPriceTable(pdf, y, input.rackEquipment, '(no rack gear.)')
  y = drawSubheading(pdf, y, 'Rack shopping list')
  y = drawEquipmentPriceTable(pdf, y, input.rackShopping, '(no rack BOM lines.)')

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Shopping list by manufacturer (floor & wall)')
  if (input.shoppingByManufacturer.length === 0) {
    y = drawBodyLines(pdf, y, ['(no floor or wall shopping lines.)'])
  } else {
    for (const grp of input.shoppingByManufacturer) {
      y = drawSubheading(pdf, y, grp.displayTitle)
      y = drawEquipmentPriceTable(
        pdf,
        y,
        grp.rows,
        '(no lines in this manufacturer group.)',
      )
    }
  }

  pdf.addPage()
  y = M
  y = drawHeading(pdf, y, 'Shopping list by floor (floor & wall)')
  if (input.shoppingByFloor.length === 0) {
    y = drawBodyLines(pdf, y, ['(no floor or wall shopping lines with a floor label.)'])
  } else {
    for (const grp of input.shoppingByFloor) {
      y = drawSubheading(pdf, y, grp.displayTitle)
      y = drawEquipmentPriceTable(
        pdf,
        y,
        grp.rows,
        '(no lines in this floor group.)',
      )
    }
  }

  return pdf.output('blob')
}
