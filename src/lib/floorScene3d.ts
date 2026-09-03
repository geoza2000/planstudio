import * as THREE from 'three'
import {
  regionIsExternal,
  type EditorSettings,
  type FloorDevice,
  type FloorLevel,
  type FurnitureItem,
  type PlanRegion,
  type PointM,
  type WallMaterial,
} from '../types/project'
import { DEFAULT_CEILING_HEIGHT_M } from './floorDeviceCluster'
import { furnitureDisplayLabel, furnitureSpec } from './furnitureCatalog'
import { pointInPolygon } from './geometry'
import { uniqueOpeningsForSegment } from './planSegmentOpenings'
import { polygonAreaM2, polygonCentroid } from './roomGeometry'
import { makeLabelTexture, sceneTextures } from './scene3dTextures'
import {
  effectiveLowWallHeightM,
  effectiveWallFaceMaterial,
  effectiveWallForm,
  effectiveWallMaterial,
  effectiveWallThicknessM,
} from './wallConstruction'
import { defaultWallHeightMForFloor, segmentLengthM } from './wallPlanSync'
import { deviceFill } from './deviceStyle'

/**
 * Builds a Three.js model of one floor straight from the plan data: walls at true
 * thickness with door / window cut-outs and per-face finishes, floor slabs per room,
 * ceilings, furniture massing per catalog kind, device marks and room labels.
 *
 * World axes: plan `x` → X, plan `y` → Z (so north is −Z), height → Y. Metres throughout.
 */

export type FloorScene3dOptions = {
  showCeilings: boolean
  showFurniture: boolean
  showDevices: boolean
  showRoomLabels: boolean
}

export type Scene3dRoom = {
  id: string
  label: string
  external: boolean
  areaM2: number
  centre: THREE.Vector3
  ceilingM: number
  vertices: PointM[]
}

export type FloorScene3d = {
  group: THREE.Group
  /** Model bounds (walls, slabs and furniture, but not the ground plane). */
  bounds: THREE.Box3
  rooms: Scene3dRoom[]
  dispose(): void
}

const SLAB_THICKNESS_M = 0.15
/** Rooms without walls sheets fall back to this ceiling. */
const FALLBACK_CEILING_M = DEFAULT_CEILING_HEIGHT_M

// ---------------------------------------------------------------------------------------
// Materials (shared, created once)
// ---------------------------------------------------------------------------------------

type Mats = ReturnType<typeof buildMaterials>
let matsCache: Mats | null = null

function std(opts: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...opts })
}

function buildMaterials() {
  const tex = sceneTextures()
  return {
    plaster: std({ map: tex.plaster, color: '#f2eee6' }),
    stone: std({ map: tex.stone, color: '#d9d2c8', roughness: 0.95 }),
    wallCore: std({ color: '#cfc9bf', roughness: 0.9 }),
    wood: std({ map: tex.wood, color: '#e0c7a8', roughness: 0.7 }),
    tile: std({ map: tex.tile, color: '#f4f5f7', roughness: 0.4 }),
    paving: std({ map: tex.paving, color: '#d8d2c6', roughness: 0.95 }),
    concrete: std({ color: '#8f8d88', roughness: 0.95 }),
    ceiling: std({ color: '#f7f5f0', side: THREE.BackSide }),
    glass: new THREE.MeshPhysicalMaterial({
      color: '#bfe0f7',
      transparent: true,
      opacity: 0.32,
      roughness: 0.05,
      metalness: 0,
      transmission: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    frame: std({ color: '#f4f4f1', roughness: 0.5 }),
    doorLeaf: std({ color: '#8a5b3a', roughness: 0.6 }),
    doorFrame: std({ color: '#5a3d2a', roughness: 0.6 }),
    // Furniture palette
    fabric: std({ color: '#6b7fb3', roughness: 1 }),
    fabricOutdoor: std({ color: '#7e8f7c', roughness: 1 }),
    cushion: std({ color: '#d9d2c5', roughness: 1 }),
    linen: std({ color: '#efe9de', roughness: 1 }),
    duvet: std({ color: '#98acc9', roughness: 1 }),
    darkWood: std({ color: '#5c4230', roughness: 0.7 }),
    lightWood: std({ color: '#b48a62', roughness: 0.7 }),
    white: std({ color: '#f3f4f6', roughness: 0.5 }),
    counter: std({ color: '#e7e3dc', roughness: 0.35 }),
    cabinet: std({ color: '#cbc5bb', roughness: 0.8 }),
    cabinetDark: std({ color: '#5d626c', roughness: 0.8 }),
    steel: std({ color: '#c9ced3', roughness: 0.35, metalness: 0.6 }),
    chrome: std({ color: '#e5e8eb', roughness: 0.2, metalness: 0.9 }),
    black: std({ color: '#15181c', roughness: 0.6 }),
    screen: std({ color: '#0d1117', roughness: 0.3, emissive: '#1a2a3d', emissiveIntensity: 0.6 }),
    terracotta: std({ color: '#b3684a', roughness: 0.9 }),
    plant: std({ color: '#4f8447', roughness: 1 }),
    water: std({ color: '#cfe6f2', roughness: 0.1, metalness: 0.1 }),
    ground: std({ color: '#222a35', roughness: 1 }),
  }
}

function mats(): Mats {
  if (!matsCache) matsCache = buildMaterials()
  return matsCache
}

function wallMaterialFor(m: WallMaterial): THREE.MeshStandardMaterial {
  return m === 'rock' ? mats().stone : mats().plaster
}

// ---------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------

/**
 * Box whose UVs are in metres (continuous along `offsetX` / `offsetY`) so the shared wall
 * textures tile at real scale instead of stretching across each face.
 */
function boxWithMeterUvs(
  w: number,
  h: number,
  d: number,
  offsetX = 0,
  offsetY = 0,
): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const nx = Math.abs(nor.getX(i))
    const ny = Math.abs(nor.getY(i))
    if (nx > 0.5) uv.setXY(i, z, y + offsetY)
    else if (ny > 0.5) uv.setXY(i, x + offsetX, z)
    else uv.setXY(i, x + offsetX, y + offsetY)
  }
  uv.needsUpdate = true
  return g
}

