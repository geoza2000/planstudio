import { useMemo } from 'react'
import { regionIsExternal } from '../types/project'
import { polygonAreaM2 } from '../lib/roomGeometry'
import { usePreview3dStore } from '../store/preview3dStore'
import { useProjectStore } from '../store/projectStore'

/** Sidebar for the 3D preview tab: camera presets, layers and the section cut. */
export function Preview3DControls() {
  const project = useProjectStore((s) => s.project)
  const activeFloorId = useProjectStore((s) => s.activeFloorId)
  const activeFloor = useMemo(
    () => project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0]!,
    [project.floors, activeFloorId],
  )
  const rooms = useMemo(
    () =>
      [...(activeFloor.plan.regions ?? [])]
        .filter((r) => r.vertices.length >= 3)
        .sort((a, b) => polygonAreaM2(b.vertices) - polygonAreaM2(a.vertices)),
    [activeFloor.plan.regions],
  )

  const showCeilings = usePreview3dStore((s) => s.showCeilings)
  const showFurniture = usePreview3dStore((s) => s.showFurniture)
  const showDevices = usePreview3dStore((s) => s.showDevices)
  const showRoomLabels = usePreview3dStore((s) => s.showRoomLabels)
  const sectionCut = usePreview3dStore((s) => s.sectionCut)
  const sectionCutM = usePreview3dStore((s) => s.sectionCutM)
  const set = usePreview3dStore((s) => s.set)
  const requestCamera = usePreview3dStore((s) => s.requestCamera)
  const requestSnapshot = usePreview3dStore((s) => s.requestSnapshot)

  const wallCount = activeFloor.plan.wallSegments?.length ?? 0

  return (
    <>
      <div className="panel-block">
        <h3 className="side-heading">Camera</h3>
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={() => requestCamera('overview')}>
            Overview
          </button>
          <button type="button" className="btn secondary" onClick={() => requestCamera('top')}>
            Top
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => requestCamera('walk')}
            disabled={rooms.length === 0}
            title="Eye-level view inside the largest room"
          >
            Walk in
          </button>
        </div>
        {rooms.length > 0 ? (
          <label className="field">
            <span className="muted small">Step into a room</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) requestCamera('walk', e.target.value)
              }}
            >
              <option value="">Choose a room…</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label.trim() || 'Room'}
                  {regionIsExternal(r) ? ' (outdoor)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="panel-block">
        <h3 className="side-heading">Layers</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showCeilings}
            onChange={(e) => set({ showCeilings: e.target.checked })}
          />
          <span>Ceilings (visible from inside only)</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showFurniture}
            onChange={(e) => set({ showFurniture: e.target.checked })}
          />
          <span>Furniture &amp; fittings</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showDevices}
            onChange={(e) => set({ showDevices: e.target.checked })}
          />
          <span>Devices (lights, sockets, switches)</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={showRoomLabels}
            onChange={(e) => set({ showRoomLabels: e.target.checked })}
          />
          <span>Room labels</span>
        </label>
      </div>

      <div className="panel-block">
        <h3 className="side-heading">Section cut</h3>
        <label className="check-row">
          <input
            type="checkbox"
            checked={sectionCut}
            onChange={(e) => set({ sectionCut: e.target.checked })}
          />
          <span>Clip walls above a height</span>
        </label>
        <label className="field">
          <span className="muted small">Cut height: {sectionCutM.toFixed(1)} m</span>
          <input
            type="range"
            min={0.3}
            max={3.5}
            step={0.1}
            value={sectionCutM}
            disabled={!sectionCut}
            onChange={(e) => set({ sectionCutM: Number(e.target.value) })}
          />
        </label>
      </div>

      <div className="panel-block">
        <h3 className="side-heading">Export</h3>
        <div className="btn-row">
          <button type="button" className="btn secondary" onClick={requestSnapshot}>
            Download PNG
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          The model is built live from the plan: wall thickness and finish from the Floor tab,
          heights and openings from the Wall tab, furniture from the Furnish tab.
          {wallCount === 0 ? ' Draw some walls first to see anything.' : ''}
        </p>
      </div>
    </>
  )
}
