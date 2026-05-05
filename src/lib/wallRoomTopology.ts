import { nanoid } from 'nanoid'
import type { PointM, WallSegment } from '../types/project'
import { segmentLengthM } from './wallPlanSync'

/**
 * Planar-graph face extraction for plan walls. A wall network is treated as a planar
 * undirected graph (each `WallSegment` = one edge); the bounded faces of that graph
 * are the rooms. The unbounded outer face is discarded.
 *
 * Algorithm: build directed half-edges, at each vertex sort incident half-edges by
 * polar angle, then walk faces by repeatedly taking the *next CCW* half-edge at the
 * destination of the current edge. Each bounded face becomes one room polygon.
 */

const VERTEX_PRECISION = 6
const EPS = 1e-9
/**
 * After T-subdivision, merge piece endpoints within this distance (m) before half-edges.
 * Otherwise two segments that meet at one corner but differ by ~0.1–1 mm in stored
 * coordinates become two graph vertices (`vKey` uses 6 decimals) and triple junctions
 * fail to close a face even though the drawing looks welded.
 * Keep below typical minimum wall spacing so unrelated corners are not merged.
 * 2.5 cm catches common float / drag slop (e.g. ~10–20 mm gaps at a triple joint) while
 * staying far from intentional openings between walls.
 */
const VERTEX_WELD_M = 0.025
/** Same order of magnitude as wall snapping — guest endpoint near host interior (m). */
const T_JUNCTION_TOL_M = 0.18
const PROJ_INTERIOR = 1e-5
const EPS_LEN = 1e-6

type GraphPiece = WallSegment & { parentId: string }

function pointsEq(p: PointM, q: PointM, eps: number): boolean {
  return Math.hypot(p.x - q.x, p.y - q.y) <= eps
}

function distPointToSegmentSquared(p: PointM, a: PointM, b: PointM): number {
  const lx = b.x - a.x
  const ly = b.y - a.y
  const len2 = lx * lx + ly * ly
  if (len2 < 1e-22) {
    const dx = p.x - a.x
    const dy = p.y - a.y
    return dx * dx + dy * dy
  }
  let t = ((p.x - a.x) * lx + (p.y - a.y) * ly) / len2
  t = Math.max(0, Math.min(1, t))
  const qx = a.x + t * lx
  const qy = a.y + t * ly
  const dx = p.x - qx
  const dy = p.y - qy
  return dx * dx + dy * dy
}

function projectionTOnSegment(p: PointM, a: PointM, b: PointM): number {
  const lx = b.x - a.x
  const ly = b.y - a.y
  const len2 = lx * lx + ly * ly
  if (len2 < 1e-22) return 0
  return Math.max(0, Math.min(1, ((p.x - a.x) * lx + (p.y - a.y) * ly) / len2))
}

/**
 * One-pass virtual split: T-junction vertices exist only in the planar graph used for
 * face detection. Plan `WallSegment` rows stay unsplit (one segment per physical wall).
 */
type SplitHit = { t: number; weld?: PointM }

function subdivideSegmentsForFaceGraph(segments: WallSegment[]): GraphPiece[] {
  if (!segments.length) return []

  const byHost = new Map<string, SplitHit[]>()
  const seenT = new Set<string>()

  const addHit = (hostId: string, t: number, weld?: PointM) => {
    if (t <= PROJ_INTERIOR || t >= 1 - PROJ_INTERIOR) return
    const k = `${hostId}:${t.toFixed(8)}`
    if (seenT.has(k)) return
    seenT.add(k)
    if (!byHost.has(hostId)) byHost.set(hostId, [])
    byHost.get(hostId)!.push({ t, weld: weld ? { ...weld } : undefined })
  }

  for (const guest of segments) {
    const Lg = segmentLengthM(guest.a, guest.b)
    if (Lg < EPS_LEN) continue
    for (const end of [guest.a, guest.b] as const) {
      for (const host of segments) {
        if (host.id === guest.id) continue
        const Lh = segmentLengthM(host.a, host.b)
        if (Lh < EPS_LEN) continue
        if (
          pointsEq(end, host.a, T_JUNCTION_TOL_M) ||
          pointsEq(end, host.b, T_JUNCTION_TOL_M)
        ) {
          continue
        }
        if (
          distPointToSegmentSquared(end, host.a, host.b) >
          T_JUNCTION_TOL_M * T_JUNCTION_TOL_M
        ) {
          continue
        }
        const t = projectionTOnSegment(end, host.a, host.b)
        if (t <= PROJ_INTERIOR || t >= 1 - PROJ_INTERIOR) continue
        // Weld the split vertex to the guest endpoint so planar keys match incident edges.
        addHit(host.id, t, end)
      }
    }
  }

  for (const [, hits] of byHost) {
    hits.sort((a, b) => a.t - b.t)
    for (let i = hits.length - 1; i > 0; i--) {
      if (Math.abs(hits[i]!.t - hits[i - 1]!.t) < 1e-6) {
        const a = hits[i - 1]!
        const b = hits[i]!
        hits[i - 1] = {
          t: (a.t + b.t) / 2,
          weld: a.weld ?? b.weld,
        }
        hits.splice(i, 1)
      }
    }
  }

  const out: GraphPiece[] = []
  for (const s of segments) {
    const hits = byHost.get(s.id)
    if (!hits || hits.length === 0) {
      out.push({
        ...s,
        a: { ...s.a },
        b: { ...s.b },
        parentId: s.id,
      })
      continue
    }

    const a = s.a
    const b = s.b
    const pts: PointM[] = [{ ...a }]
    for (const h of hits) {
      pts.push(
        h.weld ?? {
          x: a.x + h.t * (b.x - a.x),
          y: a.y + h.t * (b.y - a.y),
        },
      )
    }
    pts.push({ ...b })

    let firstNonDegenerate = true
    for (let i = 0; i < pts.length - 1; i++) {
      const pa = pts[i]!
      const pb = pts[i + 1]!
      if (segmentLengthM(pa, pb) <= EPS_LEN) continue
      const id = firstNonDegenerate ? s.id : nanoid()
      firstNonDegenerate = false
      out.push({
        id,
        a: { ...pa },
        b: { ...pb },
        parentId: s.id,
      })
    }
  }
  return out
}

