import { useMemo } from 'react'
import {
  DND_FURNITURE_KIND,
  FURNITURE_CATEGORY_ORDER,
  FURNITURE_SPECS,
  furnitureCategoryLabel,
  type FurnitureSpec,
} from '../lib/furnitureCatalog'
import { useProjectStore } from '../store/projectStore'
import type { FurnitureCategory } from '../types/project'

/**
 * Furnish tab rail: drag a row onto the plan, or click it to drop the item in the middle
 * of the sheet. Sizes shown are the catalog defaults and stay editable per item.
 */
export function FurniturePalette() {
  const addFurnitureItem = useProjectStore((s) => s.addFurnitureItem)
  const plan = useProjectStore(
    (s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.plan,
  )

  const byCategory = useMemo(() => {
    const map = new Map<FurnitureCategory, FurnitureSpec[]>()
    for (const c of FURNITURE_CATEGORY_ORDER) map.set(c, [])
    for (const s of FURNITURE_SPECS) map.get(s.category)?.push(s)
    return map
  }, [])

  const dropInCenter = (spec: FurnitureSpec) => {
    if (!plan) return
    addFurnitureItem(spec.kind, plan.widthM / 2, plan.depthM / 2)
  }

  return (
    <div className="panel-block">
      <h3 className="side-heading">Furniture &amp; fixtures</h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Drag onto the plan (or click to drop it in the centre). Footprints are simple
        rectangles — they carry size, height and rotation as metadata for the 3D render
        prompt, and never appear in the BOM.
      </p>
      {FURNITURE_CATEGORY_ORDER.map((cat) => {
        const rows = byCategory.get(cat) ?? []
        if (rows.length === 0) return null
        return (
          <div key={cat} style={{ marginTop: '0.75rem' }}>
            <h4 className="side-heading" style={{ fontSize: '0.85rem' }}>
              {furnitureCategoryLabel(cat)}
            </h4>
            <ul className="furniture-palette-list">
              {rows.map((spec) => (
                <li key={spec.kind}>
                  <button
                    type="button"
                    className="furniture-palette-row"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DND_FURNITURE_KIND, spec.kind)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => dropInCenter(spec)}
                    title={`${spec.label} — ${spec.widthM} × ${spec.depthM} m, ${spec.heightM} m high`}
                  >
                    <span
                      className="furniture-palette-swatch"
                      style={{ background: spec.fill, borderColor: spec.stroke }}
                      aria-hidden="true"
                    />
                    <span className="furniture-palette-text">
                      <span className="furniture-palette-name">{spec.label}</span>
                      <span className="muted small">
                        {spec.widthM} × {spec.depthM} m
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
