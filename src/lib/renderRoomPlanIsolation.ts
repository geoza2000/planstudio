import { pointInPolygon } from './geometry'
import {
  derivedPlanWallCode,
  floorLevelSortIndex,
  wallSegmentStableIndexMap,
} from './wallPlanSync'
import { roomLabelSlug } from './wallRoomTopology'
import type { FloorLevel, PlanRegion, PointM, WallSegment } from '../types/project'

/**
 * Plan-linked sheet labels are `L{lvl}_{idx}_<roomSlug>` (see `withRoomLabelsApplied` in
 * wallRoomReconcile). On an isolated room canvas the room is obvious, so drop the suffix.
 */
function stripRedundantRoomSlugFromCode(label: string, reg: PlanRegion): string {
  const slug = roomLabelSlug(reg.label ?? '')
  const suffix = `_${slug}`
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
}

function polygonCentroidApprox(verts: PointM[]): PointM {
  let sx = 0
  let sy = 0
  for (const v of verts) {
    sx += v.x
    sy += v.y
  }
  const n = verts.length || 1
  return { x: sx / n, y: sy / n }
}

/** Unit normal perpendicular to segment, pointing toward `toward` (e.g. room interior). */
function normalTowardPoint(seg: WallSegment, toward: PointM): PointM {
  const mx = (seg.a.x + seg.b.x) / 2
  const my = (seg.a.y + seg.b.y) / 2
  const dx = seg.b.x - seg.a.x
  const dy = seg.b.y - seg.a.y
  const len = Math.hypot(dx, dy) || 1
  const n1 = { x: -dy / len, y: dx / len }
  const n2 = { x: dy / len, y: -dx / len }
  const tx = toward.x - mx
  const ty = toward.y - my
  const d1 = n1.x * tx + n1.y * ty
  return d1 >= 0 ? n1 : n2
}

function wallLabelForSegment(
  fl: FloorLevel,
  reg: PlanRegion,
  seg: WallSegment,
  allFloors: FloorLevel[],
): string {
  const faces = fl.wallSheets.filter(
    (ws) => ws.wallSegmentId === seg.id && ws.roomRegionId === reg.id,
  )
  const labels = [
    ...new Set(
      faces
        .map((w) => stripRedundantRoomSlugFromCode(w.label.trim(), reg))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b))
  if (labels.length > 0) {
    return labels.join(' · ')
  }
  const levelIdx = floorLevelSortIndex(allFloors, fl.id)
  const idxMap = wallSegmentStableIndexMap(fl.plan.wallSegments ?? [])
  const idx = idxMap.get(seg.id) ?? 0
  return derivedPlanWallCode(levelIdx, idx || 1)
}

function truncateLabel(ctx: CanvasRenderingContext2D, text: string, maxPx: number): string {
  if (ctx.measureText(text).width <= maxPx) return text
  const ell = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const t = text.slice(0, mid) + ell
    if (ctx.measureText(t).width <= maxPx) lo = mid
    else hi = mid - 1
  }
  return text.slice(0, Math.max(0, lo)) + ell
}

function drawWallLabels(
  ctx: CanvasRenderingContext2D,
  fl: FloorLevel,
  reg: PlanRegion,
  roomSegs: WallSegment[],
  verts: PointM[],
  wx: (x: number) => number,
  wy: (y: number) => number,
  ppm: number,
  allFloors: FloorLevel[],
): void {
  const centroid = polygonCentroidApprox(verts)
  const fontPx = Math.max(10, Math.min(15, ppm * 0.14))
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const s of roomSegs) {
    const mx = (s.a.x + s.b.x) / 2
    const my = (s.a.y + s.b.y) / 2
    const n = normalTowardPoint(s, centroid)
    const offsetM = Math.max(0.12, Math.min(0.35, 0.08 + 0.22 / Math.max(ppm * 0.02, 0.5)))
    const lx = mx + n.x * offsetM
    const ly = my + n.y * offsetM
    const px = wx(lx)
    const py = wy(ly)
    const segLenPx = Math.hypot(wx(s.b.x) - wx(s.a.x), wy(s.b.y) - wy(s.a.y))
    const maxTextW = Math.max(48, segLenPx * 0.92)

    const raw = wallLabelForSegment(fl, reg, s, allFloors)
    const text = truncateLabel(ctx, raw, maxTextW)

    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(3, fontPx * 0.35)
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'
    ctx.fillStyle = '#0f172a'
    ctx.strokeText(text, px, py)
    ctx.fillText(text, px, py)
  }
}

function aabbOfVertices(verts: PointM[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of verts) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  return { minX, minY, maxX, maxY }
}

function growAabb(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  p: PointM,
): void {
  box.minX = Math.min(box.minX, p.x)
  box.minY = Math.min(box.minY, p.y)
  box.maxX = Math.max(box.maxX, p.x)
  box.maxY = Math.max(box.maxY, p.y)
}