/** Union-find weld of `pieces` endpoints; each cluster becomes the centroid of its points. */
function weldGraphPieceEndpoints(pieces: GraphPiece[]): GraphPiece[] {
  if (pieces.length === 0) return pieces

  const endpoints: PointM[] = []
  for (const p of pieces) {
    endpoints.push({ ...p.a })
    endpoints.push({ ...p.b })
  }
  const n = endpoints.length
  const uf = new Uint32Array(n)
  for (let i = 0; i < n; i++) uf[i] = i
  const find = (i: number): number => {
    if (uf[i] !== i) uf[i] = find(uf[i]!)
    return uf[i]!
  }
  const union = (i: number, j: number) => {
    const ri = find(i)
    const rj = find(j)
    if (ri !== rj) uf[ri] = rj
  }
  const eps2 = VERTEX_WELD_M * VERTEX_WELD_M
  for (let i = 0; i < n; i++) {
    const pi = endpoints[i]!
    for (let j = i + 1; j < n; j++) {
      const pj = endpoints[j]!
      const dx = pi.x - pj.x
      const dy = pi.y - pj.y
      if (dx * dx + dy * dy <= eps2) union(i, j)
    }
  }

  const agg = new Map<number, { x: number; y: number; c: number }>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const p = endpoints[i]!
    const g = agg.get(r) ?? { x: 0, y: 0, c: 0 }
    g.x += p.x
    g.y += p.y
    g.c += 1
    agg.set(r, g)
  }

  const welded: PointM[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const g = agg.get(r)!
    welded[i] = { x: g.x / g.c, y: g.y / g.c }
  }

  return pieces.map((p, pi) => ({
    ...p,
    a: { ...welded[pi * 2]! },
    b: { ...welded[pi * 2 + 1]! },
  }))
}

type ParentStep = { parentId: string; dir: 'ab' | 'ba' }

function compressPieceBoundaryToParents(
  pieceSegIds: string[],
  pieceDirs: ('ab' | 'ba')[],
  pieceById: Map<string, GraphPiece>,
): { segmentIds: string[]; edgeDirections: ('ab' | 'ba')[] } {
  const raw: ParentStep[] = []
  for (let i = 0; i < pieceSegIds.length; i++) {
    const piece = pieceById.get(pieceSegIds[i]!)
    if (!piece) continue
    raw.push({ parentId: piece.parentId, dir: pieceDirs[i]! })
  }

  const merged: ParentStep[] = []
  for (const s of raw) {
    const last = merged[merged.length - 1]
    if (last && last.parentId === s.parentId && last.dir === s.dir) continue
    merged.push(s)
  }

  const stack: ParentStep[] = []
  for (const s of merged) {
    const top = stack[stack.length - 1]
    if (top && top.parentId === s.parentId && top.dir !== s.dir) {
      stack.pop()
      continue
    }
    stack.push(s)
  }

  return {
    segmentIds: stack.map((x) => x.parentId),
    edgeDirections: stack.map((x) => x.dir),
  }
}

