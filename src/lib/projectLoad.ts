import {
  defaultBillableFields,
  defaultDeviceProductName,
  defaultPanelProductName,
} from './billable'
import { reconcilePanelSpans } from './panelSpans'
import type {
  ConnectorSubtype,
  DeviceRequirements,
  DeviceTemplate,
  DeviceType,
  FloorDevice,
  FloorLevel,
  KnxLine,
  PlanstudioProject,
  RackFrame,
  RackGear,
  RackPatchPanelLink,
  WallMountDevice,
} from '../types/project'
import { DEVICE_TYPES } from '../types/project'
import { DEFAULT_CEILING_HEIGHT_M } from './floorDeviceCluster'
import {
  MIN_SUPPORTED_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from '../types/project'
import type { RackPortEndpoint, RackPortLink } from '../types/project'
import { nanoid } from 'nanoid'
import { DEFAULT_KNX_LINES } from '../model/defaults'
import { normalizeRackPortCount, pruneInvalidPortLinks } from './rackPortLinks'

type LooseRecord = Record<string, unknown>

const DEVICE_TYPE_SET = new Set<string>(DEVICE_TYPES)

/** Schema v13+ projects must persist `type` (no legacy `kind`). */
function parseDeviceTypeStrict(loose: LooseRecord): {
  type: DeviceType
  connectorSubtype?: ConnectorSubtype
} {
  const rawNew = loose.type
  if (typeof rawNew !== 'string' || !DEVICE_TYPE_SET.has(rawNew)) {
    throw new Error(
      'Invalid project: device or device template row has missing or unsupported type (schema v13+).',
    )
  }
  const type = rawNew as DeviceType
  if (type === 'connector') {
    const cs = loose.connectorSubtype
    const connectorSubtype: ConnectorSubtype =
      cs === 'fiber' || cs === 'ethernet' ? cs : 'ethernet'
    return { type, connectorSubtype }
  }
  return { type }
}

function normalizeDeviceTypeRecord<T extends FloorDevice | WallMountDevice | DeviceTemplate>(
  row: T | LooseRecord,
): T {
  const loose = row as LooseRecord
  const { type, connectorSubtype } = parseDeviceTypeStrict(loose)
  const copy: LooseRecord = { ...(row as LooseRecord) }
  delete copy.kind
  copy.type = type
  if (type === 'connector') {
    copy.connectorSubtype = connectorSubtype ?? 'ethernet'
  } else {
    delete copy.connectorSubtype
  }
  return copy as T
}

function isRecord(x: unknown): x is LooseRecord {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Legacy `bticinoActuator` → `knxChannelRole: output_actuator` (v13). */
function migrateDeviceRequirements(
  req: DeviceRequirements | undefined,
): DeviceRequirements | undefined {
  if (!req) return undefined
  const next = { ...req } as DeviceRequirements & { bticinoActuator?: boolean }
  if (next.bticinoActuator && !next.knxChannelRole) {
    next.knxChannelRole = 'output_actuator'
  }
  delete next.bticinoActuator
  return Object.keys(next).length ? next : undefined
}

function normalizeKnxLinesRaw(raw: unknown): KnxLine[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_KNX_LINES.map((x) => ({ ...x }))
  }
  const out: KnxLine[] = []
  raw.forEach((row, i) => {
    if (!isRecord(row)) return
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : nanoid()
    const label =
      typeof row.label === 'string' && row.label.trim() ? row.label.trim() : `Line ${i + 1}`
    const sortOrder =
      typeof row.sortOrder === 'number' && Number.isFinite(row.sortOrder) ? row.sortOrder : i
    out.push({ id, label, sortOrder })
  })
  out.sort((a, b) => a.sortOrder - b.sortOrder)
  return out
}

/** Strip UTF-8 BOM so `JSON.parse` succeeds on exported Windows text. */
export function stripLeadingUtf8Bom(text: string): string {
  return text.replace(/^\uFEFF/, '')
}

/**
 * Returns `null` if `schemaVersion` is in the supported range for this build;
 * otherwise a user-facing error string.
 */
export function validateProjectSchemaVersion(schemaVersion: unknown): string | null {
  if (typeof schemaVersion !== 'number' || !Number.isInteger(schemaVersion)) {
    return 'Invalid project: schemaVersion must be an integer.'
  }
  if (schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    return `This file uses project schema v${schemaVersion}. Only project schema v${String(MIN_SUPPORTED_SCHEMA_VERSION)} through v${String(SCHEMA_VERSION)} is supported.`
  }
  if (schemaVersion > SCHEMA_VERSION) {
    return `This file uses project schema v${schemaVersion}. This build supports project schema up to v${String(SCHEMA_VERSION)}. Update Planstudio to open this file.`
  }
  return null
}

/** Quick check for file-picker UX before `normalizeProject` / `loadProject`. */
export function isProjectFile(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  return validateProjectSchemaVersion(raw.schemaVersion) === null
}

/**
 * Fills optional / partially omitted fields on a schema-current project (not version migration).
 */
export function ensureDefaultsDeep(p: PlanstudioProject): PlanstudioProject {
  const knxLines = normalizeKnxLinesRaw((p as unknown as LooseRecord).knxLines)
  const lineIds = new Set(knxLines.map((l) => l.id))

  const legacyPanel = p.panel as PlanstudioProject['panel'] & { cols?: number }
  const widthTe = Math.max(1, Math.floor(legacyPanel.widthTe ?? legacyPanel.cols ?? 18))

  const rawSlots = legacyPanel.slots.map((slot) => {
    const l = slot as unknown as {
      productName?: string
      unitPrice?: number
      spanWidthTe?: number
    }
    let next = {
      ...slot,
      spanWidthTe: l.spanWidthTe ?? 1,
      billCategory: 'standard' as const,
      knxLineId:
        typeof slot.knxLineId === 'string' && lineIds.has(slot.knxLineId)
          ? slot.knxLineId
          : undefined,
    }
    if (l.productName == null || typeof l.unitPrice !== 'number') {
      next = {
        ...next,
        productName:
          l.productName ||
          defaultPanelProductName(slot.row, slot.col, slot.moduleType, slot.label),
        unitPrice: l.unitPrice ?? 0,
      }
    }
    return next
  })

  const legacyPalette = (legacyPanel as { modulePalette?: unknown }).modulePalette
  const modulePaletteRaw: PlanstudioProject['panel']['modulePalette'] = Array.isArray(
    legacyPalette,
  )
    ? (legacyPalette as PlanstudioProject['panel']['modulePalette'])
    : []
  const modulePalette = modulePaletteRaw.map((m) => ({
    ...m,
    ...defaultBillableFields({
      productName: m.productName,
      unitPrice: m.unitPrice,
    }),
  }))

  const panel: PlanstudioProject['panel'] = {
    rows: Math.max(1, legacyPanel.rows),
    widthTe,
    slots: reconcilePanelSpans(rawSlots, widthTe),
    modulePalette,
  }

  const rawCatalog = (p as unknown as LooseRecord).deviceCatalog
  const deviceCatalog: DeviceTemplate[] = Array.isArray(rawCatalog)
    ? (rawCatalog as LooseRecord[])
        .map((r) => {
          const migrated = normalizeDeviceTypeRecord(
            r as unknown as DeviceTemplate,
          ) as unknown as LooseRecord
          const id = typeof migrated.id === 'string' ? migrated.id : ''
          const type = migrated.type as DeviceType
          const connectorSubtype = migrated.connectorSubtype as ConnectorSubtype | undefined
          const mountingRaw = r.mounting
          const mounting: DeviceTemplate['mounting'] =
            mountingRaw === 'wall' || mountingRaw === 'ceiling' || mountingRaw === 'both'
              ? mountingRaw
              : 'ceiling'
          const displayName =
            typeof r.displayName === 'string' && r.displayName.trim() !== ''
              ? r.displayName
              : type
          const bill = defaultBillableFields({
            productName:
              (typeof r.productName === 'string' && r.productName) ||
              defaultDeviceProductName(displayName, type),
            unitPrice: typeof r.unitPrice === 'number' ? r.unitPrice : 0,
          })
          const requirements = migrateDeviceRequirements(
            (r.requirements ?? undefined) as DeviceRequirements | undefined,
          )
          const next: DeviceTemplate = {
            id,
            displayName,
            type,
            ...(type === 'connector' && connectorSubtype
              ? { connectorSubtype }
              : type === 'connector'
                ? { connectorSubtype: 'ethernet' as ConnectorSubtype }
                : {}),
            mounting,
            requirements,
            manufacturerLine:
              typeof r.manufacturerLine === 'string' ? r.manufacturerLine : undefined,
            ...bill,
          }
          return next
        })
        .filter((t) => t.id.length > 0)
    : []

  const floors: FloorLevel[] = p.floors.map((fl) => ({
    ...fl,
    plan: {
      ...fl.plan,
      regions: (() => {
        const regs = fl.plan.regions ?? []
        const idSet = new Set(regs.map((r) => r.id))
        return regs.map((r) => ({
          ...r,
          parentRegionId:
            r.parentRegionId && idSet.has(r.parentRegionId) ? r.parentRegionId : undefined,
        }))
      })(),
      devices: fl.plan.devices.map((d) => {
        const migrated = normalizeDeviceTypeRecord(d as unknown as LooseRecord) as FloorDevice
        const l = migrated as unknown as {
          productName?: string
          unitPrice?: number
          templateId?: string
        }
        const rawMount = migrated.mounting
        const linked = Boolean(migrated.linkedWallDeviceId)
        /** Option B (import): untemplated plan marks default to ceiling; wall mirrors unchanged. */
        let mounting: FloorDevice['mounting']
        if (linked || rawMount === 'wall') {
          mounting = rawMount ?? 'wall'
        } else if (l.templateId) {
          mounting = rawMount ?? 'ceiling'
        } else if (rawMount === 'floor' || rawMount === undefined) {
          mounting = 'ceiling'
        } else {
          mounting = rawMount
        }
        const withMount: FloorDevice = {
          ...migrated,
          mounting,
          ...(mounting === 'ceiling' && migrated.ceilingHeightM == null
            ? { ceilingHeightM: DEFAULT_CEILING_HEIGHT_M }
            : {}),
          requirements: migrateDeviceRequirements(migrated.requirements),
          knxLineId:
            typeof migrated.knxLineId === 'string' && lineIds.has(migrated.knxLineId)
              ? migrated.knxLineId
              : undefined,
        }
        return {
          ...withMount,
          ...defaultBillableFields({
            productName: l.productName || defaultDeviceProductName(migrated.label, migrated.type),
            unitPrice: l.unitPrice ?? 0,
          }),
        }
      }),
    },
    wallSheets: fl.wallSheets.map((w) => ({
      ...w,
      openings: w.openings ?? [],
      devices: w.devices.map((d) => {
        const migrated = normalizeDeviceTypeRecord(d as unknown as LooseRecord) as WallMountDevice
        const l = migrated as unknown as {
          productName?: string
          unitPrice?: number
        }
        return {
          ...migrated,
          ...defaultBillableFields({
            productName: l.productName || defaultDeviceProductName(migrated.label, migrated.type),
            unitPrice: l.unitPrice ?? 0,
          }),
          requirements: migrateDeviceRequirements(migrated.requirements),
          knxLineId:
            typeof migrated.knxLineId === 'string' && lineIds.has(migrated.knxLineId)
              ? migrated.knxLineId
              : undefined,
        }
      }),
    })),
  }))

  const r = p.rack as RackFrame & {
    enclosureProductName?: string
    enclosureUnitPrice?: unknown
  }
  const enclosureProductName =
    typeof r.enclosureProductName === 'string' && r.enclosureProductName.trim() !== ''
      ? r.enclosureProductName
      : 'Rack enclosure'
  const enclosureUnitPrice =
    typeof r.enclosureUnitPrice === 'number' && !Number.isNaN(r.enclosureUnitPrice)
      ? r.enclosureUnitPrice
      : 0
  const enclosureBillCategory = 'standard'

  const rawEs = (p as { editorSettings?: unknown }).editorSettings
  const looseEs = isRecord(rawEs) ? rawEs : null
  const snapRaw = looseEs?.snapGridM
  const snapGridM =
    typeof snapRaw === 'number' && Number.isFinite(snapRaw) && snapRaw >= 0.01
      ? snapRaw
      : 0.1
  const wallOrthoRaw = looseEs?.wallOrtho
  const wallOrtho = typeof wallOrthoRaw === 'boolean' ? wallOrthoRaw : true
  const editorSettings: PlanstudioProject['editorSettings'] = {
    snapGridM: Math.max(0.01, snapGridM),
    wallOrtho,
  }

  function parsePortEndpoint(x: unknown): RackPortEndpoint | null {
    if (!isRecord(x)) return null
    const gearId = typeof x.gearId === 'string' ? x.gearId : ''
    const pk = x.portKind
    if (pk !== 'rj45' && pk !== 'sfp') return null
    const portIndex =
      typeof x.portIndex === 'number' && Number.isFinite(x.portIndex)
        ? Math.floor(x.portIndex)
        : Number.NaN
    if (!Number.isInteger(portIndex) || gearId.length === 0) return null
    return { gearId, portKind: pk, portIndex }
  }

  function parsePortLinks(raw: unknown): RackPortLink[] {
    if (!Array.isArray(raw)) return []
    const out: RackPortLink[] = []
    for (const row of raw) {
      if (!isRecord(row)) continue
      const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : nanoid()
      const from = parsePortEndpoint(row.from)
      const to = parsePortEndpoint(row.to)
      if (!from || !to) continue
      out.push({ id, from, to })
    }
    return out
  }

  const rawPatchLinks = (p.rack as { patchPanelLinks?: unknown }).patchPanelLinks
  const patchPanelLinks: RackPatchPanelLink[] = Array.isArray(rawPatchLinks)
    ? rawPatchLinks
        .filter((x): x is LooseRecord => isRecord(x))
        .map((x) => ({
          deviceId: typeof x.deviceId === 'string' ? x.deviceId : '',
          patchLabel: typeof x.patchLabel === 'string' ? x.patchLabel : '',
        }))
        .filter((x) => x.deviceId.length > 0)
    : []

  const rawPortLinks = (p.rack as { portLinks?: unknown }).portLinks
  let portLinks = parsePortLinks(rawPortLinks)

  const gear: RackGear[] = p.rack.gear.map((g) => {
    const l = g as unknown as {
      name?: string
      productName?: string
      unitPrice?: number
    }
    const loose = g as unknown as LooseRecord
    const { name: _n, ...base } = g as RackGear & { name?: string }
    return {
      ...base,
      rj45PortCount: normalizeRackPortCount(loose.rj45PortCount),
      sfpPortCount: normalizeRackPortCount(loose.sfpPortCount),
      ...defaultBillableFields({
        productName: l.productName || _n || 'Rack item',
        unitPrice: l.unitPrice ?? 0,
      }),
    }
  })

  portLinks = pruneInvalidPortLinks(gear, portLinks)

  const rack: PlanstudioProject['rack'] = {
    ...p.rack,
    enclosureProductName,
    enclosureUnitPrice,
    enclosureBillCategory,
    patchPanelLinks,
    gear,
    portLinks,
  }

  return {
    ...p,
    schemaVersion: SCHEMA_VERSION,
    knxLines,
    panel,
    floors,
    rack,
    editorSettings,
    deviceCatalog,
  }
}

/**
 * Parse loaded JSON into a current-schema project, or throw with a clear message.
 * Accepts schema v13 through the current `SCHEMA_VERSION` (normalized to current shape, e.g. rack `portLinks`).
 */
export function normalizeProject(raw: unknown): PlanstudioProject {
  if (!isRecord(raw)) {
    throw new Error('Project file must be a JSON object.')
  }

  const verr = validateProjectSchemaVersion(raw.schemaVersion)
  if (verr) {
    throw new Error(verr)
  }

  if (typeof raw.name !== 'string') {
    throw new Error('Invalid project: missing or invalid name.')
  }
  if (typeof raw.updatedAt !== 'string') {
    throw new Error('Invalid project: missing or invalid updatedAt.')
  }
  if (!Array.isArray(raw.floors) || raw.floors.length === 0) {
    throw new Error('Invalid project: floors must be a non-empty array.')
  }
  if (!isRecord(raw.panel)) {
    throw new Error('Invalid project: missing panel.')
  }
  if (!Array.isArray(raw.panel.slots)) {
    throw new Error('Invalid project: panel.slots must be an array.')
  }
  if (!isRecord(raw.rack)) {
    throw new Error('Invalid project: missing rack.')
  }
  if (!Array.isArray(raw.rack.gear)) {
    throw new Error('Invalid project: rack.gear must be an array.')
  }

  const body = raw as unknown as PlanstudioProject
  return ensureDefaultsDeep(body)
}