class Builder {
  readonly group = new THREE.Group()
  readonly geometries: THREE.BufferGeometry[] = []
  readonly textures: THREE.Texture[] = []
  readonly materials: THREE.Material[] = []
  readonly bounds = new THREE.Box3()

  track<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g)
    return g
  }

  mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    parent: THREE.Object3D = this.group,
    shadows = true,
  ): THREE.Mesh {
    const m = new THREE.Mesh(this.track(geometry), material)
    m.castShadow = shadows
    m.receiveShadow = true
    parent.add(m)
    return m
  }

  box(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    material: THREE.Material | THREE.Material[],
    x = 0,
    y = 0,
    z = 0,
  ): THREE.Mesh {
    const m = this.mesh(new THREE.BoxGeometry(w, h, d), material, parent)
    m.position.set(x, y, z)
    return m
  }

  /** Elliptical cylinder (`w` × `d` footprint, `h` tall) standing on `y`. */
  cyl(
    parent: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    material: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    segments = 32,
  ): THREE.Mesh {
    const m = this.mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, segments), material, parent)
    m.scale.set(w, h, d)
    m.position.set(x, y + h / 2, z)
    return m
  }

  dispose() {
    for (const g of this.geometries) g.dispose()
    for (const t of this.textures) t.dispose()
    for (const m of this.materials) m.dispose()
  }
}

function toShape(vertices: PointM[]): THREE.Shape {
  const s = new THREE.Shape()
  vertices.forEach((v, i) => {
    if (i === 0) s.moveTo(v.x, -v.y)
    else s.lineTo(v.x, -v.y)
  })
  s.closePath()
  return s
}

// ---------------------------------------------------------------------------------------
// Rooms: slabs, ceilings, labels
// ---------------------------------------------------------------------------------------

function roomCeilingM(fl: FloorLevel, region: PlanRegion): number {
  const sheets = fl.wallSheets.filter((w) => w.roomRegionId === region.id)
  const hs = sheets.map((w) => w.heightM).filter((h) => Number.isFinite(h) && h > 0)
  if (hs.length > 0) return Math.max(...hs)
  return defaultWallHeightMForFloor(fl) || FALLBACK_CEILING_M
}

/** Rooms whose name suggests a wet area get tile instead of oak. */
function looksWet(label: string): boolean {
  return /bath|wc|toilet|shower|kitchen|laundry|utility|ensuite|en-suite/i.test(label)
}

