import { useMemo } from 'react'
import { useProjectStore } from '../store/projectStore'
import { polygonAreaM2 } from '../lib/roomGeometry'
import { regionIsExternal } from '../types/project'

/**
 * Rooms on the active floor: rename inline and mark a space as outdoor (terrace, balcony,
 * courtyard). External is its own flag rather than a `kind` change, because auto-detected
 * rooms have their `kind` rewritten on every wall-topology reconcile.
 */
export function RoomListPanel() {
  const regions = useProjectStore(
    (s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.plan.regions ?? [],
  )
  const updatePlanRegionLabel = useProjectStore((s) => s.updatePlanRegionLabel)
  const setPlanRegionExternal = useProjectStore((s) => s.setPlanRegionExternal)

  const rows = useMemo(
    () =>
      [...regions]
        .map((r) => ({ region: r, area: polygonAreaM2(r.vertices) }))
        .sort((a, b) => b.area - a.area || a.region.id.localeCompare(b.region.id)),
    [regions],
  )

  if (rows.length === 0) {
    return (
      <div className="panel-block inner">
        <h3 className="side-heading">Rooms</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Draw closed loops of wall segments and rooms appear here automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="panel-block inner">
      <h3 className="side-heading">Rooms ({rows.length})</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Mark terraces, balconies and courtyards as <strong>outdoor</strong>: they are drawn
        green on the plan and the 3D preview leaves them open to the sky.
      </p>
      <ul className="room-list">
        {rows.map(({ region, area }) => {
          const external = regionIsExternal(region)
          return (
            <li key={region.id} className="room-list-row">
              <input
                aria-label={`Room name for ${region.label}`}
                className="room-list-name"
                value={region.label}
                onChange={(e) => updatePlanRegionLabel(region.id, e.target.value)}
              />
              <span className="muted small room-list-area">{area.toFixed(1)} m²</span>
              <label
                className="room-list-toggle"
                title="Outdoor space: no ceiling, exterior finishes"
              >
                <input
                  type="checkbox"
                  checked={external}
                  onChange={(e) => setPlanRegionExternal(region.id, e.target.checked)}
                />
                <span>Outdoor</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