/** Drop consecutive duplicate vertices and near-duplicate closing point. */
function sanitizePolygonRing(verts: PointM[], tolM: number): PointM[] {
  if (verts.length < 2) return verts
  const out: PointM[] = [{ ...verts[0]! }]
  for (let i = 1; i < verts.length; i++) {
    const v = verts[i]!
    const u = out[out.length - 1]!
    if (Math.hypot(v.x - u.x, v.y - u.y) < tolM) continue
    out.push({ ...v })
  }
  if (out.length >= 2) {
    const first = out[0]!
    const last = out[out.length - 1]!
    if (Math.hypot(first.x - last.x, first.y - last.y) < tolM) out.pop()
  }
  return out
}

function vKey(p: PointM): string {
  return `${p.x.toFixed(VERTEX_PRECISION)},${p.y.toFixed(VERTEX_PRECISION)}`
}

function keyToPoint(k: string): PointM {
  const i = k.indexOf(',')
  return { x: parseFloat(k.slice(0, i)), y: parseFloat(k.slice(i + 1)) }
}

type HalfEdge = {
  /** Source vertex key. */
  from: string
  /** Destination vertex key. */
  to: string
  /** Underlying `WallSegment.id`. */
  segmentId: string
  /** Polar angle from `from` toward `to`, radians in [-π, π]. */
  angle: number
  /** Twin half-edge (opposite direction along same segment). */
  twinIndex: number
  /** Index in the ccw-sorted list of half-edges leaving `from`. */
  ccwIndex: number
}

/**
 * The bounded planar face that a half-edge belongs to. `vertices` are in CCW order
 * around the room interior; `segmentIds` are the underlying wall ids in traversal
 * order (one per polygon edge). The outer (unbounded) face is excluded.
 */
export type WallRoomFace = {
  vertices: PointM[]
  segmentIds: string[]
  /** For each polygon edge i (verts[i] -> verts[(i+1)%n]), the half-edge direction relative to the segment: 'ab' if the polygon traverses from segment.a to segment.b. */
  edgeDirections: ('ab' | 'ba')[]
  /** Sorted, joined segment ids — stable identity used to match the same face across recomputes. */
  cycleSignature: string
  /** Signed area in m² (always positive for CCW interior faces returned here). */
  area: number
}

function polygonSignedArea(verts: PointM[]): number {
  let a = 0
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length
    a += verts[i]!.x * verts[j]!.y - verts[j]!.x * verts[i]!.y
  }
  return a / 2
}

function buildHalfEdges(segments: WallSegment[]): {
  halfEdges: HalfEdge[]
  /** Map `from` vertex key → indices into `halfEdges`, ordered CCW (by angle). */
  byVertex: Map<string, number[]>
} {
  const halfEdges: HalfEdge[] = []
  const seenSig = new Set<string>()

  for (const s of segments) {
    const ka = vKey(s.a)
    const kb = vKey(s.b)
    if (ka === kb) continue
    // Collapse exact-duplicate segments (same endpoints) — they would create
    // parallel half-edges with equal angle and break the next-CCW ordering.
    const sig = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    if (seenSig.has(sig)) continue
    seenSig.add(sig)

    const ax = parseFloat(ka.slice(0, ka.indexOf(',')))
    const ay = parseFloat(ka.slice(ka.indexOf(',') + 1))
    const bx = parseFloat(kb.slice(0, kb.indexOf(',')))
    const by = parseFloat(kb.slice(kb.indexOf(',') + 1))
    const angAB = Math.atan2(by - ay, bx - ax)
    const angBA = Math.atan2(ay - by, ax - bx)

    const iAB = halfEdges.length
    const iBA = iAB + 1
    halfEdges.push({
      from: ka,
      to: kb,
      segmentId: s.id,
      angle: angAB,
      twinIndex: iBA,
      ccwIndex: -1,
    })
    halfEdges.push({
      from: kb,
      to: ka,
      segmentId: s.id,
      angle: angBA,
      twinIndex: iAB,
      ccwIndex: -1,
    })
  }

  const byVertex = new Map<string, number[]>()
  for (let i = 0; i < halfEdges.length; i++) {
    const k = halfEdges[i]!.from
    if (!byVertex.has(k)) byVertex.set(k, [])
    byVertex.get(k)!.push(i)
  }
  for (const list of byVertex.values()) {
    list.sort((a, b) => halfEdges[a]!.angle - halfEdges[b]!.angle)
    list.forEach((heIdx, pos) => {
      halfEdges[heIdx]!.ccwIndex = pos
    })
  }

  return { halfEdges, byVertex }
}

/**
 * After arriving at `he.to` along `he`, the *next* half-edge of the same face is the
 * one immediately CCW from the twin at the destination — i.e. the twin at the
 * destination vertex, then step one position counter-clockwise (incident edges share
 * the destination as their `from`).
 *
 * In the standard planar algorithm we take the *previous* edge in CCW order at the
 * destination (equivalent to the next in CW order). That walks the face on the *left*
 * of the directed edge (when polygon vertices are listed CCW the interior is on the left).
 */
