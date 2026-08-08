import {
  regionIsExternal,
  type EditorSettings,
  type FloorLevel,
  type FurnitureItem,
  type PointM,
  type WallOpening,
  type WallSegment,
} from '../types/project'
import { effectiveWallMaterial, effectiveWallThicknessM } from './wallConstruction'
import { furnitureDisplayLabel, furnitureSpec } from './furnitureCatalog'
import { along01ForWallMirrorOnPlan } from './planWallMirrorPosition'
import { polygonAreaM2, polygonBbox, polygonCentroid } from './roomGeometry'

/** Light "drawing paper" palette — reads far better as a model reference than the dark editor. */
const PAPER = '#ffffff'
const INK = '#1e293b'
const ROOM_FILL = '#eef2f7'
const EXTERNAL_FILL = '#e6f4ea'
const EXTERNAL_EDGE = '#7fbf95'
const FURNITURE_FILL = '#dbe3ec'
const FURNITURE_EDGE = '#64748b'
const STONE_FILL = '#a8a29e'
const DOOR_INK = '#b45309'
const WINDOW_INK = '#0369a1'

export type FloorPlanImageOptions = {
  /** Logical canvas size in CSS px before `pixelRatio`. */
  widthPx?: number
  heightPx?: number
  pixelRatio?: number
  showFurniture?: boolean
  /** Draw plan device marks (lights, sockets…) as small dots. */
  showDevices?: boolean
  /** Shown in the title band alongside the floor label. */
  projectName?: string
}

type Ctx = CanvasRenderingContext2D

function fmt(x: number): string {
  return (Math.round(x * 100) / 100).toString()
}

/**
 * All openings on a segment, de-duplicated across the two room faces that share them, at
 * their position **on the wall centreline**. `worldXYForWallMirrorOnPlan` deliberately
 * nudges icons off the wall for editor readability; a real plan needs the true point.
 */
function uniqueOpeningsForSegment(
  fl: FloorLevel,
  seg: WallSegment,
): { opening: WallOpening; world: PointM }[] {
  const seen = new Set<string>()
  const out: { opening: WallOpening; world: PointM }[] = []
  for (const sheet of fl.wallSheets) {
    if (sheet.wallSegmentId !== seg.id) continue
    for (const o of sheet.openings ?? []) {
      if (seen.has(o.id)) continue
      seen.add(o.id)
      const u = along01ForWallMirrorOnPlan(fl, sheet, o.xM)
      const t = u == null ? 0.5 : Math.min(1, Math.max(0, u))
      out.push({
        opening: o,
        world: {
          x: seg.a.x + (seg.b.x - seg.a.x) * t,
          y: seg.a.y + (seg.b.y - seg.a.y) * t,
        },
      })
    }
  }
  return out
}

/** Shorten `text` with an ellipsis so it fits `maxPx` in the current font. */
function fitText(ctx: Ctx, text: string, maxPx: number): string | null {
  if (ctx.measureText(text).width <= maxPx) return text
  if (maxPx < 24) return null
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxPx) lo = mid
    else hi = mid - 1
  }
  return lo >= 2 ? `${text.slice(0, lo)}…` : null
}

function drawRotatedRect(
  ctx: Ctx,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angleRad: number,
  draw: (ctx: Ctx, w: number, h: number) => void,
): void {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angleRad)
  draw(ctx, w, h)
  ctx.restore()
}