function buildRooms(
  b: Builder,
  fl: FloorLevel,
  opts: FloorScene3dOptions,
): Scene3dRoom[] {
  const M = mats()
  const regions = (fl.plan.regions ?? []).filter((r) => r.vertices.length >= 3)
  // Parents first so nested alcoves sit a hair above and never z-fight.
  const ordered = [...regions].sort(
    (a, c) => Number(Boolean(a.parentRegionId)) - Number(Boolean(c.parentRegionId)),
  )
  const rooms: Scene3dRoom[] = []

  for (const region of ordered) {
    const external = regionIsExternal(region)
    const nested = Boolean(region.parentRegionId)
    const shape = toShape(region.vertices)
    const lift = nested ? 0.004 : 0
    const c = polygonCentroid(region.vertices)
    const ceilingM = roomCeilingM(fl, region)

    // Slab
    const slabGeo = new THREE.ExtrudeGeometry(shape, {
      depth: SLAB_THICKNESS_M,
      bevelEnabled: false,
    })
    slabGeo.rotateX(-Math.PI / 2)
    slabGeo.translate(0, -SLAB_THICKNESS_M + lift, 0)
    const topMat = external ? M.paving : looksWet(region.label) ? M.tile : M.wood
    const slab = b.mesh(slabGeo, [topMat, M.concrete])
    slab.castShadow = false
    b.bounds.expandByObject(slab)

    // Ceiling — back-faced so it only shows from inside the room.
    if (opts.showCeilings && !external) {
      const cg = new THREE.ShapeGeometry(shape)
      cg.rotateX(-Math.PI / 2)
      cg.translate(0, ceilingM, 0)
      const ceil = b.mesh(cg, M.ceiling)
      ceil.castShadow = false
    }

    // Label sprite
    if (opts.showRoomLabels) {
      const name = region.label.trim() || 'Room'
      const area = `${Math.round(polygonAreaM2(region.vertices) * 10) / 10} m²${external ? ' · outdoor' : ''}`
      const { texture, aspect } = makeLabelTexture(name, area)
      b.textures.push(texture)
      const sm = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
      b.materials.push(sm)
      const sprite = new THREE.Sprite(sm)
      const h = 0.5
      sprite.scale.set(h * aspect, h, 1)
      // Hung just under the ceiling: readable from above and out of the eye line inside.
      sprite.position.set(c.x, Math.max(1.9, ceilingM - 0.35), c.y)
      sprite.renderOrder = 10
      b.group.add(sprite)
    }

    rooms.push({
      id: region.id,
      label: region.label,
      external,
      areaM2: polygonAreaM2(region.vertices),
      centre: new THREE.Vector3(c.x, 0, c.y),
      ceilingM,
      vertices: region.vertices,
    })
  }

  // No rooms yet: a plain slab under the wall extents keeps the model grounded.
  if (regions.length === 0) {
    const segs = fl.plan.wallSegments ?? []
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const s of segs) {
      for (const p of [s.a, s.b]) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
    }
    if (!Number.isFinite(minX)) {
      minX = 0
      minY = 0
      maxX = fl.plan.widthM
      maxY = fl.plan.depthM
    }
    const g = new THREE.BoxGeometry(maxX - minX, SLAB_THICKNESS_M, maxY - minY)
    const slab = b.mesh(g, M.concrete)
    slab.position.set((minX + maxX) / 2, -SLAB_THICKNESS_M / 2, (minY + maxY) / 2)
    slab.castShadow = false
    b.bounds.expandByObject(slab)
  }

  return rooms
}

// ---------------------------------------------------------------------------------------
// Walls with openings
// ---------------------------------------------------------------------------------------