function nextHalfEdgeOnFace(
  heIndex: number,
  halfEdges: HalfEdge[],
  byVertex: Map<string, number[]>,
): number {
  const he = halfEdges[heIndex]!
  const twinIdx = he.twinIndex
  const list = byVertex.get(he.to)!
  const twinPos = halfEdges[twinIdx]!.ccwIndex
  // Previous in CCW order = next half-edge of the face on the left of `he`.
  const nextPos = (twinPos - 1 + list.length) % list.length
  return list[nextPos]!
}

/**
 * Returns every bounded face of the planar wall graph, oriented CCW.
 *
 * Notes:
 * - Disconnected sub-graphs work: each connected component contributes one outer
 *   face (skipped) and zero or more interior faces (kept).
 * - Dangling walls (segments with a free endpoint) bound zero rooms; their two
 *   half-edges trace the outer face of their component and are discarded.
 * - Duplicate segments at the same coordinates are collapsed (one face contribution).
 */
export function detectWallRoomFaces(segments: WallSegment[]): WallRoomFace[] {
  if (!segments || segments.length === 0) return []

  const pieces = weldGraphPieceEndpoints(subdivideSegmentsForFaceGraph(segments))
  const pieceById = new Map(pieces.map((p) => [p.id, p]))
  const { halfEdges, byVertex } = buildHalfEdges(pieces)
  if (halfEdges.length === 0) return []

  const visited = new Uint8Array(halfEdges.length)
  const faces: WallRoomFace[] = []

  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue
    const verts: PointM[] = []
    const pieceSegIds: string[] = []
    const pieceDirs: ('ab' | 'ba')[] = []

    let cur = start
    let guard = 0
    const maxSteps = halfEdges.length + 4
    while (!visited[cur]) {
      if (guard++ > maxSteps) {
        // Safety: should never happen on a well-formed planar graph.
        return []
      }
      visited[cur] = 1
      const he = halfEdges[cur]!
      verts.push(keyToPoint(he.from))
      pieceSegIds.push(he.segmentId)
      pieceDirs.push(he.twinIndex === cur + 1 ? 'ab' : 'ba')
      cur = nextHalfEdgeOnFace(cur, halfEdges, byVertex)
    }
    if (cur !== start) {
      // Hit a half-edge already visited by a previous face → skip this partial walk.
      continue
    }
    if (verts.length < 3) continue

    const { segmentIds, edgeDirections } = compressPieceBoundaryToParents(
      pieceSegIds,
      pieceDirs,
      pieceById,
    )
    if (segmentIds.length < 3) continue

    const vertsSan = sanitizePolygonRing(verts, 1e-4)
    if (vertsSan.length < 3) continue

    const area = polygonSignedArea(vertsSan)
    if (area > EPS) {
      // CCW orientation → bounded interior face (room).
      const cycleSignature = [...new Set(segmentIds)].sort().join('|')
      faces.push({
        vertices: vertsSan,
        segmentIds,
        edgeDirections,
        cycleSignature,
        area,
      })
    }
    // area < 0 → CW outer face; area ≈ 0 → degenerate; both discarded.
  }

  // Deterministic order so labels and BOM rollups are stable across rerenders.
  faces.sort((a, b) => {
    if (a.cycleSignature < b.cycleSignature) return -1
    if (a.cycleSignature > b.cycleSignature) return 1
    return 0
  })
  return faces
}

/**
 * For each segment, room faces that lie on the left of directed a→b (`abSideFaces`, wall
 * face `a`) and on the right (`baSideFaces`, wall face `b`). A T-junction can put several
 * distinct rooms on the same geometric side of one segment; each gets its own sheet.
 */
export type SegmentFaceMap = Map<
  string,
  { abSideFaces: WallRoomFace[]; baSideFaces: WallRoomFace[] }
>

export function buildSegmentFaceMap(faces: WallRoomFace[]): SegmentFaceMap {
  const out: SegmentFaceMap = new Map()
  for (const f of faces) {
    for (let i = 0; i < f.segmentIds.length; i++) {
      const segId = f.segmentIds[i]!
      const dir = f.edgeDirections[i]!
      const slot = out.get(segId) ?? { abSideFaces: [], baSideFaces: [] }
      const list = dir === 'ab' ? slot.abSideFaces : slot.baSideFaces
      if (!list.some((x) => x.cycleSignature === f.cycleSignature)) {
        list.push(f)
      }
      out.set(segId, slot)
    }
  }
  return out
}

/** URL-safe slug of a free-form region label, suitable for inclusion in `L0_12_<slug>`. */
export function roomLabelSlug(label: string): string {
  const raw = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return raw.length >= 1 ? raw.slice(0, 32) : 'room'
}