/** Diagonal hatch inside the current path region — the plan convention for masonry. */
function hatchRect(ctx: Ctx, w: number, h: number, stepPx: number): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(-w / 2, -h / 2, w, h)
  ctx.clip()
  ctx.strokeStyle = 'rgba(30,41,59,0.55)'
  ctx.lineWidth = 1
  for (let x = -w / 2 - h; x < w / 2 + h; x += stepPx) {
    ctx.beginPath()
    ctx.moveTo(x, -h / 2)
    ctx.lineTo(x + h, h / 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawNorthArrow(ctx: Ctx, x: number, y: number, size: number): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = INK
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(0, -size)
  ctx.lineTo(size * 0.42, size * 0.55)
  ctx.lineTo(0, size * 0.2)
  ctx.lineTo(-size * 0.42, size * 0.55)
  ctx.closePath()
  ctx.fill()
  ctx.font = `600 ${Math.round(size * 0.8)}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('N', 0, -size * 1.15)
  ctx.restore()
}

function drawScaleBar(ctx: Ctx, x: number, y: number, ppm: number): void {
  /* Pick a round metre length that lands between 60 and 160 px. */
  const candidates = [1, 2, 5, 10, 20]
  const meters = candidates.find((m) => m * ppm >= 60 && m * ppm <= 160) ?? 1
  const w = meters * ppm
  ctx.save()
  ctx.strokeStyle = INK
  ctx.fillStyle = INK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, y)
  ctx.lineTo(x + w, y)
  ctx.stroke()
  for (const t of [0, 0.5, 1]) {
    ctx.beginPath()
    ctx.moveTo(x + w * t, y - 5)
    ctx.lineTo(x + w * t, y + 5)
    ctx.stroke()
  }
  ctx.fillRect(x, y - 3, w / 2, 3)
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillText(`0`, x - 2, y + 7)
  ctx.fillText(`${meters} m`, x + w - 12, y + 7)
  ctx.restore()
}

function drawFurniture(ctx: Ctx, item: FurnitureItem, wx: (n: number) => number, wy: (n: number) => number, ppm: number): void {
  const spec = furnitureSpec(item.kind)
  const w = item.widthM * ppm
  const h = item.depthM * ppm
  const rad = (item.rotationDeg * Math.PI) / 180

  drawRotatedRect(ctx, wx(item.x), wy(item.y), w, h, rad, (c) => {
    c.fillStyle = FURNITURE_FILL
    c.strokeStyle = FURNITURE_EDGE
    c.lineWidth = 1.2

    if (spec.glyph === 'l_shape') {
      const notchW = w * 0.55
      const notchD = h * 0.5
      c.beginPath()
      c.moveTo(-w / 2, -h / 2)
      c.lineTo(w / 2, -h / 2)
      c.lineTo(w / 2, h / 2 - notchD)
      c.lineTo(w / 2 - notchW, h / 2 - notchD)
      c.lineTo(w / 2 - notchW, h / 2)
      c.lineTo(-w / 2, h / 2)
      c.closePath()
      c.fill()
      c.stroke()
    } else if (spec.glyph === 'round') {
      c.beginPath()
      c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      c.fill()
      c.stroke()
    } else if (spec.glyph === 'glass') {
      c.setLineDash([5, 3])
      c.fillStyle = 'rgba(125,211,252,0.22)'
      c.fillRect(-w / 2, -h / 2, w, h)
      c.strokeRect(-w / 2, -h / 2, w, h)
      c.setLineDash([])
      c.beginPath()
      c.moveTo(-w / 2, h / 2)
      c.lineTo(w / 2, -h / 2)
      c.stroke()
    } else {
      c.fillRect(-w / 2, -h / 2, w, h)
      c.strokeRect(-w / 2, -h / 2, w, h)
      if (spec.glyph === 'seat') {
        c.fillStyle = FURNITURE_EDGE
        c.globalAlpha = 0.45
        c.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.22))
        c.globalAlpha = 1
      } else if (spec.glyph === 'bed') {
        c.fillStyle = FURNITURE_EDGE
        c.globalAlpha = 0.4
        c.fillRect(-w / 2 + w * 0.08, -h / 2 + 2, w * 0.84, Math.max(3, h * 0.18))
        c.globalAlpha = 1
      } else if (spec.glyph === 'bowl') {
        c.beginPath()
        c.ellipse(0, 0, (w / 2) * 0.6, (h / 2) * 0.55, 0, 0, Math.PI * 2)
        c.stroke()
      }
    }
  })

  /* Label upright regardless of rotation, clipped to the footprint so it never sprawls
   * across neighbouring items or the room name. */
  ctx.save()
  ctx.font = `${Math.max(8, Math.min(11, ppm * 0.11))}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const rad2 = Math.abs(Math.cos(rad))
  const sin2 = Math.abs(Math.sin(rad))
  const footprintW = w * rad2 + h * sin2
  const label = fitText(ctx, furnitureDisplayLabel(item), footprintW - 8)
  if (label) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = 3
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.fillStyle = '#334155'
    ctx.strokeText(label, wx(item.x), wy(item.y))
    ctx.fillText(label, wx(item.x), wy(item.y))
  }
  ctx.restore()
}

