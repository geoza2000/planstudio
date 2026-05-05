/**
 * Loads each JSON in `fixtures/wall-topology/` the same way the app does (normalize +
 * topology reconcile) and prints auto-room counts. Run: `npx tsx scripts/validate-wall-fixtures.ts`
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeProject } from '../src/lib/projectLoad'
import { reconcileAllFloorsWallTopology } from '../src/lib/wallRoomReconcile'
import { syncAllPlanWallSheetLabels } from '../src/lib/wallPlanSync'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dir = join(__dirname, '..', 'fixtures', 'wall-topology')

const expected: Record<string, { autoRooms: number; minWallSheets: number }> = {
  'simple-square.json': { autoRooms: 1, minWallSheets: 4 },
  'corner-pocket-unsplit.json': { autoRooms: 2, minWallSheets: 10 },
  'corner-pocket-presplit.json': { autoRooms: 2, minWallSheets: 10 },
  'two-rooms-shared-partition.json': { autoRooms: 2, minWallSheets: 8 },
}

let exit = 0
for (const name of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const raw = JSON.parse(readFileSync(join(dir, name), 'utf8'))
  let p = normalizeProject(raw)
  p = { ...p, floors: reconcileAllFloorsWallTopology(p.floors) }
  p = syncAllPlanWallSheetLabels(p)
  const fl = p.floors[0]!
  const autoRooms = fl.plan.regions.filter((r) => r.kind === 'room' && r.wallCycleSignature)
  const sheets = fl.wallSheets.length
  const exp = expected[name]
  console.log(
    `${name}\tauto-rooms=${autoRooms.length}\tsheets=${sheets}\t` +
      autoRooms.map((r) => `${r.label}(${r.vertices.length}v)`).join('; '),
  )
  if (exp) {
    if (autoRooms.length !== exp.autoRooms) {
      console.error(`  FAIL expected ${exp.autoRooms} auto-rooms`)
      exit = 1
    }
    if (sheets < exp.minWallSheets) {
      console.error(`  FAIL expected at least ${exp.minWallSheets} wall sheets`)
      exit = 1
    }
  }
}
process.exit(exit)