function buildWalls(b: Builder, fl: FloorLevel, settings: EditorSettings): void {
  const M = mats()
  const segs = fl.plan.wallSegments ?? []
  const fallbackH = defaultWallHeightMForFloor(fl) || FALLBACK_CEILING_M

  for (const seg of segs) {
    const L = segmentLengthM(seg.a, seg.b)
    if (L < 1e-4) continue
    const form = effectiveWallForm(seg)
    // Open boundaries only delimit a space — nothing to build.
    if (form === 'open') continue
    const t = effectiveWallThicknessM(seg, settings)
    const sheets = fl.wallSheets.filter((w) => w.wallSegmentId === seg.id)
    const hs = sheets.map((w) => w.heightM).filter((h) => Number.isFinite(h) && h > 0)
    const fullH = hs.length > 0 ? Math.max(...hs) : fallbackH
    const H = form === 'low' ? Math.min(fullH, effectiveLowWallHeightM(seg)) : fullH

    const base = effectiveWallMaterial(seg, settings)
    const faceMat = (face: 'a' | 'b'): THREE.MeshStandardMaterial => {
      const sheet =
        sheets.find((w) => w.wallFace === face && w.materialOverride) ??
        sheets.find((w) => w.wallFace === face)
      return wallMaterialFor(effectiveWallFaceMaterial(sheet, seg, settings))
    }
    const matA = faceMat('a')
    const matB = faceMat('b')
    const matBase = wallMaterialFor(base)
    // BoxGeometry groups: +x, −x, +y, −y, +z, −z. Local +z is the face left of a→b ('a').
    const pieceMats = [matBase, matBase, M.wallCore, matBase, matA, matB]

    const wall = new THREE.Group()
    const dx = seg.b.x - seg.a.x
    const dz = seg.b.y - seg.a.y
    wall.position.set(seg.a.x, 0, seg.a.y)
    wall.rotation.y = Math.atan2(-dz, dx)
    b.group.add(wall)

    const piece = (x0: number, x1: number, y0: number, y1: number) => {
      const w = x1 - x0
      const h = y1 - y0
      if (w < 1e-3 || h < 1e-3) return
      const g = boxWithMeterUvs(w, h, t, x0 + w / 2, y0 + h / 2)
      const m = b.mesh(g, pieceMats, wall)
      m.position.set(x0 + w / 2, y0 + h / 2, 0)
    }

    const openings = uniqueOpeningsForSegment(fl, seg)
      .map(({ opening, t: u }) => {
        const c = u * L
        const s = Math.max(0, c - opening.widthM / 2)
        const e = Math.min(L, c + opening.widthM / 2)
        const sill = Math.max(0, opening.zM - opening.heightM / 2)
        const top = Math.min(H, opening.zM + opening.heightM / 2)
        return { opening, s, e, sill, top }
      })
      .filter((o) => o.e - o.s > 1e-3 && o.top - o.sill > 1e-3)
      .sort((p, q) => p.s - q.s)

    let cursor = 0
    for (const o of openings) {
      const s = Math.max(cursor, o.s)
      const e = o.e
      if (e <= s) continue
      if (s > cursor) piece(cursor, s, 0, H)
      if (o.sill > 0.005) piece(s, e, 0, o.sill)
      if (o.top < H - 0.005) piece(s, e, o.top, H)

      const w = e - s
      const h = o.top - o.sill
      const cx = s + w / 2
      const cy = o.sill + h / 2
      if (o.opening.kind === 'window') {
        // Glass in the middle of the wall with a slim frame.
        const pane = b.box(wall, w - 0.04, h - 0.04, 0.012, M.glass, cx, cy, 0)
        pane.castShadow = false
        const ft = Math.max(0.04, t * 0.6)
        const fw = 0.05
        b.box(wall, w, fw, ft, M.frame, cx, o.sill + fw / 2, 0)
        b.box(wall, w, fw, ft, M.frame, cx, o.top - fw / 2, 0)
        b.box(wall, fw, h, ft, M.frame, s + fw / 2, cy, 0)
        b.box(wall, fw, h, ft, M.frame, e - fw / 2, cy, 0)
        if (w > 1.3) b.box(wall, 0.035, h, ft * 0.8, M.frame, cx, cy, 0)
      } else {
        // Door: frame + a leaf swung 30° into the 'a' side, hinged on the left jamb.
        const ft = Math.max(0.05, t * 0.8)
        const fw = 0.06
        b.box(wall, fw, h, ft, M.doorFrame, s + fw / 2, cy, 0)
        b.box(wall, fw, h, ft, M.doorFrame, e - fw / 2, cy, 0)
        b.box(wall, w, fw, ft, M.doorFrame, cx, o.top - fw / 2, 0)
        const leafW = w - 2 * fw - 0.01
        const hinge = new THREE.Group()
        hinge.position.set(s + fw + 0.005, o.sill, 0)
        hinge.rotation.y = -Math.PI / 6
        wall.add(hinge)
        b.box(hinge, leafW, h - fw - 0.01, 0.045, M.doorLeaf, leafW / 2, (h - fw) / 2, 0)
        // Handle
        b.box(hinge, 0.02, 0.02, 0.12, M.chrome, leafW - 0.08, 1.0, 0.0)
      }
      cursor = e
    }
    if (cursor < L) piece(cursor, L, 0, H)

    wall.updateMatrixWorld(true)
    b.bounds.expandByObject(wall)
  }
}

// ---------------------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------------------

