import { mergeRequirementsWithDeviceTypeDefaults } from './requirementDefaults'
import type {
  ConnectorSubtype,
  DeviceTemplate,
  FloorDevice,
  FloorLevel,
  Id,
  PlanstudioProject,
  WallMountDevice,
} from '../types/project'

/** Fields copied from catalog onto every placed instance when the template changes. */
export function syncFloorDeviceWithTemplate(d: FloorDevice, tmpl: DeviceTemplate): FloorDevice {
  const devType = tmpl.type
  const connectorSubtype: ConnectorSubtype | undefined =
    devType === 'connector' ? (tmpl.connectorSubtype ?? 'ethernet') : undefined
  const requirements = mergeRequirementsWithDeviceTypeDefaults(
    devType,
    tmpl.requirements,
    connectorSubtype,
  )
  const label = tmpl.displayName?.trim() ? tmpl.displayName : String(devType)
  const next: FloorDevice = {
    ...d,
    type: devType,
    label,
    productName: tmpl.productName,
    unitPrice: tmpl.unitPrice,
    billCategory: tmpl.billCategory,
    requirements,
  }
  if (devType === 'connector') {
    next.connectorSubtype = connectorSubtype ?? 'ethernet'
  } else {
    delete next.connectorSubtype
  }
  return next
}

export function syncWallMountDeviceWithTemplate(
  d: WallMountDevice,
  tmpl: DeviceTemplate,
): WallMountDevice {
  const devType = tmpl.type
  const connectorSubtype: ConnectorSubtype | undefined =
    devType === 'connector' ? (tmpl.connectorSubtype ?? 'ethernet') : undefined
  const requirements = mergeRequirementsWithDeviceTypeDefaults(
    devType,
    tmpl.requirements,
    connectorSubtype,
  )
  const label = tmpl.displayName?.trim() ? tmpl.displayName : String(devType)
  const next: WallMountDevice = {
    ...d,
    type: devType,
    label,
    productName: tmpl.productName,
    unitPrice: tmpl.unitPrice,
    billCategory: tmpl.billCategory,
    requirements,
  }
  if (devType === 'connector') {
    next.connectorSubtype = connectorSubtype ?? 'ethernet'
  } else {
    delete next.connectorSubtype
  }
  return next
}

function stripDevicesAndLinksForRemovedSet(fl: FloorLevel, removed: Set<Id>): FloorLevel {
  const planDevices = fl.plan.devices
    .filter((d) => !removed.has(d.id))
    .map((d) => ({
      ...d,
      linkedWallDeviceId:
        d.linkedWallDeviceId && removed.has(d.linkedWallDeviceId)
          ? undefined
          : d.linkedWallDeviceId,
    }))
  const wallSheets = fl.wallSheets.map((ws) => ({
    ...ws,
    devices: ws.devices
      .filter((w) => !removed.has(w.id))
      .map((w) => ({
        ...w,
        linkedFloorDeviceId:
          w.linkedFloorDeviceId && removed.has(w.linkedFloorDeviceId)
            ? undefined
            : w.linkedFloorDeviceId,
      })),
  }))
  return { ...fl, plan: { ...fl.plan, devices: planDevices }, wallSheets }
}

export function countInstancesForTemplate(project: PlanstudioProject, templateId: Id): number {
  let n = 0
  for (const fl of project.floors) {
    for (const d of fl.plan.devices) {
      if (d.templateId === templateId) n += 1
    }
    for (const ws of fl.wallSheets) {
      for (const w of ws.devices) {
        if (w.templateId === templateId) n += 1
      }
    }
  }
  return n
}

/** After catalog row edit: push type, label, billable, requirements to all instances (all floors). */
export function syncProjectDevicesWithCatalogTemplate(
  project: PlanstudioProject,
  templateId: Id,
  tmpl: DeviceTemplate,
): PlanstudioProject {
  return {
    ...project,
    floors: project.floors.map((fl) => ({
      ...fl,
      plan: {
        ...fl.plan,
        devices: fl.plan.devices.map((d) =>
          d.templateId === templateId ? syncFloorDeviceWithTemplate(d, tmpl) : d,
        ),
      },
      wallSheets: fl.wallSheets.map((ws) => ({
        ...ws,
        devices: ws.devices.map((w) =>
          w.templateId === templateId ? syncWallMountDeviceWithTemplate(w, tmpl) : w,
        ),
      })),
    })),
  }
}

/**
 * Remove catalog row and every floor/wall instance with that `templateId`.
 * Clears stale floor↔wall links and drops `rack.patchPanelLinks` for removed device ids.
 */
export function applyCatalogTemplateRemoval(
  project: PlanstudioProject,
  templateId: Id,
): { project: PlanstudioProject; removedDeviceIds: Id[] } {
  const removed = new Set<Id>()
  for (const fl of project.floors) {
    for (const d of fl.plan.devices) {
      if (d.templateId === templateId) removed.add(d.id)
    }
    for (const ws of fl.wallSheets) {
      for (const w of ws.devices) {
        if (w.templateId === templateId) removed.add(w.id)
      }
    }
  }
  const removedDeviceIds = [...removed]
  const floors = project.floors.map((fl) => stripDevicesAndLinksForRemovedSet(fl, removed))
  const patchPanelLinks = project.rack.patchPanelLinks.filter((l) => !removed.has(l.deviceId))
  return {
    project: {
      ...project,
      floors,
      deviceCatalog: (project.deviceCatalog ?? []).filter((t) => t.id !== templateId),
      rack: { ...project.rack, patchPanelLinks },
    },
    removedDeviceIds,
  }
}
