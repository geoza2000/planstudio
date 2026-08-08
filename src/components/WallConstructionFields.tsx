import {
  MAX_WALL_THICKNESS_M,
  MIN_WALL_THICKNESS_M,
} from '../lib/wallConstruction'
import { WALL_MATERIALS, wallMaterialLabel, type WallMaterial } from '../types/project'

type WallConstructionFieldsProps = {
  thicknessM: number
  material: WallMaterial
  /** Multi-selection with differing values: show a placeholder instead of a wrong number. */
  mixedThickness?: boolean
  mixedMaterial?: boolean
  onThicknessChange: (m: number) => void
  onMaterialChange: (m: WallMaterial) => void
  heading?: string
  hint?: string
}

/** Thickness + surface finish inputs, shared by the single- and multi-segment inspectors. */
export function WallConstructionFields({
  thicknessM,
  material,
  mixedThickness = false,
  mixedMaterial = false,
  onThicknessChange,
  onMaterialChange,
  heading = 'Construction',
  hint,
}: WallConstructionFieldsProps) {
  return (
    <>
      <h4 className="side-heading" style={{ fontSize: '0.85rem', marginTop: '0.75rem' }}>
        {heading}
      </h4>
      <div className="field-row">
        <label className="field">
          <span>Thickness (m)</span>
          <input
            type="number"
            min={MIN_WALL_THICKNESS_M}
            max={MAX_WALL_THICKNESS_M}
            step={0.01}
            placeholder={mixedThickness ? 'mixed' : undefined}
            value={mixedThickness ? '' : thicknessM}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isFinite(v)) return
              onThicknessChange(v)
            }}
          />
        </label>
        <label className="field">
          <span>Material</span>
          <select
            value={mixedMaterial ? '' : material}
            onChange={(e) => {
              const v = e.target.value
              if (v === '') return
              onMaterialChange(v as WallMaterial)
            }}
          >
            {mixedMaterial ? <option value="">(mixed)</option> : null}
            {WALL_MATERIALS.map((m) => (
              <option key={m} value={m}>
                {wallMaterialLabel(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {hint ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          {hint}
        </p>
      ) : null}
    </>
  )
}
