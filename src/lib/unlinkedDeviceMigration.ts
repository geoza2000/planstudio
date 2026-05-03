import { nanoid } from 'nanoid'
import { defaultBillableFields } from './billable'
import {
  syncFloorDeviceWithTemplate,
  syncWallMountDeviceWithTemplate,
} from './deviceCatalogInstanceSync'
import {
  templateAllowsPlanMounting,
  templateAllowsWallMounting,
  templateById,
  templatePalettePrimaryLine,
} from './deviceCatalog'
import type {
  ConnectorSubtype,
  DeviceTemplate,
  DeviceTemplateMounting,
  DeviceType,
  FloorDevice,
  FloorLevel,
  Id,
  PlanstudioProject,
  WallMountDevice,
} from '../types/project'
import { deviceHoverLabel, deviceTypeRollupLabel } from '../types/project'

export type UnlinkedPlanWallRow =
  | {
      surface: 'floor'
      floorLevelId: Id
      floorLabel: string
      deviceId: Id
      label: string
      type: DeviceType
      connectorSubtype?: ConnectorSubtype
      /** Current `templateId` when set (missing in catalog, wrong mounting, or valid with stale copied fields). */
      staleTemplateId?: Id
    }
  | {
      surface: 'wall'
      floorLevelId: Id
      floorLabel: string
      wallSheetId: Id
      wallLabel: string
      deviceId: Id
      label: string
      type: DeviceType
      connectorSubtype?: ConnectorSubtype
      /** Same as floor branch: current `templateId` when set. */
      staleTemplateId?: Id
    }

/** True if the mark needs import migration: no template id, or id not present in `deviceCatalog`. */
export function planWallDeviceNeedsCatalogMigration(
  project: PlanstudioProject,
  templateId: string | undefined,
): boolean {
  const tid = templateId?.trim()
  if (!tid) return true
  return !(project.deviceCatalog ?? []).some((t) => t.id === tid)
}

function norm(s: string | undefined): string {
  return (s ?? '').trim().toLowerCase()
}

/**
 * Instance label/product line matches how we identify the template in the UI, so only type/req/etc.
 * need comparing (avoids migration spam when the catalog uses a different display name than the
 * product line but the mark matches the product).
 */
function instanceIdentityAlignedWithTemplate(
  d: {
    label: string
    productName: string
    type: DeviceType
    connectorSubtype?: ConnectorSubtype
  },
  tmpl: DeviceTemplate,
): boolean {
  const hl = norm(deviceHoverLabel(d))
  const primary = norm(templatePalettePrimaryLine(tmpl))
  const disp = norm(tmpl.displayName)
  const prod = norm(tmpl.productName)
  return (
    hl === primary ||
    hl === disp ||
    hl === prod ||
    norm(d.productName) === prod ||
    norm(d.label) === disp ||
    norm(d.label) === prod
  )
}

