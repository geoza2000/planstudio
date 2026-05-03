import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { deviceTypeRollupLabel } from '../types/project'
import type { PlanstudioProject } from '../types/project'
import {
  templateAllowsPlanMounting,
  templateAllowsWallMounting,
  templatePalettePrimaryLine,
} from '../lib/deviceCatalog'
import {
  assignExistingCatalogTemplateToFloorDevice,
  assignExistingCatalogTemplateToWallDevice,
  clusterUnlinkedPlanWallDevices,
  createCatalogTemplateFromFloorDeviceAndLink,
  createCatalogTemplateFromWallDeviceAndLink,
  listUnlinkedPlanWallDevices,
  rowAllowsResyncFromLinkedCatalog,
  unlinkedRowKey,
  type UnlinkedPlanWallRow,
} from '../lib/unlinkedDeviceMigration'

type UnlinkedDevicesImportModalProps = {
  initialProject: PlanstudioProject
  onCommit: (project: PlanstudioProject) => void
  onAbort: () => void
}

function countResyncableInGroup(
  project: PlanstudioProject,
  groupRows: UnlinkedPlanWallRow[],
): number {
  return groupRows.filter((r) => r.staleTemplateId && rowAllowsResyncFromLinkedCatalog(project, r))
    .length
}

export function UnlinkedDevicesImportModal({
  initialProject,
  onCommit,
  onAbort,
}: UnlinkedDevicesImportModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(() => structuredClone(initialProject))

  const rows = useMemo(() => listUnlinkedPlanWallDevices(draft), [draft])
  const clusters = useMemo(() => clusterUnlinkedPlanWallDevices(rows), [rows])
  const catalog = draft.deviceCatalog ?? []
  const resyncAllLinkedCount = useMemo(
    () => rows.filter((r) => r.staleTemplateId && rowAllowsResyncFromLinkedCatalog(draft, r)).length,
    [rows, draft],
  )

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const open = () => {
      try {
        if (!el.open) {
          el.showModal()
        }
      } catch {
        /* strict mode / duplicate open */
      }
    }
    const id = requestAnimationFrame(open)
    return () => {
      cancelAnimationFrame(id)
      try {
        if (el.open) {
          el.close()
        }
      } catch {
        /* ignore */
      }
    }
  }, [])

  const applyTemplateToRow = (
    prev: PlanstudioProject,
    templateId: string,
    row: UnlinkedPlanWallRow,
  ): PlanstudioProject => {
    if (row.surface === 'floor') {
      return assignExistingCatalogTemplateToFloorDevice(
        prev,
        row.floorLevelId,
        row.deviceId,
        templateId,
      )
    }
    return assignExistingCatalogTemplateToWallDevice(
      prev,
      row.floorLevelId,
      row.wallSheetId,
      row.deviceId,
      templateId,
    )
  }

  const onSelectExistingForGroup = (templateId: string, groupRows: UnlinkedPlanWallRow[]) => {
    if (!templateId) return
    setDraft((prev) => {
      let next = prev
      for (const row of groupRows) {
        next = applyTemplateToRow(next, templateId, row)
      }
      return next
    })
  }

  const onCreateFromMark = (row: UnlinkedPlanWallRow) => {
    setDraft((prev) => {
      if (row.surface === 'floor') {
        return createCatalogTemplateFromFloorDeviceAndLink(prev, row.floorLevelId, row.deviceId)
      }
      return createCatalogTemplateFromWallDeviceAndLink(
        prev,
        row.floorLevelId,
        row.wallSheetId,
        row.deviceId,
      )
    })
  }

  const onResyncGroupLinked = (groupRows: UnlinkedPlanWallRow[]) => {
    setDraft((prev) => {
      let next = prev
      for (const row of groupRows) {
        const tid = row.staleTemplateId
        if (!tid || !rowAllowsResyncFromLinkedCatalog(next, row)) continue
        next = applyTemplateToRow(next, tid, row)
      }
      return next
    })
  }

  const onResyncAllLinkedRows = () => {
    setDraft((prev) => {
      const queue = listUnlinkedPlanWallDevices(prev).filter(
        (r) => r.staleTemplateId && rowAllowsResyncFromLinkedCatalog(prev, r),
      )
      let next = prev
      for (const row of queue) {
        const tid = row.staleTemplateId
        if (!tid) continue
        next = applyTemplateToRow(next, tid, row)
      }
      return next
    })
  }

  const handleDialogCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault()
    onAbort()
  }

  const firstRow = (groupRows: UnlinkedPlanWallRow[]) => groupRows[0]!

  const dialog = (
    <dialog
      ref={dialogRef}
      className="import-migration-dialog"
      aria-labelledby="import-migration-title"
      aria-modal="true"
      onCancel={handleDialogCancel}
    >
      <div className="import-migration-inner panel-block">
        <h2 id="import-migration-title" className="side-heading">
          Link imported devices to the catalog
        </h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          <strong>{clusters.length}</strong> group{clusters.length === 1 ? '' : 's'} (
          <strong>{rows.length}</strong> mark{rows.length === 1 ? '' : 's'}): missing or deleted{' '}
          <code>templateId</code>, mounting that does not fit the surface, or a valid template id whose
          label / product / requirements on the mark still differ from the catalog row. Use{' '}
          <em>Apply linked row</em> when the catalog id is already correct, or pick another template /
          create from mark.
        </p>
        {resyncAllLinkedCount > 0 ? (
          <div className="btn-row" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="btn secondary" onClick={onResyncAllLinkedRows}>
              Apply linked catalog row to all ({resyncAllLinkedCount})
            </button>
          </div>
        ) : null}
        {rows.length > 0 ? (
          <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
            <table className="bom-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Count</th>
                  <th>Surface</th>
                  <th>Kind</th>
                  <th>Catalog id</th>
                  <th>Link to template</th>
                  <th>Apply linked</th>
                  <th>Create from mark</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((cluster) => {
                  const sample = firstRow(cluster.rows)
                  const resyncN = countResyncableInGroup(draft, cluster.rows)
                  const surface = sample.surface
                  const filterCatalog = (t: (typeof catalog)[number]) =>
                    surface === 'floor'
                      ? templateAllowsPlanMounting(t.mounting)
                      : templateAllowsWallMounting(t.mounting)
                  return (
                    <tr key={cluster.clusterKey}>
                      <td>
                        <strong>{cluster.groupLabel}</strong>
                        {cluster.rows.length > 1 ? (
                          <details style={{ marginTop: 6 }}>
                            <summary className="muted small" style={{ cursor: 'pointer' }}>
                              Locations
                            </summary>
                            <ul
                              className="muted small"
                              style={{ margin: '6px 0 0', paddingLeft: '1.1rem', maxHeight: 160, overflowY: 'auto' }}
                            >
                              {cluster.rows.map((row) => (
                                <li key={unlinkedRowKey(row)}>
                                  {row.surface === 'wall'
                                    ? `${row.floorLabel} · ${row.wallLabel}`
                                    : row.floorLabel}
                                  <button
                                    type="button"
                                    className="btn ghost"
                                    style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px' }}
                                    onClick={() => onCreateFromMark(row)}
                                  >
                                    Create from this mark
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </td>
                      <td>{cluster.rows.length}</td>
                      <td>{surface}</td>
                      <td className="muted small">
                        {deviceTypeRollupLabel(sample.type, sample.connectorSubtype)}
                      </td>
                      <td className="muted small" title={sample.staleTemplateId}>
                        {sample.staleTemplateId ? `${sample.staleTemplateId.slice(0, 10)}…` : '—'}
                      </td>
                      <td>
                        <select
                          aria-label={`Catalog template for group ${cluster.groupLabel}`}
                          value=""
                          onChange={(e) => {
                            const v = e.target.value
                            e.target.value = ''
                            if (v) onSelectExistingForGroup(v, cluster.rows)
                          }}
                        >
                          <option value="">Choose existing…</option>
                          {catalog.filter(filterCatalog).map((t) => (
                            <option key={t.id} value={t.id}>
                              {templatePalettePrimaryLine(t)} ·{' '}
                              {deviceTypeRollupLabel(t.type, t.connectorSubtype)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {resyncN > 0 ? (
                          <button
                            type="button"
                            className="btn secondary"
                            title="Overwrite every mark in this group from its linked catalog row where the id is still valid."
                            onClick={() => onResyncGroupLinked(cluster.rows)}
                          >
                            Apply linked row{resyncN < cluster.rows.length ? ` (${resyncN})` : ''}
                          </button>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                      <td>
                        {cluster.rows.length === 1 ? (
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => onCreateFromMark(sample)}
                          >
                            Create from mark
                          </button>
                        ) : (
                          <span className="muted small">Expand locations</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted small" style={{ marginTop: '0.75rem' }}>
            All marks are linked. You can finish the import.
          </p>
        )}
        <div className="btn-row" style={{ marginTop: '1rem', gap: 8 }}>
          <button
            type="button"
            className="btn primary"
            disabled={rows.length > 0}
            onClick={() => onCommit(draft)}
          >
            Finish import
          </button>
          <button type="button" className="btn secondary" onClick={onAbort}>
            Cancel import
          </button>
        </div>
      </div>
    </dialog>
  )

  if (typeof document === 'undefined') {
    return dialog
  }
  return createPortal(dialog, document.body)
}