function segmentIdsFromCycleSignature(reg: PlanRegion): Set<string> | null {
  const s = reg.wallCycleSignature?.trim()
  if (!s) return null
  const ids = s.split('|').filter(Boolean)
  if (ids.length === 0) return null
  return new Set(ids)
}

function segmentBelongsToRoom(reg: PlanRegion, seg: WallSegment): boolean {
  const bySig = segmentIdsFromCycleSignature(reg)
  if (bySig) return bySig.has(seg.id)
  const verts = reg.vertices
  if (verts.length < 3) return false
  const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 }
  if (pointInPolygon(seg.a, verts)) return true
  if (pointInPolygon(seg.b, verts)) return true
  if (pointInPolygon(mid, verts)) return true
  for (let i = 0; i < verts.length; i++) {
    const p1 = verts[i]!
    const p2 = verts[(i + 1) % verts.length]!
    if (segmentsIntersectProper(seg.a, seg.b, p1, p2)) return true
  }
  return false
}

function ccw(a: PointM, b: PointM, c: PointM): boolean {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x)
}

/** Open segments `a–b` and `c–d` (excluding shared-endpoint touches as non-interior). */
function segmentsIntersectProper(a: PointM, b: PointM, c: PointM, d: PointM): boolean {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)
}

/**
 * Renders a cropped plan view for one region: room polygon, boundary / interior walls,
 * and floor devices inside the polygon. Intended for PDF room summaries (browser only).
 */
export function renderRoomIsolationPngDataUrl(
  fl: FloorLevel,
  regionId: string,
  opts?: {
    widthPx?: number
    heightPx?: number
    pixelRatio?: number
    /** Floors in project order (for `L0_…` wall codes when no sheet label). Defaults to `[fl]`. */
    allFloors?: FloorLevel[]
  },
): string | null {
  if (typeof document === 'undefined') return null
  const reg = fl.plan.regions.find((r) => r.id === regionId)
  const verts = reg?.vertices ?? []
  if (!reg || verts.length < 3) return null

  const segs = fl.plan.wallSegments ?? []
  const roomSegs = segs.filter((s) => segmentBelongsToRoom(reg, s))

  const box = aabbOfVertices(verts)
  for (const s of roomSegs) {
    growAabb(box, s.a)
    growAabb(box, s.b)
  }
  for (const d of fl.plan.devices) {
    if (pointInPolygon({ x: d.x, y: d.y }, verts)) {
      growAabb(box, { x: d.x, y: d.y })
    }
  }

  const padM = 0.35
  let minX = box.minX - padM
  let minY = box.minY - padM
  let maxX = box.maxX + padM
  let maxY = box.maxY + padM
  const span = Math.max(maxX - minX, maxY - minY, 0.5)

  const cw = opts?.widthPx ?? 720
  const ch = opts?.heightPx ?? 420
  const dpr = opts?.pixelRatio ?? 2
  const titleBand = 28
  const plotW = cw
  const plotH = ch - titleBand

  const canvas = document.createElement('canvas')
  canvas.width = cw * dpr
  canvas.height = ch * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)

  const allFloors = opts?.allFloors ?? [fl]

  const margin = 10
  const ppm = Math.min((plotW - 2 * margin) / span, (plotH - 2 * margin) / span)

  const ox = margin + (plotW - 2 * margin - (maxX - minX) * ppm) / 2 - minX * ppm
  const oy = titleBand + margin + (plotH - 2 * margin - (maxY - minY) * ppm) / 2 - minY * ppm

  const wx = (x: number) => ox + x * ppm
  const wy = (y: number) => oy + y * ppm

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cw, ch)

  ctx.fillStyle = '#0f172a'
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const title =
    (reg.label?.trim() || (reg.kind === 'patio' ? 'Patio' : reg.kind === 'other' ? 'Area' : 'Room')) +
    ` · ${fl.label}`
  ctx.fillText(title, margin, 8)

  ctx.fillStyle = '#f1f5f9'
  ctx.beginPath()
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i]!
    const px = wx(v.x)
    const py = wy(v.y)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = '#64748b'
  ctx.lineWidth = 1.5
  ctx.stroke()

  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = Math.max(2, ppm * 0.06)
  ctx.lineCap = 'round'
  for (const s of roomSegs) {
    ctx.beginPath()
    ctx.moveTo(wx(s.a.x), wy(s.a.y))
    ctx.lineTo(wx(s.b.x), wy(s.b.y))
    ctx.stroke()
  }

  drawWallLabels(ctx, fl, reg, roomSegs, verts, wx, wy, ppm, allFloors)

  const rDev = Math.max(3, ppm * 0.09)
  for (const d of fl.plan.devices) {
    if (!pointInPolygon({ x: d.x, y: d.y }, verts)) continue
    ctx.fillStyle = '#2563eb'
    ctx.beginPath()
    ctx.arc(wx(d.x), wy(d.y), rDev, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = '#1d4ed8'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  return canvas.toDataURL('image/png')
}