function seededPick<T>(arr: T[], n: number): T {
  return arr[Math.abs(Math.floor(n)) % arr.length]!
}

function buildFurnitureItem(b: Builder, item: FurnitureItem): THREE.Group {
  const M = mats()
  const spec = furnitureSpec(item.kind)
  const w = Math.max(0.1, item.widthM)
  const d = Math.max(0.1, item.depthM)
  const H = Math.max(0.05, item.heightM || spec.heightM)
  const g = new THREE.Group()
  g.position.set(item.x, 0, item.y)
  g.rotation.y = (-item.rotationDeg * Math.PI) / 180
  const outdoor = spec.category === 'outdoor'
  const fabric = outdoor ? M.fabricOutdoor : M.fabric
  const wood = outdoor ? M.darkWood : M.lightWood

  const table = (topMat: THREE.Material, legMat: THREE.Material) => {
    const tt = 0.04
    b.box(g, w, tt, d, topMat, 0, H - tt / 2, 0)
    const leg = 0.05
    const legH = H - tt
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        b.box(g, leg, legH, leg, legMat, sx * (w / 2 - leg), legH / 2, sz * (d / 2 - leg))
  }

  const seat = (hasArms: boolean) => {
    const seatH = H * 0.55
    b.box(g, w, seatH, d, fabric, 0, seatH / 2, 0)
    const backD = Math.min(0.22, d * 0.3)
    b.box(g, w, H, backD, fabric, 0, H / 2, -d / 2 + backD / 2)
    // Seat cushions
    const n = Math.max(1, Math.round(w / 0.75))
    const cw = (w - (hasArms ? 0.3 : 0)) / n
    for (let i = 0; i < n; i++) {
      b.box(
        g,
        cw - 0.04,
        0.08,
        d - backD - 0.06,
        M.cushion,
        -w / 2 + (hasArms ? 0.15 : 0) + cw * (i + 0.5),
        seatH + 0.04,
        backD / 2 + 0.02,
      )
    }
    if (hasArms) {
      for (const sx of [-1, 1]) b.box(g, 0.15, H * 0.78, d, fabric, sx * (w / 2 - 0.075), (H * 0.78) / 2, 0)
    }
  }

  switch (item.kind) {
    case 'sofa':
    case 'armchair':
      seat(true)
      break
    case 'sofa_l':
    case 'outdoor_sofa_l': {
      // Footprint minus a notch at the +X / +Z corner (matches the plan glyph).
      const notchW = w * 0.55
      const notchD = d * 0.5
      const seatH = H * 0.55
      const mainD = d - notchD
      b.box(g, w, seatH, mainD, fabric, 0, seatH / 2, -d / 2 + mainD / 2)
      const chaiseW = w - notchW
      b.box(g, chaiseW, seatH, notchD, fabric, -w / 2 + chaiseW / 2, seatH / 2, d / 2 - notchD / 2)
      const backD = Math.min(0.22, mainD * 0.35)
      b.box(g, w, H, backD, fabric, 0, H / 2, -d / 2 + backD / 2)
      b.box(g, 0.2, H, d, fabric, -w / 2 + 0.1, H / 2, 0)
      // Cushions along the main run and on the chaise
      const n = Math.max(1, Math.round((w - 0.2) / 0.8))
      const cw = (w - 0.2) / n
      for (let i = 0; i < n; i++)
        b.box(g, cw - 0.04, 0.08, mainD - backD - 0.06, M.cushion, -w / 2 + 0.2 + cw * (i + 0.5), seatH + 0.04, -d / 2 + backD + (mainD - backD) / 2)
      b.box(g, chaiseW - 0.24, 0.08, notchD - 0.06, M.cushion, -w / 2 + 0.2 + (chaiseW - 0.2) / 2, seatH + 0.04, d / 2 - notchD / 2)
      break
    }
    case 'bed_double':
    case 'bed_single': {
      const frameH = 0.28
      b.box(g, w, frameH, d, wood, 0, frameH / 2, 0)
      const mattH = 0.22
      b.box(g, w - 0.06, mattH, d - 0.1, M.linen, 0, frameH + mattH / 2, 0.04)
      b.box(g, w, H, 0.06, wood, 0, H / 2, -d / 2 + 0.03)
      const top = frameH + mattH
      const pillows = item.kind === 'bed_double' ? [-w / 4, w / 4] : [0]
      for (const px of pillows) b.box(g, Math.min(0.6, w * 0.4), 0.1, 0.38, M.white, px, top + 0.05, -d / 2 + 0.32)
      const duvD = d * 0.58
      b.box(g, w - 0.1, 0.06, duvD, M.duvet, 0, top + 0.03, d / 2 - duvD / 2 - 0.05)
      break
    }
    case 'dining_table':
    case 'coffee_table':
    case 'desk':
      table(wood, wood)
      break
    case 'outdoor_dining':
      table(M.darkWood, M.black)
      break
    case 'chair': {
      const seatH = Math.min(0.45, H * 0.5)
      b.box(g, w, 0.04, d, wood, 0, seatH, 0)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) b.box(g, 0.03, seatH, 0.03, wood, sx * (w / 2 - 0.03), seatH / 2, sz * (d / 2 - 0.03))
      b.box(g, w, H - seatH, 0.03, wood, 0, seatH + (H - seatH) / 2, -d / 2 + 0.015)
      break
    }
    case 'tv_table': {
      b.box(g, w, H, d, M.darkWood, 0, H / 2, 0)
      const tvW = Math.min(w * 0.8, 1.6)
      const tvH = (tvW * 9) / 16
      b.box(g, tvW, tvH, 0.03, M.screen, 0, H + 0.2 + tvH / 2, -d / 2 - 0.02)
      break
    }
    case 'bookshelf': {
      b.box(g, 0.03, H, d, wood, -w / 2 + 0.015, H / 2, 0)
      b.box(g, 0.03, H, d, wood, w / 2 - 0.015, H / 2, 0)
      b.box(g, w, H, 0.02, wood, 0, H / 2, -d / 2 + 0.01)
      const shelves = Math.max(2, Math.floor(H / 0.35))
      const gap = H / shelves
      const bookMats = [M.fabric, M.terracotta, M.duvet, M.cabinetDark, M.plant, M.darkWood]
      for (let i = 0; i <= shelves; i++) {
        const y = Math.min(H - 0.0125, i * gap)
        b.box(g, w, 0.025, d, wood, 0, y, 0)
        if (i < shelves) {
          let x = -w / 2 + 0.05
          let k = 0
          while (x < w / 2 - 0.1) {
            const bw = 0.03 + ((i * 7 + k * 3) % 5) * 0.008
            const bh = Math.min(gap - 0.06, 0.18 + ((i * 5 + k * 11) % 4) * 0.025)
            b.box(g, bw, bh, d * 0.7, seededPick(bookMats, i * 13 + k * 7), x + bw / 2, y + 0.0125 + bh / 2, -d * 0.1)
            x += bw + 0.006
            k++
            if (k % 6 === 5) x += 0.08
          }
        }
      }
      break
    }
    case 'wardrobe': {
      b.box(g, w, H, d, wood, 0, H / 2, 0)
      b.box(g, 0.012, H - 0.1, 0.006, M.darkWood, 0, H / 2, d / 2 + 0.003)
      for (const sx of [-1, 1]) b.box(g, 0.02, 0.14, 0.02, M.chrome, sx * 0.05, H / 2, d / 2 + 0.015)
      break
    }
    case 'nightstand':
      b.box(g, w, H, d, wood, 0, H / 2, 0)
      b.box(g, w * 0.4, 0.02, 0.02, M.chrome, 0, H * 0.65, d / 2 + 0.01)
      break
    case 'kitchen_counter':
    case 'kitchen_island': {
      const cab = item.kind === 'kitchen_island' ? M.cabinetDark : M.cabinet
      const ct = 0.04
      b.box(g, w, H - ct, d, cab, 0, (H - ct) / 2, 0)
      b.box(g, w + 0.03, ct, d + 0.03, M.counter, 0, H - ct / 2, 0)
      // Drawer / door seams on the front face
      const doors = Math.max(1, Math.round(w / 0.6))
      for (let i = 1; i < doors; i++) b.box(g, 0.008, H - ct - 0.1, 0.004, M.cabinetDark, -w / 2 + (w / doors) * i, (H - ct) / 2, d / 2 + 0.002)
      break
    }
    case 'fridge':
      b.box(g, w, H, d, M.steel, 0, H / 2, 0)
      b.box(g, w, 0.01, 0.006, M.black, 0, H * 0.7, d / 2 + 0.003)
      b.box(g, 0.02, 0.3, 0.02, M.chrome, w / 2 - 0.08, H * 0.55, d / 2 + 0.012)
      break
    case 'washing_machine': {
      b.box(g, w, H, d, M.white, 0, H / 2, 0)
      const drum = b.mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 32), M.black, g)
      drum.rotation.x = Math.PI / 2
      drum.position.set(0, H * 0.5, d / 2 + 0.01)
      break
    }
    case 'shower_glass': {
      b.box(g, w, 0.05, d, M.white, 0, 0.025, 0)
      const gm = M.glass
      const panes: [number, number, number, number, number][] = [
        [w, H, 0.01, 0, d / 2],
        [w, H, 0.01, 0, -d / 2],
        [0.01, H, d, w / 2, 0],
        [0.01, H, d, -w / 2, 0],
      ]
      for (const [pw, ph, pd, px, pz] of panes) {
        const p = b.box(g, pw, ph, pd, gm, px, 0.05 + ph / 2, pz)
        p.castShadow = false
      }
      b.box(g, w, 0.02, 0.02, M.chrome, 0, H + 0.04, d / 2)
      // Shower head
      b.box(g, 0.02, 0.4, 0.02, M.chrome, 0, H - 0.2, -d / 2 + 0.05)
      b.cyl(g, 0.2, 0.015, 0.2, M.chrome, 0, H - 0.04, -d / 2 + 0.15, 24)
      break
    }
    case 'toilet_inwall': {
      b.box(g, w, 1.0, Math.min(0.2, d * 0.35), M.tile, 0, 0.5, -d / 2 + Math.min(0.2, d * 0.35) / 2)
      const bowlD = d * 0.65
      b.cyl(g, w * 0.7, 0.34, bowlD, M.white, 0, 0.08, d / 2 - bowlD / 2, 32)
      b.cyl(g, w * 0.74, 0.03, bowlD * 1.04, M.white, 0, 0.42, d / 2 - bowlD / 2, 32)
      b.box(g, 0.15, 0.06, 0.02, M.chrome, 0, 0.95, -d / 2 + Math.min(0.2, d * 0.35) + 0.005)
      break
    }
    case 'sink_combo': {
      const ct = 0.04
      b.box(g, w, H - ct - 0.1, d, wood, 0, (H - ct - 0.1) / 2 + 0.1, 0)
      b.box(g, w + 0.02, ct, d + 0.02, M.counter, 0, H - ct / 2, 0)
      b.cyl(g, Math.min(w * 0.55, 0.5), 0.1, Math.min(d * 0.65, 0.4), M.white, 0, H, 0.02, 32)
      b.box(g, 0.02, 0.18, 0.02, M.chrome, 0, H + 0.09, -d / 2 + 0.08)
      b.box(g, 0.02, 0.02, 0.12, M.chrome, 0, H + 0.18, -d / 2 + 0.13)
      break
    }
    case 'bathtub': {
      b.cyl(g, w, H, d, M.white, 0, 0, 0, 40)
      b.cyl(g, w * 0.82, 0.02, d * 0.78, M.water, 0, H - 0.03, 0, 40)
      break
    }
    case 'sun_lounger': {
      const legH = 0.3
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) b.box(g, 0.03, legH, 0.03, M.black, sx * (w / 2 - 0.05), legH / 2, sz * (d / 2 - 0.05))
      b.box(g, w, 0.08, d, fabric, 0, legH + 0.04, 0)
      const back = b.box(g, w * 0.3, 0.06, d * 0.92, fabric, 0, 0, 0)
      back.rotation.z = -0.7
      back.position.set(-w / 2 + w * 0.15 + 0.05, legH + 0.06 + w * 0.15 * 0.64, 0)
      break
    }
    case 'bbq': {
      const bodyH = H * 0.4
      b.box(g, w, bodyH, d, M.black, 0, H - bodyH / 2 - H * 0.12, 0)
      b.box(g, w, H * 0.12, d, M.steel, 0, H - H * 0.06, 0)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) b.box(g, 0.03, H - bodyH - H * 0.12, 0.03, M.black, sx * (w / 2 - 0.04), (H - bodyH - H * 0.12) / 2, sz * (d / 2 - 0.04))
      break
    }
    case 'planter': {
      b.cyl(g, w, H, d, M.terracotta, 0, 0, 0, 32)
      const ball = b.mesh(new THREE.SphereGeometry(0.5, 20, 14), M.plant, g)
      ball.scale.set(w * 0.95, Math.max(0.3, w * 0.7), d * 0.95)
      ball.position.set(0, H + Math.max(0.3, w * 0.7) * 0.4, 0)
      break
    }
    default: {
      if (spec.glyph === 'round') b.cyl(g, w, H, d, wood, 0, 0, 0, 32)
      else b.box(g, w, H, d, wood, 0, H / 2, 0)
    }
  }

  g.name = furnitureDisplayLabel(item)
  return g
}

