import type { RackGear } from '../types/project'

export function clampRackGear(
  totalRU: number,
  g: Pick<RackGear, 'startRU' | 'heightRU'>,
): { startRU: number; heightRU: number } {
  const heightRU = Math.max(
    1,
    Math.min(totalRU, Math.max(1, Math.floor(Number(g.heightRU)) || 1)),
  )
  const maxStart = Math.max(1, totalRU - heightRU + 1)
  const startRU = Math.max(
    1,
    Math.min(maxStart, Math.max(1, Math.floor(Number(g.startRU)) || 1)),
  )
  return { startRU, heightRU }
}

export function normalizeRackGearList(gear: RackGear[], totalRU: number): RackGear[] {
  return gear.map((g) => {
    const c = clampRackGear(totalRU, g)
    return { ...g, ...c }
  })
}

/** Bottom-based RU: y increases downward; `bottomY` is the bottom of RU 1. */
export function gearYTopFromStartRu(
  bottomY: number,
  ruPx: number,
  startRU: number,
  heightRU: number,
): number {
  return bottomY - (startRU - 1 + heightRU) * ruPx
}

export function startRuFromYTop(
  bottomY: number,
  ruPx: number,
  yTop: number,
  heightRU: number,
  totalRU: number,
): number {
  const raw = Math.round((bottomY - yTop) / ruPx) - heightRU + 1
  const maxStart = Math.max(1, totalRU - heightRU + 1)
  return Math.max(1, Math.min(maxStart, raw))
}

/** RU indices (bottom-based) occupied by mounted gear. */
export function occupiedRuSet(gear: RackGear[]): Set<number> {
  const s = new Set<number>()
  for (const g of gear) {
    const h = Math.max(1, Math.floor(g.heightRU) || 1)
    const start = Math.max(1, Math.floor(g.startRU) || 1)
    for (let i = 0; i < h; i++) s.add(start + i)
  }
  return s
}

/** Lowest bottom-based `startRU` that fits `heightRU` without overlapping existing gear, or `null` if the rack is full. */
export function findNextFreeRackStartRu(
  gear: RackGear[],
  totalRU: number,
  heightRU: number,
): number | null {
  const occ = occupiedRuSet(gear)
  const h = Math.max(1, Math.min(totalRU, Math.floor(heightRU) || 1))
  const maxStart = Math.max(1, totalRU - h + 1)
  for (let start = 1; start <= maxStart; start++) {
    let fits = true
    for (let i = 0; i < h; i++) {
      if (occ.has(start + i)) {
        fits = false
        break
      }
    }
    if (fits) return start
  }
  return null
}

/** True if `startRU`..`startRU+heightRU-1` are in range and not in `occupied`. */
export function rackSlotIsFree(
  occupied: Set<number>,
  totalRU: number,
  startRU: number,
  heightRU: number,
): boolean {
  const h = Math.max(1, Math.min(totalRU, Math.floor(heightRU) || 1))
  const maxStart = Math.max(1, totalRU - h + 1)
  if (startRU < 1 || startRU > maxStart) return false
  for (let i = 0; i < h; i++) {
    if (occupied.has(startRU + i)) return false
  }
  return true
}
