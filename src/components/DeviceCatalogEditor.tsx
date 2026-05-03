import { useCallback, useEffect, useRef, useState } from 'react'
import { defaultBillableFields } from '../lib/billable'
import { templatePalettePrimaryLine, templatePaletteSecondaryLine } from '../lib/deviceCatalog'
import { mergeRequirementsWithDeviceTypeDefaults } from '../lib/requirementDefaults'
import { useProjectStore } from '../store/projectStore'
import { KnxBusDeviceFields } from './KnxBusDeviceFields'
import type {
  ConnectorSubtype,
  DeviceRequirements,
  DeviceTemplate,
  DeviceTemplateMounting,
  DeviceType,
} from '../types/project'
import {
  CONNECTOR_SUBTYPES,
  deviceTypeRollupLabel,
  DEVICE_TYPES,
} from '../types/project'

const MOUNTINGS: DeviceTemplateMounting[] = ['wall', 'ceiling', 'both']

export type DeviceCatalogDraft = Omit<DeviceTemplate, 'id'>

function emptyDraft(): DeviceCatalogDraft {
  const type: DeviceType = 'generic_eth_device'
  return {
    displayName: '',
    type,
    mounting: 'ceiling',
    connectorSubtype: undefined,
    requirements: mergeRequirementsWithDeviceTypeDefaults(type, undefined, undefined),
    ...defaultBillableFields({ productName: '' }),
    manufacturerLine: undefined,
    catalogCode: undefined,
  }
}

function templateToDraft(t: DeviceTemplate): DeviceCatalogDraft {
  const { id, ...rest } = t
  void id
  return rest
}

function draftToStorePartial(d: DeviceCatalogDraft): Partial<Omit<DeviceTemplate, 'id'>> {
  const connectorSubtype: ConnectorSubtype | undefined =
    d.type === 'connector' ? (d.connectorSubtype ?? 'ethernet') : undefined
  return {
    displayName: d.displayName,
    type: d.type,
    mounting: d.mounting,
    connectorSubtype,
    requirements: mergeRequirementsWithDeviceTypeDefaults(
      d.type,
      d.requirements,
      connectorSubtype,
    ),
    productName: d.productName,
    unitPrice: d.unitPrice,
    manufacturerLine: d.manufacturerLine?.trim() || undefined,
    catalogCode: d.catalogCode?.trim() || undefined,
  }
}