function buildFurniture(b: Builder, fl: FloorLevel): void {
  for (const item of fl.plan.furniture ?? []) {
    const g = buildFurnitureItem(b, item)
    b.group.add(g)
    g.updateMatrixWorld(true)
    b.bounds.expandByObject(g)
  }
}

// ---------------------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------------------

function deviceHeightM(fl: FloorLevel, d: FloorDevice, rooms: Scene3dRoom[]): number {
  const mounting = d.mounting ?? 'ceiling'
  if (mounting === 'ceiling') {
    if (Number.isFinite(d.ceilingHeightM) && (d.ceilingHeightM ?? 0) > 0) return d.ceilingHeightM!
    const room = rooms.find((r) => pointInPolygon({ x: d.x, y: d.y }, r.vertices))
    return (room?.ceilingM ?? FALLBACK_CEILING_M) - 0.02
  }
  if (mounting === 'wall') {
    if (d.linkedWallDeviceId) {
      for (const ws of fl.wallSheets) {
        const wd = ws.devices.find((x) => x.id === d.linkedWallDeviceId)
        if (wd) return wd.zM
      }
    }
    return d.type === 'switch' ? 1.1 : 0.3
  }
  return 0.03
}

function buildDevices(b: Builder, fl: FloorLevel, rooms: Scene3dRoom[]): void {
  const matByType = new Map<string, THREE.MeshStandardMaterial>()
  for (const d of fl.plan.devices ?? []) {
    let m = matByType.get(d.type)
    if (!m) {
      const color = deviceFill(d.type)
      m = std({
        color,
        emissive: d.type === 'light' ? '#ffe7b3' : color,
        emissiveIntensity: d.type === 'light' ? 1.4 : 0.35,
        roughness: 0.5,
      })
      b.materials.push(m)
      matByType.set(d.type, m)
    }
    const y = deviceHeightM(fl, d, rooms)
    const mounting = d.mounting ?? 'ceiling'
    const r = d.type === 'light' ? 0.09 : 0.045
    const mesh = b.mesh(new THREE.CylinderGeometry(r, r, 0.025, 20), m, b.group, false)
    mesh.position.set(d.x, mounting === 'ceiling' ? y - 0.0125 : y, d.y)
    if (mounting === 'wall') mesh.rotation.x = Math.PI / 2
  }
}

