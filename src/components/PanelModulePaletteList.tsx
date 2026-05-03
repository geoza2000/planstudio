import { useProjectStore } from '../store/projectStore'
import type { PanelModuleType } from '../types/project'

const MODULE_TYPES: PanelModuleType[] = ['blank', 'mcb', 'rcd', 'surge', 'spare']

const DND_TYPE = 'application/x-planstudio-panel-palette'

export function PanelModulePaletteList() {
  const modulePalette = useProjectStore((s) => s.project.panel.modulePalette ?? [])
  const addPanelModuleTemplate = useProjectStore((s) => s.addPanelModuleTemplate)
  const updatePanelModuleTemplate = useProjectStore((s) => s.updatePanelModuleTemplate)
  const removePanelModuleTemplate = useProjectStore((s) => s.removePanelModuleTemplate)

  return (
    <div className="panel-palette">
      {modulePalette.length === 0 ? (
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          No items yet — add a row, edit fields, then drag onto the DIN grid. Each drop is a
          new instance; palette rows are templates.
        </p>
      ) : null}
      <div className="field-row" style={{ marginBottom: 8 }}>
        <button type="button" className="btn" onClick={() => addPanelModuleTemplate()}>
          Add palette row
        </button>
      </div>
      {modulePalette.map((m) => (
        <div
          key={m.id}
          className="panel-palette-row"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            marginBottom: 10,
            padding: 8,
            border: '1px solid var(--border, #2a3847)',
            borderRadius: 6,
            background: 'rgba(15, 20, 25, 0.35)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="field-row" style={{ gap: 6 }}>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Label / name</span>
                <input
                  value={m.label}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, { label: e.target.value })
                  }
                />
              </label>
              <label className="field" style={{ width: 64 }}>
                <span>TE</span>
                <input
                  type="number"
                  min={1}
                  max={72}
                  value={m.spanWidthTe}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      spanWidthTe: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </label>
            </div>
            <div className="field-row" style={{ gap: 6 }}>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Manufacturer</span>
                <input
                  value={m.manufacturerLine ?? ''}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      manufacturerLine: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Catalog</span>
                <input
                  value={m.catalogCode ?? ''}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      catalogCode: e.target.value || undefined,
                    })
                  }
                />
              </label>
            </div>
            <div className="field-row" style={{ gap: 6 }}>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Product (BOM)</span>
                <input
                  value={m.productName}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, { productName: e.target.value })
                  }
                />
              </label>
              <label className="field" style={{ width: 100 }}>
                <span>Unit €</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={m.unitPrice}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      unitPrice: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <label className="field" style={{ margin: 0 }}>
              <span>Description</span>
              <input
                value={m.description ?? ''}
                onChange={(e) =>
                  updatePanelModuleTemplate(m.id, {
                    description: e.target.value || undefined,
                  })
                }
              />
            </label>
            <div className="field-row" style={{ gap: 6 }}>
              <label className="field" style={{ flex: 0.6, minWidth: 0 }}>
                <span>Module type</span>
                <select
                  value={m.moduleType}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      moduleType: e.target.value as PanelModuleType,
                    })
                  }
                >
                  {MODULE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field" style={{ flex: 0.4, minWidth: 0 }}>
                <span>Circuit ref</span>
                <input
                  value={m.circuitRef}
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, { circuitRef: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-row" style={{ gap: 6 }}>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>DIN rail (mm)</span>
                <input
                  type="number"
                  min={0}
                  value={m.dinRailSegmentMm ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      dinRailSegmentMm: e.target.value
                        ? Number(e.target.value)
                        : undefined,
                    })
                  }
                />
              </label>
              <label className="field" style={{ flex: 1, minWidth: 0 }}>
                <span>Rail use (mm)</span>
                <input
                  type="number"
                  min={0}
                  value={m.railConsumeMm ?? ''}
                  placeholder="—"
                  onChange={(e) =>
                    updatePanelModuleTemplate(m.id, {
                      railConsumeMm: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </label>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Drop width is min(template TE, free run at cell); occupied cells block placement.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
            <div
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', m.id)
                e.dataTransfer.setData(DND_TYPE, m.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              className="btn"
              style={{
                cursor: 'grab',
                userSelect: 'none',
                textAlign: 'center',
                fontSize: 12,
                padding: '8px 4px',
              }}
              title="Drag onto the DIN panel canvas to place a copy of this row"
            >
              Drag to grid
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => removePanelModuleTemplate(m.id)}
            >
              Remove row
            </button>
          </div>
        </div>
      ))}
      {modulePalette.length > 0 ? (
        <button type="button" className="btn ghost" onClick={() => addPanelModuleTemplate()}>
          Add another row
        </button>
      ) : null}
    </div>
  )
}
