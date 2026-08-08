import type { PlanRegion, PointM, WallSegment, WallSheet } from '../types/project'

/** Plan convention: +X points east (right), +Y points south (down). */
export type Compass = 'north' | 'north-east' | 'east' | 'south-east' | 'south' | 'south-west' | 'west' | 'north-west'

const COMPASS_8: Compass[] = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
]

/** Bearing in degrees from +X, wrapped to a compass point. */
export function bearingToCompass(deg: number): Compass {
  const d = ((deg % 360) + 360) % 360
  return COMPASS_8[Math.round(d / 45) % 8]!
}

/** Cardinal only — better for naming walls ("the north wall") than 8-point. */
export function bearingToCardinal(deg: number): 'north' | 'east' | 'south' | 'west' {
  const d = ((deg % 360) + 360) % 360
  if (d < 45 || d >= 315) return 'east'
  if (d < 135) return 'south'
  if (d < 225) return 'west'
  return 'north'
}

export function polygonAreaM2(vertices: PointM[]): number {
  if (vertices.length < 3) return 0
  let acc = 0
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    acc += a.x * b.y - b.x * a.y
  }
  return Math.abs(acc) / 2
}

export function polygonCentroid(vertices: PointM[]): PointM {
  if (vertices.length === 0) return { x: 0, y: 0 }
  let sx = 0
  let sy = 0
  for (const v of vertices) {
    sx += v.x
    sy += v.y
  }
  return { x: sx / vertices.length, y: sy / vertices.length }
}

export function polygonBbox(vertices: PointM[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
  w: number
  d: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const v of vertices) {
    minX = Math.min(minX, v.x)
    minY = Math.min(minY, v.y)
    maxX = Math.max(maxX, v.x)
    maxY = Math.max(maxY, v.y)
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, d: 0 }
  return { minX, minY, maxX, maxY, w: maxX - minX, d: maxY - minY }
}

/** Perpendicular distance from `p` to the segment `a–b` (not the infinite line). */
export function distanceToSegmentM(p: PointM, a: PointM, b: PointM): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Which side of the room a wall sits on, seen from the room centre. A wall whose midpoint
 * is above the centroid is the "north wall", and so on — the phrasing a person (or an
 * image model) actually reasons with, unlike raw plan coordinates.
 */
export function wallSideOfRoom(seg: WallSegment, centroid: PointM): 'north' | 'east' | 'south' | 'west' {
  const mx = (seg.a.x + seg.b.x) / 2
  const my = (seg.a.y + seg.b.y) / 2
  return bearingToCardinal((Math.atan2(my - centroid.y, mx - centroid.x) * 180) / Math.PI)
}

export type RoomWallInfo = {
  sheet: WallSheet
  segment?: WallSegment
  side: 'north' | 'east' | 'south' | 'west'
}

/**
 * Room wall faces labelled by the side they sit on, ordered N → E → S → W. Sides are
 * de-duplicated with a suffix so two north-facing chords stay distinguishable.
 */
export function roomWallsBySide(
  region: PlanRegion,
  sheets: WallSheet[],
  segments: WallSegment[],
): RoomWallInfo[] {
  const centroid = polygonCentroid(region.vertices)
  const out: RoomWallInfo[] = sheets.map((sheet) => {
    const segment = sheet.wallSegmentId
      ? segments.find((s) => s.id === sheet.wallSegmentId)
      : undefined
    return {
      sheet,
      segment,
      side: segment ? wallSideOfRoom(segment, centroid) : 'north',
    }
  })
  const order: Record<string, number> = { north: 0, east: 1, south: 2, west: 3 }
  out.sort(
    (a, b) => order[a.side]! - order[b.side]! || b.sheet.lengthM - a.sheet.lengthM,
  )
  return out
}

/**
 * Human placement phrase for an item inside a room — "against the north wall",
 * "in the south-east corner", "free-standing in the middle of the room". Far more useful
 * to a generative model than a coordinate pair.
 */
export function describePlacementInRoom(
  point: PointM,
  /** Half-extent of the item toward its nearest wall; lets a deep sofa still read as "against". */
  clearanceM: number,
  region: PlanRegion,
  walls: RoomWallInfo[],
  /** Noun for the enclosing space — "room" indoors, "space" for a terrace. */
  spaceNoun = 'room',
): string {
  const centroid = polygonCentroid(region.vertices)
  const bbox = polygonBbox(region.vertices)

  let nearest: { side: RoomWallInfo['side']; dist: number } | null = null
  for (const w of walls) {
    if (!w.segment) continue
    const d = distanceToSegmentM(point, w.segment.a, w.segment.b)
    if (!nearest || d < nearest.dist) nearest = { side: w.side, dist: d }
  }

  /* Within roughly its own half-depth of a wall reads as "against" it. */
  const againstThreshold = Math.max(0.35, clearanceM + 0.25)
  if (nearest && nearest.dist <= againstThreshold) {
    return `against the ${nearest.side} wall`
  }

  const dx = point.x - centroid.x
  const dy = point.y - centroid.y
  const spanX = Math.max(bbox.w, 0.01)
  const spanY = Math.max(bbox.d, 0.01)
  const nearCentre = Math.abs(dx) < spanX * 0.18 && Math.abs(dy) < spanY * 0.18
  if (nearCentre) return `free-standing in the middle of the ${spaceNoun}`

  const compass = bearingToCompass((Math.atan2(dy, dx) * 180) / Math.PI)
  return `in the ${compass} part of the ${spaceNoun}`
}

/** Where an opening sits along its wall, phrased for a reader rather than as an offset. */
export function describeAlongWall(xM: number, lengthM: number): string {
  if (lengthM <= 0) return 'on the wall'
  const t = xM / lengthM
  if (t < 0.25) return 'near the left-hand end'
  if (t > 0.75) return 'near the right-hand end'
  if (t > 0.42 && t < 0.58) return 'centred'
  return t < 0.5 ? 'left of centre' : 'right of centre'
}