// ---------------------------------------------------------------------------------------

export function buildFloorScene3d(
  fl: FloorLevel,
  settings: EditorSettings,
  opts: FloorScene3dOptions,
): FloorScene3d {
  const b = new Builder()
  const rooms = buildRooms(b, fl, opts)
  buildWalls(b, fl, settings)
  if (opts.showFurniture) buildFurniture(b, fl)
  if (opts.showDevices) buildDevices(b, fl, rooms)

  if (b.bounds.isEmpty()) {
    b.bounds.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(fl.plan.widthM, 3, fl.plan.depthM))
  }

  return {
    group: b.group,
    bounds: b.bounds,
    rooms,
    dispose: () => b.dispose(),
  }
}

/** Ground plane + subtle grid sized to the model; separate so it can persist across rebuilds. */
export function buildGround(bounds: THREE.Box3): { group: THREE.Group; dispose(): void } {
  const M = mats()
  const size = new THREE.Vector3()
  bounds.getSize(size)
  const centre = new THREE.Vector3()
  bounds.getCenter(centre)
  const extent = Math.max(size.x, size.z, 6) * 6
  const group = new THREE.Group()
  const geo = new THREE.PlaneGeometry(extent, extent)
  const ground = new THREE.Mesh(geo, M.ground)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(centre.x, -SLAB_THICKNESS_M - 0.002, centre.z)
  ground.receiveShadow = true
  group.add(ground)
  const grid = new THREE.GridHelper(extent, Math.round(extent), '#3a4553', '#2b3441')
  grid.position.set(centre.x, -SLAB_THICKNESS_M + 0.001, centre.z)
  const gm = grid.material as THREE.Material
  gm.transparent = true
  gm.opacity = 0.35
  group.add(grid)
  return {
    group,
    dispose: () => {
      geo.dispose()
      grid.geometry.dispose()
      gm.dispose()
    },
  }
}

