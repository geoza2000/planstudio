import {
  furnitureSpec,
  MAX_FURNITURE_SIZE_M,
  MIN_FURNITURE_SIZE_M,
} from '../lib/furnitureCatalog'
import { useProjectStore } from '../store/projectStore'

/** Quarter-turn buttons cover the common “push it against that wall” case. */
const QUICK_ROTATIONS = [0, 90, 180, 270]

/** Size / rotation / notes editor for the item selected on the Furnish canvas. */
export function FurnitureInspector() {
  const selectionFurnitureId = useProjectStore((s) => s.selectionFurnitureId)
  const updateFurnitureItem = useProjectStore((s) => s.updateFurnitureItem)
  const removeFurnitureItem = useProjectStore((s) => s.removeFurnitureItem)
  const duplicateFurnitureItem = useProjectStore((s) => s.duplicateFurnitureItem)
  const item = useProjectStore((s) => {
    const fl = s.project.floors.find((f) => f.id === s.activeFloorId)
    return fl?.plan.furniture.find((f) => f.id === s.selectionFurnitureId)
  })
  const regionLabel = useProjectStore((s) => {
    const fl = s.project.floors.find((f) => f.id === s.activeFloorId)
    const cur = fl?.plan.furniture.find((f) => f.id === s.selectionFurnitureId)
    if (!cur?.roomRegionId) return null
    return fl?.plan.regions.find((r) => r.id === cur.roomRegionId)?.label ?? null
  })

  if (!selectionFurnitureId || !item) {
    return (
      <div className="panel-block">
        <h3 className="side-heading">Furnish</h3>
        <p className="muted small" style={{ margin: 0 }}>
          Select an item on the plan to edit its size, height and rotation. Drop new items
          from the palette on the right.
        </p>
      </div>
    )
  }

  const spec = furnitureSpec(item.kind)

  return (
    <div className="panel-block">
      <h3 className="side-heading">{spec.label}</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        {regionLabel ? `In ${regionLabel}.` : 'Not inside a detected room.'} Centre at{' '}
        {item.x.toFixed(2)} , {item.y.toFixed(2)} m.
      </p>
      <label className="field">
        <span>Label (optional)</span>
        <input
          value={item.label}
          placeholder={spec.label}
          onChange={(e) => updateFurnitureItem(item.id, { label: e.target.value })}
        />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Width (m)</span>
          <input
            type="number"
            min={MIN_FURNITURE_SIZE_M}
            max={MAX_FURNITURE_SIZE_M}
            step={0.05}
            value={+item.widthM.toFixed(3)}
            onChange={(e) =>
              updateFurnitureItem(item.id, { widthM: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Depth (m)</span>
          <input
            type="number"
            min={MIN_FURNITURE_SIZE_M}
            max={MAX_FURNITURE_SIZE_M}
            step={0.05}
            value={+item.depthM.toFixed(3)}
            onChange={(e) =>
              updateFurnitureItem(item.id, { depthM: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Height (m)</span>
          <input
            type="number"
            min={MIN_FURNITURE_SIZE_M}
            max={MAX_FURNITURE_SIZE_M}
            step={0.05}
            value={+item.heightM.toFixed(3)}
            onChange={(e) =>
              updateFurnitureItem(item.id, { heightM: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Rotation (°)</span>
          <input
            type="number"
            min={0}
            max={359}
            step={5}
            value={+item.rotationDeg.toFixed(1)}
            onChange={(e) =>
              updateFurnitureItem(item.id, { rotationDeg: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        {QUICK_ROTATIONS.map((deg) => (
          <button
            key={deg}
            type="button"
            className={
              Math.round(item.rotationDeg) === deg ? 'btn secondary' : 'btn ghost'
            }
            onClick={() => updateFurnitureItem(item.id, { rotationDeg: deg })}
          >
            {deg}°
          </button>
        ))}
      </div>
      <label className="field">
        <span>Notes (used in the render prompt)</span>
        <input
          value={item.notes ?? ''}
          placeholder="e.g. dark grey linen, oak legs"
          onChange={(e) =>
            updateFurnitureItem(item.id, {
              notes: e.target.value.trim() ? e.target.value : undefined,
            })
          }
        />
      </label>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn secondary"
          onClick={() => duplicateFurnitureItem(item.id)}
        >
          Duplicate
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => removeFurnitureItem(item.id)}
        >
          Remove
        </button>
      </div>
      <button
        type="button"
        className="btn ghost"
        style={{ marginTop: 8 }}
        onClick={() =>
          updateFurnitureItem(item.id, {
            widthM: spec.widthM,
            depthM: spec.depthM,
            heightM: spec.heightM,
          })
        }
      >
        Reset to catalog size ({spec.widthM} × {spec.depthM} m)
      </button>
    </div>
  )
}
