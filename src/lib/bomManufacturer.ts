import type { BomLine } from './bom'
import type { PlanstudioProject } from '../types/project'

/** Manufacturer / line string for grouping BOM lines (from catalog, panel slots, etc.). */
export function manufacturerLineForBomLine(
  p: PlanstudioProject,
  line: BomLine,
): string {
  switch (line.source) {
    case 'panel': {
      const sl = p.panel.slots.find((s) => s.id === line.id)
      return (sl?.manufacturerLine ?? '').trim()
    }
    case 'rack':
      return ''
    case 'rack_enclosure':
      return ''
    case 'floor': {
      const fl = p.floors.find((f) => f.id === line.floorLevelId)
      const d = fl?.plan.devices.find((x) => x.id === line.id)
      if (!d?.templateId) return ''
      const t = p.deviceCatalog.find((x) => x.id === d.templateId)
      return (t?.manufacturerLine ?? '').trim()
    }
    case 'wall': {
      for (const fl of p.floors) {
        for (const ws of fl.wallSheets) {
          const d = ws.devices.find((x) => x.id === line.id)
          if (d) {
            if (!d.templateId) return ''
            const t = p.deviceCatalog.find((x) => x.id === d.templateId)
            return (t?.manufacturerLine ?? '').trim()
          }
        }
      }
      return ''
    }
    default:
      return ''
  }
}
