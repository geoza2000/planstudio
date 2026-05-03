import type { RackGear, RackPortEndpoint, RackPortLink } from '../types/project'

const MAX_PORTS_PER_KIND = 48

export function normalizeRackPortCount(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0
  return Math.max(0, Math.min(MAX_PORTS_PER_KIND, n))
}

export function portEndpointValid(gear: RackGear[], e: RackPortEndpoint): boolean {
  const g = gear.find((x) => x.id === e.gearId)
  if (!g) return false
  if (e.portKind !== 'rj45' && e.portKind !== 'sfp') return false
  const cap =
    e.portKind === 'rj45'
      ? normalizeRackPortCount(g.rj45PortCount)
      : normalizeRackPortCount(g.sfpPortCount)
  const idx = Math.floor(Number(e.portIndex))
  return Number.isInteger(idx) && idx >= 0 && idx < cap
}

function endpointKey(e: RackPortEndpoint): string {
  return `${e.gearId}\t${e.portKind}\t${e.portIndex}`
}

function pairDedupKey(a: RackPortEndpoint, b: RackPortEndpoint): string {
  const ka = endpointKey(a)
  const kb = endpointKey(b)
  return ka < kb ? `${ka}||${kb}` : `${kb}||${ka}`
}

/** Drops links to missing gear, self-links, kind mismatches, out-of-range ports, and duplicate pairs. */
export function pruneInvalidPortLinks(gear: RackGear[], links: RackPortLink[]): RackPortLink[] {
  const seen = new Set<string>()
  const out: RackPortLink[] = []
  for (const link of links) {
    if (!portEndpointValid(gear, link.from) || !portEndpointValid(gear, link.to)) continue
    if (link.from.gearId === link.to.gearId) continue
    if (link.from.portKind !== link.to.portKind) continue
    const dedup = pairDedupKey(link.from, link.to)
    if (seen.has(dedup)) continue
    seen.add(dedup)
    out.push(link)
  }
  return out
}
