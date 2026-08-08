import { useProjectStore } from '../store/projectStore'
import { MIN_WALL_OPENING_SIZE_M } from '../lib/wallOpeningDefaults'
import { wallElevationDisplayXM } from '../lib/planCoordinates'
import type { WallOpeningKind } from '../types/project'

/** Common residential sizes (width × height in m) offered as one-click presets. */
const PRESETS: Record<WallOpeningKind, { label: string; widthM: number; heightM: number }[]> = {
  door: [
    { label: '0.80 × 2.00', widthM: 0.8, heightM: 2 },
    { label: '0.90 × 2.10', widthM: 0.9, heightM: 2.1 },
    { label: '1.20 × 2.10 (double)', widthM: 1.2, heightM: 2.1 },
    { label: '1.80 × 2.20 (slider)', widthM: 1.8, heightM: 2.2 },
  ],
  window: [
    { label: '0.60 × 0.60', widthM: 0.6, heightM: 0.6 },
    { label: '1.20 × 1.20', widthM: 1.2, heightM: 1.2 },
    { label: '1.60 × 1.40', widthM: 1.6, heightM: 1.4 },
    { label: '2.40 × 2.20 (panoramic)', widthM: 2.4, heightM: 2.2 },
  ],
}

/**
 * Size / position editor for the opening selected on the wall elevation. Edits propagate
 * to every wall face that shares the opening (both sides of a wall, T-junction chords).
 */
export function WallOpeningInspector() {
  const selection = useProjectStore((s) => s.selectionWallOpening)
  const updateWallOpening = useProjectStore((s) => s.updateWallOpening)
  const removeWallOpening = useProjectStore((s) => s.removeWallOpening)
  const sheet = useProjectStore((s) => {
    const fl = s.project.floors.find((f) => f.id === s.activeFloorId)
    if (!fl || !selection) return undefined
    return fl.wallSheets.find((w) => w.id === selection.wallSheetId)
  })

  const opening = selection
    ? sheet?.openings.find((o) => o.id === selection.openingId)
    : undefined
  if (!selection || !sheet || !opening) return null

  const sillM = opening.zM - opening.heightM / 2
  const headM = opening.zM + opening.heightM / 2
  /* The elevation mirrors the 'b' face, so show the distance the user actually sees. */
  const displayXM = wallElevationDisplayXM(opening.xM, sheet.lengthM, sheet.wallFace)
  const setXFromDisplay = (v: number) => {
    const stored = wallElevationDisplayXM(v, sheet.lengthM, sheet.wallFace)
    updateWallOpening(sheet.id, opening.id, { xM: stored })
  }

  return (
    <div className="panel-block inner">
      <h3 className="side-heading">
        {opening.kind === 'door' ? 'Door' : 'Window'} — size &amp; position
      </h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        On <strong>{sheet.label}</strong>. Changes apply to every wall face that shares this
        opening, and the plan icon resizes with it.
      </p>
      <div className="field-row">
        <label className="field">
          <span>Width (m)</span>
          <input
            type="number"
            min={MIN_WALL_OPENING_SIZE_M}
            max={sheet.lengthM}
            step={0.05}
            value={+opening.widthM.toFixed(3)}
            onChange={(e) =>
              updateWallOpening(sheet.id, opening.id, { widthM: Number(e.target.value) })
            }
          />
        </label>
        <label className="field">
          <span>Height (m)</span>
          <input
            type="number"
            min={MIN_WALL_OPENING_SIZE_M}
            max={sheet.heightM}
            step={0.05}
            value={+opening.heightM.toFixed(3)}
            onChange={(e) =>
              updateWallOpening(sheet.id, opening.id, { heightM: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>Sill height (m)</span>
          <input
            type="number"
            min={0}
            max={sheet.heightM}
            step={0.05}
            value={+sillM.toFixed(3)}
            onChange={(e) => {
              const s = Number(e.target.value)
              if (!Number.isFinite(s)) return
              updateWallOpening(sheet.id, opening.id, { zM: s + opening.heightM / 2 })
            }}
          />
        </label>
        <label className="field">
          <span>Centre along wall (m)</span>
          <input
            type="number"
            min={0}
            max={sheet.lengthM}
            step={0.05}
            value={+displayXM.toFixed(3)}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isFinite(v)) return
              setXFromDisplay(v)
            }}
          />
        </label>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Head at {headM.toFixed(2)} m of a {sheet.heightM.toFixed(2)} m wall
        {headM > sheet.heightM + 1e-6 ? ' — clamped to the wall.' : '.'}
      </p>
      <label className="field">
        <span>Label (optional)</span>
        <input
          value={opening.label ?? ''}
          placeholder={opening.kind === 'door' ? 'e.g. entrance' : 'e.g. north window'}
          onChange={(e) =>
            updateWallOpening(sheet.id, opening.id, { label: e.target.value })
          }
        />
      </label>
      <div className="field">
        <span>Presets</span>
        <div className="btn-row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {PRESETS[opening.kind].map((p) => (
            <button
              key={p.label}
              type="button"
              className="btn ghost"
              onClick={() =>
                updateWallOpening(sheet.id, opening.id, {
                  widthM: p.widthM,
                  heightM: p.heightM,
                  /* Doors sit on the floor; windows keep the sill they already have. */
                  ...(opening.kind === 'door' ? { zM: p.heightM / 2 } : { zM: sillM + p.heightM / 2 }),
                })
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn ghost"
          onClick={() => removeWallOpening(sheet.id, opening.id)}
        >
          Remove {opening.kind}
        </button>
      </div>
    </div>
  )
}
