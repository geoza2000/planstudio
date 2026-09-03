import {
  MAX_LOW_WALL_HEIGHT_M,
  MAX_WALL_THICKNESS_M,
  MIN_LOW_WALL_HEIGHT_M,
  MIN_WALL_THICKNESS_M,
} from '../lib/wallConstruction'
import {
  WALL_FORMS,
  WALL_MATERIALS,
  wallFormLabel,
  wallMaterialLabel,
  type WallForm,
  type WallMaterial,
} from '../types/project'

type WallConstructionFieldsProps = {
  thicknessM: number
  material: WallMaterial
  /** Multi-selection with differing values: show a placeholder instead of a wrong number. */
  mixedThickness?: boolean
  mixedMaterial?: boolean
  /** Omit `form` for the project-defaults variant, which has no vertical form. */
  form?: WallForm
  mixedForm?: boolean
  lowHeightM?: number
  mixedLowHeight?: boolean
  onThicknessChange: (m: number) => void
  onMaterialChange: (m: WallMaterial) => void
  onFormChange?: (f: WallForm) => void
  onLowHeightChange?: (m: number) => void
  heading?: string
  hint?: string
}

/** Thickness + surface finish inputs, shared by the single- and multi-segment inspectors. */
export function WallConstructionFields({
  thicknessM,
  material,
  mixedThickness = false,
  mixedMaterial = false,
  form,
  mixedForm = false,
  lowHeightM,
  mixedLowHeight = false,
  onThicknessChange,
  onMaterialChange,
  onFormChange,
  onLowHeightChange,
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
      {form !== undefined && onFormChange ? (
        <div className="field-row">
          <label className="field">
            <span>Form</span>
            <select
              value={mixedForm ? '' : form}
              onChange={(e) => {
                const v = e.target.value
                if (v === '') return
                onFormChange(v as WallForm)
              }}
            >
              {mixedForm ? <option value="">(mixed)</option> : null}
              {WALL_FORMS.map((f) => (
                <option key={f} value={f}>
                  {wallFormLabel(f)}
                </option>
              ))}
            </select>
          </label>
          {(mixedForm || form === 'low') && onLowHeightChange ? (
            <label className="field">
              <span>Fence height (m)</span>
              <input
                type="number"
                min={MIN_LOW_WALL_HEIGHT_M}
                max={MAX_LOW_WALL_HEIGHT_M}
                step={0.05}
                placeholder={mixedLowHeight ? 'mixed' : undefined}
                value={mixedLowHeight || lowHeightM === undefined ? '' : lowHeightM}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  onLowHeightChange(v)
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {hint ? (
        <p className="muted small" style={{ marginTop: 0 }}>
          {hint}
        </p>
      ) : null}
    </>
  )
}