/**
 * Renders the floor as a clean, light architectural plan (walls at true thickness with
 * masonry hatch, real door swings and window breaks, furniture footprints, room names with
 * areas, north arrow and scale bar) and returns a PNG data URL.
 *
 * This is the reference image attached to the 3D render prompt: it carries the layout that
 * prose cannot, so the text can stay short and descriptive. Browser only.
 */
export function renderFloorPlanImagePngDataUrl(
  fl: FloorLevel,
  settings: EditorSettings,
  opts: FloorPlanImageOptions = {},
): string | null {
  if (typeof document === 'undefined') return null

  const plan = fl.plan
  const segs = plan.wallSegments ?? []
  const regions = plan.regions ?? []
  const furniture = opts.showFurniture === false ? [] : (plan.furniture ?? [])

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const s of segs) {
    grow(s.a.x, s.a.y)
    grow(s.b.x, s.b.y)
  }
  for (const r of regions) for (const v of r.vertices) grow(v.x, v.y)
  for (const f of furniture) {
    const half = (f.widthM + f.depthM) / 2
    grow(f.x - half, f.y - half)
    grow(f.x + half, f.y + half)
  }
  if (!Number.isFinite(minX)) {
    grow(0, 0)
    grow(plan.widthM, plan.depthM)
  }

  const padM = 0.5
  minX -= padM
  minY -= padM
  maxX += padM
  maxY += padM
  const spanX = Math.max(maxX - minX, 1)
  const spanY = Math.max(maxY - minY, 1)

  const cw = opts.widthPx ?? 1400
  const titleBand = 46
  const footerBand = 44
  const margin = 24
  /* Height follows the plan's aspect so the drawing is never letterboxed. */
  const plotW = cw - margin * 2
  const ppm = plotW / spanX
  const plotH = spanY * ppm
  const ch = Math.round(plotH + titleBand + footerBand + margin)
  const dpr = opts.pixelRatio ?? 2

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(cw * dpr)
  canvas.height = Math.round(ch * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)

  const wx = (x: number) => margin + (x - minX) * ppm
  const wy = (y: number) => titleBand + (y - minY) * ppm

  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, cw, ch)

  // Title
  ctx.fillStyle = INK
  ctx.font = '600 17px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const projectName = opts.projectName?.trim()
  ctx.fillText(
    projectName ? `${projectName} — ${fl.label} floor plan` : `${fl.label} — floor plan`,
    margin,
    12,
  )
  ctx.font = '12px system-ui, sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.fillText('dimensions in metres · north is up', margin, 30)

  // Rooms
  for (const region of regions) {
    if (region.vertices.length < 3) continue
    const external = regionIsExternal(region)
    ctx.beginPath()
    region.vertices.forEach((v, i) => {
      if (i === 0) ctx.moveTo(wx(v.x), wy(v.y))
      else ctx.lineTo(wx(v.x), wy(v.y))
    })
    ctx.closePath()
    ctx.fillStyle = external ? EXTERNAL_FILL : ROOM_FILL
    ctx.fill()
    if (external) {
      ctx.strokeStyle = EXTERNAL_EDGE
      ctx.lineWidth = 1.5
      ctx.setLineDash([7, 5])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  // Furniture sits under the walls so wall faces stay crisp
  for (const f of furniture) drawFurniture(ctx, f, wx, wy, ppm)

  // Walls at true thickness
  for (const seg of segs) {
    const thickPx = Math.max(3, effectiveWallThicknessM(seg, settings) * ppm)
    const material = effectiveWallMaterial(seg, settings)
    const ax = wx(seg.a.x)
    const ay = wy(seg.a.y)
    const bx = wx(seg.b.x)
    const by = wy(seg.b.y)
    const len = Math.hypot(bx - ax, by - ay)
    const angle = Math.atan2(by - ay, bx - ax)

    drawRotatedRect(ctx, (ax + bx) / 2, (ay + by) / 2, len, thickPx, angle, (c, w, h) => {
      c.fillStyle = material === 'rock' ? STONE_FILL : PAPER
      c.fillRect(-w / 2, -h / 2, w, h)
      if (material === 'rock') hatchRect(c, w, h, Math.max(5, thickPx * 0.55))
      c.strokeStyle = INK
      c.lineWidth = 1.6
      c.strokeRect(-w / 2, -h / 2, w, h)
    })
  }

  // Openings: cut the wall, then draw the door swing / window break
  for (const seg of segs) {
    const thickPx = Math.max(3, effectiveWallThicknessM(seg, settings) * ppm)
    const angle = Math.atan2(wy(seg.b.y) - wy(seg.a.y), wx(seg.b.x) - wx(seg.a.x))
    for (const { opening, world } of uniqueOpeningsForSegment(fl, seg)) {
      const cx = wx(world.x)
      const cy = wy(world.y)
      const wPx = opening.widthM * ppm

      // Erase the wall across the opening
      drawRotatedRect(ctx, cx, cy, wPx, thickPx, angle, (c, w, h) => {
        c.fillStyle = PAPER
        c.fillRect(-w / 2, -h / 2 - 1, w, h + 2)
        c.strokeStyle = INK
        c.lineWidth = 1.2
        /* Keep the two reveal jambs so the opening reads as a hole, not a break. */
        c.beginPath()
        c.moveTo(-w / 2, -h / 2)
        c.lineTo(-w / 2, h / 2)
        c.moveTo(w / 2, -h / 2)
        c.lineTo(w / 2, h / 2)
        c.stroke()
      })

      if (opening.kind === 'window') {
        drawRotatedRect(ctx, cx, cy, wPx, thickPx, angle, (c, w, h) => {
          c.strokeStyle = WINDOW_INK
          c.lineWidth = 1.6
          c.beginPath()
          c.moveTo(-w / 2, -h / 6)
          c.lineTo(w / 2, -h / 6)
          c.moveTo(-w / 2, h / 6)
          c.lineTo(w / 2, h / 6)
          c.stroke()
        })
      } else {
        drawRotatedRect(ctx, cx, cy, wPx, thickPx, angle, (c, w) => {
          c.strokeStyle = DOOR_INK
          c.lineWidth = 1.6
          // Leaf hinged at the left jamb, swinging to the +normal side
          c.beginPath()
          c.moveTo(-w / 2, 0)
          c.lineTo(-w / 2, w)
          c.stroke()
          c.beginPath()
          c.arc(-w / 2, 0, w, 0, Math.PI / 2)
          c.stroke()
        })
      }
    }
  }

  // Devices
  if (opts.showDevices) {
    for (const d of plan.devices) {
      ctx.beginPath()
      ctx.arc(wx(d.x), wy(d.y), Math.max(2.5, ppm * 0.045), 0, Math.PI * 2)
      ctx.fillStyle = '#2563eb'
      ctx.fill()
    }
  }

  // Room names + areas, drawn last so they sit above everything. Placed near the top of
  // each room rather than the centroid, where furniture usually sits.
  for (const region of regions) {
    if (region.vertices.length < 3) continue
    const c = polygonCentroid(region.vertices)
    const bb = polygonBbox(region.vertices)
    const labelY = wy(Math.min(bb.minY + bb.d * 0.16, c.y))
    const area = polygonAreaM2(region.vertices)
    const external = regionIsExternal(region)
    const name = region.label.trim() || 'Room'
    const sub = `${fmt(area)} m²${external ? ' · outdoor' : ''}`
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 4.5
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'

    ctx.font = '600 15px system-ui, sans-serif'
    ctx.fillStyle = external ? '#166534' : INK
    ctx.strokeText(name, wx(c.x), labelY)
    ctx.fillText(name, wx(c.x), labelY)

    ctx.font = '12px system-ui, sans-serif'
    ctx.fillStyle = '#475569'
    ctx.strokeText(sub, wx(c.x), labelY + 17)
    ctx.fillText(sub, wx(c.x), labelY + 17)
    ctx.restore()
  }

  // Footer: scale bar, north arrow, legend
  const footY = titleBand + plotH + 22
  drawScaleBar(ctx, margin, footY, ppm)
  drawNorthArrow(ctx, cw - margin - 16, footY - 2, 13)

  ctx.font = '11px system-ui, sans-serif'
  ctx.fillStyle = '#64748b'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(
    'hatched walls = stone · plain walls = painted · orange = door swing · blue = window',
    margin + 190,
    footY,
  )

  return canvas.toDataURL('image/png')
}