function DeviceTemplateFields({
  value,
  onPatch,
}: {
  value: DeviceCatalogDraft
  onPatch: (p: Partial<DeviceCatalogDraft>) => void
}) {
  const req = value.requirements ?? {}
  const patchReq = (p: Partial<DeviceRequirements>) =>
    onPatch({ requirements: { ...req, ...p } })

  return (
    <div className="device-catalog-form-fields">
      <div className="field-row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span>Display name</span>
          <input
            value={value.displayName}
            onChange={(e) => onPatch({ displayName: e.target.value })}
          />
        </label>
        <label className="field" style={{ width: 120 }}>
          <span>Mounting</span>
          <select
            value={value.mounting}
            onChange={(e) =>
              onPatch({ mounting: e.target.value as DeviceTemplateMounting })
            }
          >
            {MOUNTINGS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="field-row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span>Type</span>
          <select
            value={value.type}
            onChange={(e) => {
              const nextType = e.target.value as DeviceType
              const nextSubtype =
                nextType === 'connector' ? (value.connectorSubtype ?? 'ethernet') : undefined
              onPatch({
                type: nextType,
                connectorSubtype: nextSubtype,
                requirements: mergeRequirementsWithDeviceTypeDefaults(
                  nextType,
                  value.requirements,
                  nextSubtype,
                ),
              })
            }}
          >
            {DEVICE_TYPES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {value.type === 'connector' ? (
          <label className="field" style={{ width: 140 }}>
            <span>Connector</span>
            <select
              value={value.connectorSubtype ?? 'ethernet'}
              onChange={(e) => {
                const s = e.target.value as ConnectorSubtype
                onPatch({
                  connectorSubtype: s,
                  requirements: mergeRequirementsWithDeviceTypeDefaults(
                    'connector',
                    value.requirements,
                    s,
                  ),
                })
              }}
            >
              {CONNECTOR_SUBTYPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="field" style={{ width: 100 }}>
          <span>Unit €</span>
          <input
            type="number"
            min={0}
            step={0.01}
            value={value.unitPrice}
            onChange={(e) => onPatch({ unitPrice: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className="field">
        <span>Product (BOM)</span>
        <input
          value={value.productName}
          onChange={(e) => onPatch({ productName: e.target.value })}
        />
      </label>
      <div className="field-row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span>Manufacturer</span>
          <input
            value={value.manufacturerLine ?? ''}
            onChange={(e) =>
              onPatch({ manufacturerLine: e.target.value || undefined })
            }
          />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 0 }}>
          <span>Catalog code</span>
          <input
            value={value.catalogCode ?? ''}
            onChange={(e) => onPatch({ catalogCode: e.target.value || undefined })}
          />
        </label>
      </div>
      <h4 className="device-catalog-req-heading">Requirements (metrics)</h4>
      <div className="field-row">
        <label className="field">
          <span>DIN TE</span>
          <input
            type="number"
            min={0}
            step={1}
            value={req.dinTe ?? ''}
            onChange={(e) =>
              patchReq({ dinTe: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </label>
        <label className="field">
          <span>Rail mm</span>
          <input
            type="number"
            min={0}
            step={1}
            value={req.dinRailMm ?? ''}
            onChange={(e) =>
              patchReq({
                dinRailMm: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          <span>PoE W</span>
          <input
            type="number"
            min={0}
            step={1}
            value={req.poeWatts ?? ''}
            onChange={(e) =>
              patchReq({
                poeWatts: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
        <label className="field">
          <span>Eth ports</span>
          <input
            type="number"
            min={0}
            step={1}
            value={req.ethernetPorts ?? ''}
            onChange={(e) =>
              patchReq({
                ethernetPorts: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </label>
      </div>
      <KnxBusDeviceFields
        showKnxLineSelect={false}
        knxLines={[]}
        requirements={req}
        knxLineId={undefined}
        onPatchRequirements={patchReq}
        onKnxLineId={() => {}}
      />
      <label className="field check">
        <input
          type="checkbox"
          checked={Boolean(req.protectCamera)}
          onChange={(e) =>
            patchReq({ protectCamera: e.target.checked || undefined })
          }
        />
        <span>Protect / camera stack</span>
      </label>
      <label className="field check">
        <input
          type="checkbox"
          checked={Boolean(req.accessReader)}
          onChange={(e) =>
            patchReq({ accessReader: e.target.checked || undefined })
          }
        />
        <span>Access reader</span>
      </label>
      <label className="field">
        <span>Notes</span>
        <input
          value={req.notes ?? ''}
          onChange={(e) => patchReq({ notes: e.target.value || undefined })}
        />
      </label>
    </div>
  )
}

export function DeviceCatalogPanel() {
  const catalog = useProjectStore((s) => s.project.deviceCatalog ?? [])
  const addDeviceTemplate = useProjectStore((s) => s.addDeviceTemplate)
  const updateDeviceTemplate = useProjectStore((s) => s.updateDeviceTemplate)
  const removeDeviceTemplate = useProjectStore((s) => s.removeDeviceTemplate)

  const [addDraft, setAddDraft] = useState<DeviceCatalogDraft>(emptyDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<DeviceCatalogDraft>(emptyDraft)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const openEdit = useCallback((t: DeviceTemplate) => {
    setEditingId(t.id)
    setEditDraft(templateToDraft(t))
    queueMicrotask(() => dialogRef.current?.showModal())
  }, [])

  const closeDialog = useCallback(() => {
    dialogRef.current?.close()
  }, [])

  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const onDialogClose = () => setEditingId(null)
    el.addEventListener('close', onDialogClose)
    return () => el.removeEventListener('close', onDialogClose)
  }, [])

  const handleAdd = () => {
    addDeviceTemplate(draftToStorePartial(addDraft))
    setAddDraft(emptyDraft())
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    updateDeviceTemplate(editingId, draftToStorePartial(editDraft))
    closeDialog()
  }

  return (
    <div className="device-catalog-editor">
      <header className="device-catalog-header">
        <h2 className="device-catalog-title">Device catalog</h2>
        <p className="muted small device-catalog-lead">
          Define templates below, then use <strong>Device</strong> on the floor or wall tab and
          drag from the palette rail to place instances.
        </p>
      </header>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        <strong>Catalog ↔ plan:</strong> Each floor/wall mark from the palette keeps its{' '}
        <code>templateId</code>. Editing a catalog row updates every matching mark on all floors;
        deleting a catalog row removes those marks and clears rack patch links to them (you will
        be asked to confirm when instances exist).
      </p>
      <p className="muted small" style={{ margin: '0 0 8px' }}>
        <strong>Import note:</strong> Older projects without a device catalog keep all devices;
        plan marks without a template default to <strong>ceiling</strong> on the floor plan, and
        wall elevations still show existing wall devices (nothing is removed automatically).
      </p>

      <section className="device-catalog-add-block" aria-label="Add device template">
        <DeviceTemplateFields
          value={addDraft}
          onPatch={(p) => setAddDraft((d) => ({ ...d, ...p }))}
        />
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button type="button" className="btn primary" onClick={handleAdd}>
            Add to list
          </button>
        </div>
      </section>

      <h3 className="device-catalog-subheading">Templates</h3>
      {catalog.length === 0 ? (
        <p className="muted small" style={{ margin: '0 0 8px' }}>
          No templates yet — fill the form above and click Add to list, then use Device mode on
          the floor or wall tab and drag from the right-hand palette.
        </p>
      ) : (
        <ul className="device-catalog-compact-list">
          {catalog.map((t) => {
            const subtitle = templatePaletteSecondaryLine(t)
            return (
            <li key={t.id} className="device-catalog-compact-row">
              <div className="device-catalog-compact-main">
                <span className="device-catalog-compact-name">{templatePalettePrimaryLine(t)}</span>
                <span className="muted small device-catalog-compact-meta">
                  {deviceTypeRollupLabel(t.type, t.connectorSubtype)} · {t.mounting} · €
                  {Number(t.unitPrice).toFixed(2)}
                  {subtitle ? ` · ${subtitle}` : ''}
                </span>
              </div>
              <div className="device-catalog-compact-actions">
                <button type="button" className="btn secondary" onClick={() => openEdit(t)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => removeDeviceTemplate(t.id)}
                >
                  Remove
                </button>
              </div>
            </li>
            )
          })}
        </ul>
      )}

      <dialog
        ref={dialogRef}
        className="device-catalog-edit-dialog"
        aria-labelledby="device-catalog-edit-title"
      >
        <div className="device-catalog-edit-dialog-inner">
          <h2 id="device-catalog-edit-title" className="device-catalog-edit-title">
            Edit template
          </h2>
          <DeviceTemplateFields
            value={editDraft}
            onPatch={(p) => setEditDraft((d) => ({ ...d, ...p }))}
          />
          <div className="device-catalog-edit-actions">
            <button type="button" className="btn primary" onClick={handleSaveEdit}>
              Save
            </button>
            <button type="button" className="btn ghost" onClick={closeDialog}>
              Cancel
            </button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
