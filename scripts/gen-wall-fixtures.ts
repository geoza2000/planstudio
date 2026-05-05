/**
 * Generates `fixtures/wall-topology/*.json` projects you can open in Planstudio to
 * inspect wall / room behaviour. Run: `npx tsx scripts/gen-wall-fixtures.ts`
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInitialProject } from '../src/model/defaults'
import { normalizeProject } from '../src/lib/projectLoad'
import type { WallSegment } from '../src/types/project'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'fixtures', 'wall-topology')
mkdirSync(outDir, { recursive: true })

function seg(id: string, ax: number, ay: number, bx: number, by: number): WallSegment {
  return { id, a: { x: ax, y: ay }, b: { x: bx, y: by } }
}

function baseProject(name: string) {
  const p = createInitialProject()
  p.name = name
  p.floors = [p.floors[0]!]
  const g = p.floors[0]!
  g.label = 'Test floor'
  g.plan.label = 'Plan'
  g.plan.widthM = 8
  g.plan.depthM = 6
  g.plan.wallSegments = []
  g.plan.regions = []
  g.plan.devices = []
  g.wallSheets = []
  return p
}

/** One rectangular room (4 walls). */
const simpleSquare = baseProject('Fixture: simple square')
simpleSquare.floors[0]!.plan.wallSegments = [
  seg('w-bottom', 0, 0, 4, 0),
  seg('w-right', 4, 0, 4, 3),
  seg('w-top', 4, 3, 0, 3),
  seg('w-left', 0, 3, 0, 0),
]

/** L-shaped interior in bottom-right; T-junction on bottom + right until load runs split. */
const cornerPocketUnsplit = baseProject('Fixture: corner pocket (T-junction on load)')
cornerPocketUnsplit.floors[0]!.plan.wallSegments = [
  seg('left', 0, 0, 0, 3),
  seg('top', 0, 3, 4, 3),
  seg('right', 4, 3, 4, 0),
  seg('b-left', 0, 0, 2, 0),
  seg('b-right', 2, 0, 4, 0),
  seg('v-in', 2, 0, 2, 1),
  seg('h-in', 2, 1, 4, 1),
]

/** Same geometry as corner pocket but walls already split at every junction (no T work). */
const cornerPocketPresplit = baseProject('Fixture: corner pocket (pre-split graph)')
cornerPocketPresplit.floors[0]!.plan.wallSegments = [
  seg('left', 0, 0, 0, 3),
  seg('top', 0, 3, 4, 3),
  seg('r-up', 4, 3, 4, 1),
  seg('r-lo', 4, 1, 4, 0),
  seg('b-left', 0, 0, 2, 0),
  seg('b-right', 2, 0, 4, 0),
  seg('v-in', 2, 0, 2, 1),
  seg('h-in', 2, 1, 4, 1),
]

/** Two equal rectangles sharing one vertical partition (two rooms + one shared wall). */
const twoRoomsShared = baseProject('Fixture: two rooms + shared wall')
twoRoomsShared.floors[0]!.plan.wallSegments = [
  seg('outer-bottom', 0, 0, 4, 0),
  seg('outer-right', 4, 0, 4, 2),
  seg('outer-top', 4, 2, 0, 2),
  seg('outer-left', 0, 2, 0, 0),
  seg('partition', 2, 0, 2, 2),
]

const fixtures: { file: string; project: ReturnType<typeof baseProject> }[] = [
  { file: 'simple-square.json', project: simpleSquare },
  { file: 'corner-pocket-unsplit.json', project: cornerPocketUnsplit },
  { file: 'corner-pocket-presplit.json', project: cornerPocketPresplit },
  { file: 'two-rooms-shared-partition.json', project: twoRoomsShared },
]

for (const { file, project } of fixtures) {
  const normalized = normalizeProject(project)
  const text = JSON.stringify(normalized, null, 2)
  writeFileSync(join(outDir, file), `${text}\n`, 'utf8')
  console.log('wrote', join('fixtures/wall-topology', file))
}
