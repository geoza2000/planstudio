import {
  DND_DEVICE_TEMPLATE,
  templateAllowsPlanMounting,
  templateAllowsWallMounting,
  templatePalettePrimaryLine,
  templatePaletteSecondaryLine,
} from '../lib/deviceCatalog'
import { deviceGlyph } from '../lib/deviceStyle'
import { useProjectStore } from '../store/projectStore'
import type { DeviceTemplate } from '../types/project'

type Surface = 'plan' | 'wall'

function filterForSurface(catalog: DeviceTemplate[], surface: Surface): DeviceTemplate[] {
  return catalog.filter((t) =>
    surface === 'plan' ? templateAllowsPlanMounting(t.mounting) : templateAllowsWallMounting(t.mounting),
  )
}

export function DeviceTemplatePalette({ surface }: { surface: Surface }) {
  const catalog = useProjectStore((s) => s.project.deviceCatalog ?? [])
  const rows = filterForSurface(catalog, surface)

  return (
    <div className="device-template-palette">
      <h3 className="side-heading" style={{ marginTop: 0 }}>
        {surface === 'plan' ? 'Ceiling / plan' : 'Wall'} templates
      </h3>
      <p className="muted small" style={{ marginTop: 0 }}>
        Drag onto the {surface === 'plan' ? 'floor plan' : 'wall canvas'} while Device tool is
        active. Templates marked <strong>both</strong> appear on plan and wall palettes.
      </p>
      {rows.length === 0 ? (
        <p className="muted small">No templates for this surface — add some on the Devices tab.</p>
      ) : (
        <ul className="device-template-palette-list">
          {rows.map((t) => {
            const subtitle = templatePaletteSecondaryLine(t)
            return (
            <li key={t.id} className="device-template-palette-item">
              <span
                className="device-template-palette-glyph"
                aria-hidden
                style={{ fontWeight: 700 }}
              >
                {deviceGlyph(t.type, t.connectorSubtype)}
              </span>
              <span className="device-template-palette-meta">
                <span className="device-template-palette-name">{templatePalettePrimaryLine(t)}</span>
                {subtitle ? (
                  <span className="muted small" style={{ display: 'block' }}>
                    {subtitle}
                  </span>
                ) : null}
                <span className="muted small">
                  {t.type}
                  {t.type === 'connector' && t.connectorSubtype
                    ? ` · ${t.connectorSubtype}`
                    : ''}{' '}
                  · {t.mounting} · €{t.unitPrice}
                </span>
              </span>
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', t.id)
                  e.dataTransfer.setData(DND_DEVICE_TEMPLATE, t.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                className="btn"
                style={{
                  cursor: 'grab',
                  userSelect: 'none',
                  fontSize: 12,
                  padding: '6px 8px',
                  flexShrink: 0,
                }}
                title="Drag onto the canvas"
              >
                Drag
              </div>
            </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
