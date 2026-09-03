/**
 * Generates `fixtures/demo-house.json`: a furnished five-room flat with a terrace, doors,
 * windows and devices — handy for eyeballing the 3D preview and the render prompt.
 * Run: `npx tsx scripts/gen-demo-house.ts`
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import { createInitialProject } from '../src/model/defaults'
import { normalizeProject } from '../src/lib/projectLoad'
import { reconcileFloorWallTopology } from '../src/lib/wallRoomReconcile'
import { createFurnitureItem } from '../src/lib/furnitureCatalog'
import { openingXMFromPlanAlongSeg01 } from '../src/lib/wallOpeningAlongSegment'
import { pointInPolygon } from '../src/lib/geometry'
import { syncFloorDeviceWithTemplate } from '../src/lib/deviceCatalogInstanceSync'
import type {
  DeviceTemplate,
  DeviceType,
  FloorDevice,
  FurnitureKind,
  WallOpeningKind,
  WallSegment,
} from '../src/types/project'

const __dirname = dirname(fileURLToPath(import.meta.url))

function seg(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thicknessM = 0.1,
  material: 'painted' | 'rock' = 'painted',
): WallSegment {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thicknessM, material }
}

const p = createInitialProject()
p.name = 'Demo house'
p.floors = [p.floors[0]!]
const fl = p.floors[0]!
fl.label = 'Ground'
fl.plan.widthM = 15
fl.plan.depthM = 8
fl.plan.regions = []
fl.plan.devices = []
fl.wallSheets = []

const OUT = 0.25
fl.plan.wallSegments = [
  seg('n-living', 0, 0, 6, 0, OUT, 'rock'),
  seg('n-kitchen', 6, 0, 10, 0, OUT),
  { ...seg('n-terrace', 10, 0, 14, 0, 0.2, 'rock'), form: 'low', lowHeightM: 1.0 },
  seg('m-bed', 0, 4, 4, 4),
  seg('m-bath', 4, 4, 6, 4),
  seg('m-hall', 6, 4, 10, 4),
  { ...seg('s-terrace', 10, 4, 14, 4, 0.2), form: 'open' },
  seg('s-bed', 0, 7, 4, 7, OUT),
  seg('s-bath', 4, 7, 6, 7, OUT),
  seg('s-hall', 6, 7, 10, 7, OUT),
  seg('w-living', 0, 0, 0, 4, OUT),
  seg('w-bed', 0, 4, 0, 7, OUT),
  seg('p-bath', 4, 4, 4, 7),
  seg('p-kitchen', 6, 0, 6, 4),
  seg('p-hall', 6, 4, 6, 7),
  seg('e-kitchen', 10, 0, 10, 4, OUT),
  seg('e-hall', 10, 4, 10, 7, OUT),
  { ...seg('e-terrace', 14, 0, 14, 4, 0.2, 'rock'), form: 'low', lowHeightM: 1.0 },
]

p.floors[0] = reconcileFloorWallTopology(fl, p.floors)
const floor = p.floors[0]!

for (const ws of floor.wallSheets) ws.heightM = 2.7

// Room names by a point inside each auto-room.
const names: [number, number, string, boolean][] = [
  [3, 2, 'Living room', false],
  [8, 2, 'Kitchen', false],
  [2, 5.5, 'Bedroom', false],
  [5, 5.5, 'Bathroom', false],
  [8, 5.5, 'Hall', false],
  [12, 2, 'Terrace', true],
]
for (const r of floor.plan.regions) {
  const hit = names.find(([x, y]) => pointInPolygon({ x, y }, r.vertices))
  if (hit) {
    r.label = hit[2]
    if (hit[3]) r.isExternal = true
  }
}

function opening(segId: string, t: number, kind: WallOpeningKind, widthM: number, heightM: number, zM: number, label?: string) {
  const id = nanoid()
  for (const ws of floor.wallSheets) {
    if (ws.wallSegmentId !== segId) continue
    ws.openings.push({
      id,
      kind,
      xM: openingXMFromPlanAlongSeg01(floor, ws, t),
      zM,
      widthM,
      heightM,
      label,
      planAlongSeg01: t,
    })
  }
}

opening('n-living', 0.5, 'window', 2.4, 1.4, 1.5, 'Picture window')
opening('w-living', 0.5, 'window', 1.2, 1.3, 1.55)
opening('n-kitchen', 0.5, 'window', 1.6, 1.2, 1.6)
opening('e-kitchen', 0.5, 'door', 1.8, 2.2, 1.1, 'Sliding door')
opening('p-kitchen', 0.6, 'door', 1.4, 2.2, 1.1)
opening('m-bed', 0.75, 'door', 0.9, 2.1, 1.05)
opening('m-bath', 0.5, 'door', 0.8, 2.1, 1.05)
opening('m-hall', 0.5, 'door', 0.9, 2.1, 1.05)
opening('s-hall', 0.5, 'door', 1.0, 2.1, 1.05, 'Entrance')
opening('s-bed', 0.5, 'window', 1.6, 1.3, 1.55)
opening('s-bath', 0.5, 'window', 0.6, 0.6, 1.9)

function furn(kind: FurnitureKind, x: number, y: number, rotationDeg = 0, widthM?: number, depthM?: number, label?: string) {
  const it = createFurnitureItem(nanoid(), kind, x, y)
  it.rotationDeg = rotationDeg
  if (widthM) it.widthM = widthM
  if (depthM) it.depthM = depthM
  if (label) it.label = label
  const room = floor.plan.regions.find((r) => pointInPolygon({ x, y }, r.vertices))
  if (room) it.roomRegionId = room.id
  floor.plan.furniture.push(it)
}

// Living
furn('sofa_l', 2.2, 2.6, 0, 2.8, 2.1)
furn('coffee_table', 1.8, 1.0, 0, 1.1, 0.6)
furn('tv_table', 4.8, 0.45, 0, 1.8, 0.45)
furn('armchair', 5.3, 2.6, 270, 0.85, 0.85)
furn('bookshelf', 0.3, 2.2, 270, 1.4, 0.35)
// Kitchen
furn('kitchen_counter', 7.65, 0.45, 0, 2.8, 0.6)
furn('fridge', 9.5, 0.5, 0, 0.7, 0.7)
furn('kitchen_island', 8, 1.7, 0, 1.6, 0.9)
furn('dining_table', 8, 3.0, 0, 1.6, 0.9)
furn('chair', 7.2, 3.0, 90, 0.45, 0.45)
furn('chair', 8.8, 3.0, 270, 0.45, 0.45)
furn('chair', 8, 3.65, 180, 0.45, 0.45)
// Bedroom
furn('bed_double', 2, 5.85, 180, 1.6, 2.0)
furn('nightstand', 0.85, 6.5, 180, 0.45, 0.4)
furn('nightstand', 3.15, 6.5, 180, 0.45, 0.4)
furn('wardrobe', 1.2, 4.4, 0, 1.8, 0.6)
furn('desk', 3.3, 4.6, 0, 1.1, 0.55)
// Bathroom
furn('shower_glass', 5.5, 6.4, 0, 0.9, 0.9)
furn('toilet_inwall', 4.5, 6.5, 180, 0.4, 0.7)
furn('sink_combo', 4.55, 4.5, 0, 0.8, 0.5)
// Hall
furn('washing_machine', 9.5, 6.5, 180, 0.6, 0.6)
// Terrace
furn('outdoor_sofa_l', 11.6, 1.6, 0, 2.6, 2.0)
furn('outdoor_dining', 12.5, 3.0, 0, 1.6, 0.9)
furn('sun_lounger', 13.4, 1.2, 90, 1.9, 0.7)
furn('bbq', 10.6, 3.5, 0, 0.6, 0.5)
furn('planter', 13.6, 3.5, 0, 0.5, 0.5)

const templates = new Map<DeviceType, DeviceTemplate>()
function template(type: DeviceType): DeviceTemplate {
  let t = templates.get(type)
  if (!t) {
    t = {
      id: nanoid(),
      displayName: type.replace('_', ' '),
      type,
      mounting: 'both',
      productName: `Generic ${type.replace('_', ' ')}`,
      unitPrice: 0,
      billCategory: 'standard',
    }
    templates.set(type, t)
    p.deviceCatalog.push(t)
  }
  return t
}

function dev(type: DeviceType, x: number, y: number, mounting: FloorDevice['mounting'], label = ''): void {
  const t = template(type)
  const base: FloorDevice = {
    id: nanoid(),
    type,
    label,
    x,
    y,
    circuitRef: '',
    productName: t.productName,
    unitPrice: 0,
    billCategory: 'standard',
    templateId: t.id,
    mounting,
    ceilingHeightM: mounting === 'ceiling' ? 2.7 : undefined,
  }
  floor.plan.devices.push(syncFloorDeviceWithTemplate(base, t))
}
dev('light', 3, 2, 'ceiling', 'Living pendant')
dev('light', 5, 1, 'ceiling')
dev('light', 8, 2, 'ceiling')
dev('light', 2, 5.5, 'ceiling')
dev('light', 5, 5.5, 'ceiling')
dev('light', 8, 5.5, 'ceiling')
dev('switch', 3.4, 3.8, 'wall')
dev('switch', 6.2, 1.2, 'wall')
dev('outlet', 4.8, 0.2, 'wall')
dev('outlet', 0.2, 6.5, 'wall')
dev('motion_sensor', 8, 4.3, 'ceiling')
dev('camera', 13.8, 0.2, 'wall')

p.floors[0] = reconcileFloorWallTopology(floor, p.floors)
p.updatedAt = new Date().toISOString()
const out = join(__dirname, '..', 'fixtures', 'demo-house.json')
writeFileSync(out, JSON.stringify(normalizeProject(JSON.parse(JSON.stringify(p))), null, 2))
console.log('wrote', out)