function stableStringify(v: unknown): string {
  if (v === undefined) return '__undef__'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`
}

function floorCatalogTechnicalEquals(a: FloorDevice, b: FloorDevice): boolean {
  return (
    stableStringify(floorCatalogTechnicalSlice(a)) === stableStringify(floorCatalogTechnicalSlice(b))
  )
}

function floorCatalogFullEquals(a: FloorDevice, b: FloorDevice): boolean {
  return (
    stableStringify({ ...floorCatalogTechnicalSlice(a), label: a.label }) ===
    stableStringify({ ...floorCatalogTechnicalSlice(b), label: b.label })
  )
}

function floorCatalogTechnicalSlice(d: FloorDevice) {
  return {
    type: d.type,
    productName: d.productName,
    unitPrice: d.unitPrice,
    billCategory: d.billCategory,
    connectorSubtype: d.connectorSubtype ?? null,
    requirements: d.requirements,
  }
}

function wallCatalogTechnicalSlice(d: WallMountDevice) {
  return {
    type: d.type,
    productName: d.productName,
    unitPrice: d.unitPrice,
    billCategory: d.billCategory,
    connectorSubtype: d.connectorSubtype ?? null,
    requirements: d.requirements,
  }
}

function wallCatalogTechnicalEquals(a: WallMountDevice, b: WallMountDevice): boolean {
  return (
    stableStringify(wallCatalogTechnicalSlice(a)) === stableStringify(wallCatalogTechnicalSlice(b))
  )
}

function wallCatalogFullEquals(a: WallMountDevice, b: WallMountDevice): boolean {
  return (
    stableStringify({ ...wallCatalogTechnicalSlice(a), label: a.label }) ===
    stableStringify({ ...wallCatalogTechnicalSlice(b), label: b.label })
  )
}

/** Linked template exists and mounting is OK, but copied fields still differ from the catalog row. */
export function floorDeviceInstanceDriftsFromTemplate(
  project: PlanstudioProject,
  d: FloorDevice,
): boolean {
  if (planWallDeviceNeedsCatalogMigration(project, d.templateId)) return false
  const tmpl = templateById(project.deviceCatalog ?? [], d.templateId)
  if (!tmpl || !templateAllowsPlanMounting(tmpl.mounting)) return false
  const synced = syncFloorDeviceWithTemplate(d, tmpl)
  if (instanceIdentityAlignedWithTemplate(d, tmpl)) {
    return !floorCatalogTechnicalEquals(d, synced)
  }
  return !floorCatalogFullEquals(d, synced)
}

export function wallDeviceInstanceDriftsFromTemplate(
  project: PlanstudioProject,
  w: WallMountDevice,
): boolean {
  if (planWallDeviceNeedsCatalogMigration(project, w.templateId)) return false
  const tmpl = templateById(project.deviceCatalog ?? [], w.templateId)
  if (!tmpl || !templateAllowsWallMounting(tmpl.mounting)) return false
  const synced = syncWallMountDeviceWithTemplate(w, tmpl)
  if (instanceIdentityAlignedWithTemplate(w, tmpl)) {
    return !wallCatalogTechnicalEquals(w, synced)
  }
  return !wallCatalogFullEquals(w, synced)
}

/** Missing/ghost `templateId`, mounting mismatch, or instance copy out of sync with the template. */
export function floorPlanMarkNeedsCatalogResolution(
  project: PlanstudioProject,
  d: FloorDevice,
): boolean {
  if (planWallDeviceNeedsCatalogMigration(project, d.templateId)) return true
  const t = templateById(project.deviceCatalog ?? [], d.templateId)
  if (!t) return true
  if (!templateAllowsPlanMounting(t.mounting)) return true
  return floorDeviceInstanceDriftsFromTemplate(project, d)
}

/** Missing/ghost `templateId`, mounting mismatch, or instance copy out of sync with the template. */
export function wallElevationMarkNeedsCatalogResolution(
  project: PlanstudioProject,
  w: WallMountDevice,
): boolean {
  if (planWallDeviceNeedsCatalogMigration(project, w.templateId)) return true
  const t = templateById(project.deviceCatalog ?? [], w.templateId)
  if (!t) return true
  if (!templateAllowsWallMounting(t.mounting)) return true
  return wallDeviceInstanceDriftsFromTemplate(project, w)
}

/** Row has a catalog id that still exists and fits the surface — one-click re-sync without changing `templateId`. */
export function rowAllowsResyncFromLinkedCatalog(
  project: PlanstudioProject,
  row: UnlinkedPlanWallRow,
): boolean {
  const tid = row.staleTemplateId?.trim()
  if (!tid) return false
  if (planWallDeviceNeedsCatalogMigration(project, tid)) return false
  const t = templateById(project.deviceCatalog ?? [], tid)
  if (!t) return false
  if (row.surface === 'floor') return templateAllowsPlanMounting(t.mounting)
  return templateAllowsWallMounting(t.mounting)
}

export function unlinkedRowKey(row: UnlinkedPlanWallRow): string {
  if (row.surface === 'floor') {
    return `floor:${row.floorLevelId}:${row.deviceId}`
  }
  return `wall:${row.floorLevelId}:${row.wallSheetId}:${row.deviceId}`
}

export function listUnlinkedPlanWallDevices(p: PlanstudioProject): UnlinkedPlanWallRow[] {
  const out: UnlinkedPlanWallRow[] = []
  for (const fl of p.floors) {
    for (const d of fl.plan.devices) {
      if (floorPlanMarkNeedsCatalogResolution(p, d)) {
        const tid = d.templateId?.trim()
        out.push({
          surface: 'floor',
          floorLevelId: fl.id,
          floorLabel: fl.label,
          deviceId: d.id,
          label: d.label,
          type: d.type,
          ...(d.type === 'connector' ? { connectorSubtype: d.connectorSubtype } : {}),
          ...(tid ? { staleTemplateId: tid } : {}),
        })
      }
    }
    for (const ws of fl.wallSheets) {
      for (const w of ws.devices) {
        if (wallElevationMarkNeedsCatalogResolution(p, w)) {
          const tid = w.templateId?.trim()
          out.push({
            surface: 'wall',
            floorLevelId: fl.id,
            floorLabel: fl.label,
            wallSheetId: ws.id,
            wallLabel: ws.label,
            deviceId: w.id,
            label: w.label,
            type: w.type,
            ...(w.type === 'connector' ? { connectorSubtype: w.connectorSubtype } : {}),
            ...(tid ? { staleTemplateId: tid } : {}),
          })
        }
      }
    }
  }
  return out
}

export type UnlinkedPlanWallCluster = {
  clusterKey: string
  /** Shared mark label (or type rollup if label empty). */
  groupLabel: string
  rows: UnlinkedPlanWallRow[]
}

/**
 * Collapse migration rows that share the same surface, mark label, optional `templateId`, and device
 * kind so the modal shows one line per distinct problem shape instead of one per mark.
 */
export function clusterUnlinkedPlanWallDevices(rows: UnlinkedPlanWallRow[]): UnlinkedPlanWallCluster[] {
  const m = new Map<string, UnlinkedPlanWallRow[]>()
  for (const row of rows) {
    const labelKey = norm(row.label) || '__unnamed__'
    const tidKey = norm(row.staleTemplateId) || '__no_template__'
    const sub = row.type === 'connector' ? (row.connectorSubtype ?? '') : ''
    const clusterKey = `${row.surface}\x1f${labelKey}\x1f${tidKey}\x1f${row.type}\x1f${sub}`
    const arr = m.get(clusterKey)
    if (arr) arr.push(row)
    else m.set(clusterKey, [row])
  }
  const clusters: UnlinkedPlanWallCluster[] = [...m.entries()].map(([clusterKey, rs]) => {
    const first = rs[0]!
    const groupLabel =
      first.label.trim() || deviceTypeRollupLabel(first.type, first.connectorSubtype)
    return { clusterKey, groupLabel, rows: rs }
  })
  clusters.sort((a, b) => {
    const na = a.groupLabel.toLowerCase()
    const nb = b.groupLabel.toLowerCase()
    if (na !== nb) return na.localeCompare(nb)
    return b.rows.length - a.rows.length
  })
  return clusters
}

function findFloorDevice(fl: FloorLevel, id: Id): FloorDevice | undefined {
  return fl.plan.devices.find((d) => d.id === id)
}

function findWallDevice(fl: FloorLevel, wallDevId: Id): { wsId: Id; dev: WallMountDevice } | undefined {
  for (const ws of fl.wallSheets) {
    const w = ws.devices.find((d) => d.id === wallDevId)
    if (w) return { wsId: ws.id, dev: w }
  }
  return undefined
}

function inferMountingForTemplateFromFloor(d: FloorDevice): DeviceTemplateMounting {
  if (d.mounting === 'wall') return 'wall'
  if (d.mounting === 'floor') return 'both'
  return 'ceiling'
}

function inferMountingForTemplateFromWall(
  w: WallMountDevice,
  fl: FloorLevel,
): DeviceTemplateMounting {
  if (w.linkedFloorDeviceId) {
    const fd = findFloorDevice(fl, w.linkedFloorDeviceId)
    if (fd) return inferMountingForTemplateFromFloor(fd)
  }
  return 'wall'
}

export function buildDeviceTemplateFromFloorInstance(d: FloorDevice): Omit<DeviceTemplate, 'id'> {
  const type = d.type
  const connectorSubtype: ConnectorSubtype | undefined =
    type === 'connector' ? (d.connectorSubtype ?? 'ethernet') : undefined
  const displayName = d.label.trim() || deviceTypeRollupLabel(type, connectorSubtype)
  const mounting = inferMountingForTemplateFromFloor(d)
  const bill = defaultBillableFields({
    productName: d.productName?.trim() || displayName,
    unitPrice: d.unitPrice,
  })
  return {
    displayName,
    type,
    mounting,
    ...(type === 'connector' ? { connectorSubtype } : {}),
    requirements: d.requirements,
    manufacturerLine: undefined,
    catalogCode: undefined,
    ...bill,
    billCategory: d.billCategory,
  }
}

export function buildDeviceTemplateFromWallInstance(
  w: WallMountDevice,
  fl: FloorLevel,
): Omit<DeviceTemplate, 'id'> {
  const type = w.type
  const connectorSubtype: ConnectorSubtype | undefined =
    type === 'connector' ? (w.connectorSubtype ?? 'ethernet') : undefined
  const displayName = w.label.trim() || deviceTypeRollupLabel(type, connectorSubtype)
  const mounting = inferMountingForTemplateFromWall(w, fl)
  const bill = defaultBillableFields({
    productName: w.productName?.trim() || displayName,
    unitPrice: w.unitPrice,
  })
  return {
    displayName,
    type,
    mounting,
    ...(type === 'connector' ? { connectorSubtype } : {}),
    requirements: w.requirements,
    manufacturerLine: undefined,
    catalogCode: undefined,
    ...bill,
    billCategory: w.billCategory,
  }
}

/** Append a new catalog row and link + sync the floor plan device (and linked wall mirror if any). */
export function createCatalogTemplateFromFloorDeviceAndLink(
  project: PlanstudioProject,
  floorLevelId: Id,
  deviceId: Id,
): PlanstudioProject {
  const fl = project.floors.find((f) => f.id === floorLevelId)
  const d = fl ? findFloorDevice(fl, deviceId) : undefined
  if (!fl || !d) return project
  const id = nanoid()
  const partial = buildDeviceTemplateFromFloorInstance(d)
  const tmpl: DeviceTemplate = { id, ...partial }
  const catalog = [...(project.deviceCatalog ?? []), tmpl]
  let next: PlanstudioProject = { ...project, deviceCatalog: catalog }
  next = assignExistingCatalogTemplateToFloorDevice(next, floorLevelId, deviceId, id)
  return next
}

/** Append a new catalog row and link + sync the wall device (and linked floor mark if any). */
export function createCatalogTemplateFromWallDeviceAndLink(
  project: PlanstudioProject,
  floorLevelId: Id,
  wallSheetId: Id,
  deviceId: Id,
): PlanstudioProject {
  const fl = project.floors.find((f) => f.id === floorLevelId)
  const ws = fl?.wallSheets.find((w) => w.id === wallSheetId)
  const w = ws?.devices.find((d) => d.id === deviceId)
  if (!fl || !w) return project
  const id = nanoid()
  const partial = buildDeviceTemplateFromWallInstance(w, fl)
  const tmpl: DeviceTemplate = { id, ...partial }
  const catalog = [...(project.deviceCatalog ?? []), tmpl]
  let next: PlanstudioProject = { ...project, deviceCatalog: catalog }
  next = assignExistingCatalogTemplateToWallDevice(next, floorLevelId, wallSheetId, deviceId, id)
  return next
}

export function assignExistingCatalogTemplateToFloorDevice(
  project: PlanstudioProject,
  floorLevelId: Id,
  deviceId: Id,
  templateId: Id,
): PlanstudioProject {
  const tmpl = project.deviceCatalog?.find((t) => t.id === templateId)
  if (!tmpl) return project
  return {
    ...project,
    floors: project.floors.map((fl) => {
      if (fl.id !== floorLevelId) return fl
      const d = findFloorDevice(fl, deviceId)
      if (!d) return fl
      const syncedFloor = syncFloorDeviceWithTemplate({ ...d, templateId }, tmpl)
      let wallSheets = fl.wallSheets
      if (d.linkedWallDeviceId) {
        const hit = findWallDevice(fl, d.linkedWallDeviceId)
        if (hit) {
          wallSheets = fl.wallSheets.map((ws) =>
            ws.id !== hit.wsId
              ? ws
              : {
                  ...ws,
                  devices: ws.devices.map((w) =>
                    w.id === hit.dev.id
                      ? syncWallMountDeviceWithTemplate({ ...w, templateId }, tmpl)
                      : w,
                  ),
                },
          )
        }
      }
      return {
        ...fl,
        plan: {
          ...fl.plan,
          devices: fl.plan.devices.map((x) => (x.id === deviceId ? syncedFloor : x)),
        },
        wallSheets,
      }
    }),
  }
}

export function assignExistingCatalogTemplateToWallDevice(
  project: PlanstudioProject,
  floorLevelId: Id,
  wallSheetId: Id,
  deviceId: Id,
  templateId: Id,
): PlanstudioProject {
  const tmpl = project.deviceCatalog?.find((t) => t.id === templateId)
  if (!tmpl) return project
  return {
    ...project,
    floors: project.floors.map((fl) => {
      if (fl.id !== floorLevelId) return fl
      const ws = fl.wallSheets.find((w) => w.id === wallSheetId)
      const w = ws?.devices.find((d) => d.id === deviceId)
      if (!ws || !w) return fl
      const syncedWall = syncWallMountDeviceWithTemplate({ ...w, templateId }, tmpl)
      let plan = fl.plan
      if (w.linkedFloorDeviceId) {
        const fd = findFloorDevice(fl, w.linkedFloorDeviceId)
        if (fd) {
          plan = {
            ...fl.plan,
            devices: fl.plan.devices.map((d) =>
              d.id === fd.id ? syncFloorDeviceWithTemplate({ ...d, templateId }, tmpl) : d,
            ),
          }
        }
      }
      return {
        ...fl,
        plan,
        wallSheets: fl.wallSheets.map((x) =>
          x.id !== wallSheetId
            ? x
            : {
                ...x,
                devices: x.devices.map((d) => (d.id === deviceId ? syncedWall : d)),
              },
        ),
      }
    }),
  }
}
