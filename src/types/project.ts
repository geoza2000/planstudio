/** Current persisted project schema. v14: auto-rooms from wall cycles; per-room wall faces with shared openings. */
export const SCHEMA_VERSION = 14 as const
/** Oldest `schemaVersion` this build loads (inclusive). */
export const MIN_SUPPORTED_SCHEMA_VERSION = 13 as const

export type FloorDeviceMounting = 'floor' | 'ceiling' | 'wall'

export type Id = string

export type ConnectorSubtype = 'ethernet' | 'fiber'

/** Persisted device taxonomy (snake_case). Icon + defaults key off `type` and `connectorSubtype`. */
export type DeviceType =
  | 'light'
  | 'outlet'
  | 'switch'
  | 'motion_sensor'
  | 'connector'
  | 'camera'
  | 'access_reader'
  | 'access_point'
  | 'generic_eth_device'
  | 'generic_power_device'

export const DEVICE_TYPES: DeviceType[] = [
  'light',
  'outlet',
  'switch',
  'motion_sensor',
  'connector',
  'camera',
  'access_reader',
  'access_point',
  'generic_eth_device',
  'generic_power_device',
]

export const CONNECTOR_SUBTYPES: ConnectorSubtype[] = ['ethernet', 'fiber']

/** BOM / inspector short label (includes connector subtype when relevant). */
export function deviceTypeRollupLabel(
  type: DeviceType,
  connectorSubtype?: ConnectorSubtype,
): string {
  if (type === 'connector') {
    const s = connectorSubtype === 'fiber' ? 'fiber' : 'ethernet'
    return `connector · ${s}`
  }
  if (type === 'switch') return 'Switch'
  if (type === 'motion_sensor') return 'Motion sensor'
  return type
}

/** KNX (TP/IP) bus partition — plan devices and DIN slots attach here for documentation / counts. */
export interface KnxLine {
  id: Id
  label: string
  sortOrder: number
}

/**
 * What kind of bus-side panel endpoint this device implies (DIN module / channel planning).
 * Distinct from manufacturer — same roles apply when switching from BTicino-style bus to KNX.
 */
export type KnxChannelRole = 'output_actuator' | 'binary_input' | 'bus_sensor'

export const KNX_CHANNEL_ROLES: KnxChannelRole[] = [
  'output_actuator',
  'binary_input',
  'bus_sensor',
]

export function knxChannelRoleLabel(role: KnxChannelRole): string {
  switch (role) {
    case 'output_actuator':
      return 'Output / actuator (load)'
    case 'binary_input':
      return 'Binary input (switch)'
    case 'bus_sensor':
      return 'Bus sensor (e.g. motion)'
  }
}

/** Floor / wall plan hover: custom label, else product name, else `deviceTypeRollupLabel`. */
export function deviceHoverLabel(d: {
  label: string
  productName: string
  type: DeviceType
  connectorSubtype?: ConnectorSubtype
}): string {
  const t = d.label.trim()
  if (t.length > 0) return t
  const p = d.productName.trim()
  if (p.length > 0) return p
  return deviceTypeRollupLabel(d.type, d.connectorSubtype)
}

export type PanelModuleType = 'spare' | 'mcb' | 'rcd' | 'surge' | 'blank'

export type BillCategory = 'standard' | 'cable' | 'wall_box'

export type RegionKind = 'room' | 'patio' | 'other'

export type BillableProduct = {
  productName: string
  unitPrice: number
  /** Kept for JSON compatibility; always normalized to `standard` on load and in defaults. */
  billCategory: BillCategory
}

export interface PointM {
  x: number
  y: number
}

export interface WallSegment {
  id: Id
  a: PointM
  b: PointM
}

/** Structured loads / infrastructure hints (editable); used in requirements rollup. */
export interface DeviceRequirements {
  dinRailMm?: number
  dinTe?: number
  /** DIN / logical channel on the building automation bus (KNX, etc.). */
  knxChannelRole?: KnxChannelRole
  poeWatts?: number
  ethernetPorts?: number
  protectCamera?: boolean
  accessReader?: boolean
  notes?: string
}

export interface FloorDevice extends BillableProduct {
  id: Id
  type: DeviceType
  /** Required when `type === 'connector'` (defaults to `ethernet` on load if missing). */
  connectorSubtype?: ConnectorSubtype
  label: string
  x: number
  y: number
  circuitRef: string
  /** When set, instance tracks this `deviceCatalog` row: edits to the template sync here; deleting the template removes this mark (all floors). */
  templateId?: Id
  requirements?: DeviceRequirements
  /** Which project `knxLines` segment this device belongs to (optional). */
  knxLineId?: Id
  /** Wall-mount device on a wall sheet (same product as this floor mark) */
  linkedWallDeviceId?: Id
  /**
   * Where the device sits vertically (plan icon is still 2D).
   * Plan tool defaults to `ceiling`; older files may omit or use `floor`.
   */
  mounting?: FloorDeviceMounting
  /** Used when `mounting === 'ceiling'` (m above floor). */
  ceilingHeightM?: number
}

export interface PlanRegion {
  id: Id
  kind: RegionKind
  label: string
  /** Closed polygon in meters (≥ 3 vertices, first != last in storage) */
  vertices: PointM[]
  /**
   * When set, this region is auto-derived from a closed cycle of plan wall segments.
   * Sorted, joined ids of the bounding wall segments. Used to match regions across
   * topology recomputes so user labels survive wall edits.
   */
  wallCycleSignature?: string
  /**
   * When set, this auto-room lies inside another room’s polygon (e.g. alcove). Derived
   * on each topology reconcile from geometry; not user-edited.
   */
  parentRegionId?: Id
}

export interface FloorPlan {
  label: string
  /** Minimum working size (m); viewport auto-expands with geometry */
  widthM: number
  depthM: number
  wallSegments: WallSegment[]
  devices: FloorDevice[]
  regions: PlanRegion[]
}

export interface WallMountDevice extends BillableProduct {
  id: Id
  type: DeviceType
  connectorSubtype?: ConnectorSubtype
  label: string
  xM: number
  zM: number
  circuitRef: string
  /** When set, instance tracks this `deviceCatalog` row: edits to the template sync here; deleting the template removes this mark (all floors). */
  templateId?: Id
  requirements?: DeviceRequirements
  knxLineId?: Id
  /** If set, same billable as this floor device — BOM counts floor row only */
  linkedFloorDeviceId?: Id
}

export type WallOpeningKind = 'door' | 'window'

/** Non-billable opening on a wall elevation. `xM` = center along wall, `zM` = center height from floor (m). */
export interface WallOpening {
  id: Id
  kind: WallOpeningKind
  xM: number
  zM: number
  widthM: number
  heightM: number
  label?: string
  /**
   * Plan-linked grouped walls: opening center on the parent segment as fraction from `a`
   * (0) to `b` (1). Keeps one physical door aligned on every room face when chord lengths differ.
   */
  planAlongSeg01?: number
}

export interface WallSheet {
  id: Id
  floorLevelId: Id
  label: string
  lengthM: number
  heightM: number
  devices: WallMountDevice[]
  /** Doors/windows on the elevation; mirrored to the plan when `wallSegmentId` is set. */
  openings: WallOpening[]
  /** When set, this elevation is tied 1:1 to a `plan.wallSegments` entry (same floor). */
  wallSegmentId?: Id
  /**
   * Which room this wall *face* belongs to. A physical wall between two rooms produces
   * two sheets sharing a `wallSegmentId` but with different `roomRegionId`s — each is an
   * independently editable face (devices). Openings sync across faces only when
   * `openingsGroupId` matches (see topology reconcile for paired vs split groups).
   * Unset → orphan sheet (wall not on any room boundary, or no rooms detected yet).
   */
  roomRegionId?: Id
  /**
   * Which face of the directed segment this sheet describes ('a' = left of a→b, 'b' = right).
   * Used by the renderer to offset paired faces and to reconcile sheets after geometry edits.
   */
  wallFace?: 'a' | 'b'
  /**
   * Stable id for syncing a `WallOpening` across **paired opposite faces** of one wall
   * (exactly one `a` and one `b` sheet on the segment). On T-junctions / several chords
   * per segment, each sheet gets its own group; see `reconcileFloorWallTopology`.
   */
  openingsGroupId?: Id
  /**
   * This sheet’s plan wall is the `[t0,t1]` sub-interval of the parent segment (0 = `a`, 1 = `b`).
   * `lengthM` is the chord length for that span.
   */
  planSpanAlongSegment01?: { t0: number; t1: number }
}

export interface FloorLevel {
  id: Id
  label: string
  sortOrder: number
  plan: FloorPlan
  wallSheets: WallSheet[]
}

export interface PanelSlot extends BillableProduct {
  id: Id
  row: number
  col: number
  moduleType: PanelModuleType
  label: string
  ratingA?: number
  circuitRef: string
  /** Width in TE; >1 merges cells to the right (those cells set `spanAnchorId`). */
  spanWidthTe: number
  /** If set, this grid cell is covered by the anchor slot to the left (same row). */
  spanAnchorId?: Id
  manufacturerLine?: string
  description?: string
  /** Optional dedicated DIN rail segment length (mm) */
  dinRailSegmentMm?: number
  /** Alternative: rail length consumed by this module (mm) */
  railConsumeMm?: number
  /** Optional: which KNX / bus line this DIN module serves. */
  knxLineId?: Id
}

/**
 * Prototype row for the panel material list (no grid coordinates).
 * Dropping onto a cell creates a new on-grid module (new ids; template unchanged).
 */
export type PanelModuleTemplate = Pick<
  PanelSlot,
  | 'label'
  | 'moduleType'
  | 'manufacturerLine'
  | 'description'
  | 'ratingA'
  | 'dinRailSegmentMm'
  | 'railConsumeMm'
  | 'knxLineId'
  | 'billCategory'
> & {
  id: Id
  spanWidthTe: number
  productName: string
  unitPrice: number
  circuitRef: string
}

export interface PanelBoard {
  rows: number
  /** Enclosure width in TE (17.5 mm per TE horizontally). */
  widthTe: number
  slots: PanelSlot[]
  /** User-defined modules; drag a row from the Panel tab onto the grid to place a copy. */
  modulePalette: PanelModuleTemplate[]
}

/** Where a catalog template may be placed; `both` appears in floor + wall palettes. */
export type DeviceTemplateMounting = 'wall' | 'ceiling' | 'both'

/**
 * Central device catalog (templates). Plan/wall marks store `templateId` and stay in sync
 * when this row is edited; removing a row deletes all matching instances on every floor.
 */
export interface DeviceTemplate extends BillableProduct {
  id: Id
  displayName: string
  type: DeviceType
  connectorSubtype?: ConnectorSubtype
  mounting: DeviceTemplateMounting
  requirements?: DeviceRequirements
  manufacturerLine?: string
}

export type RackPortKind = 'rj45' | 'sfp'

/** One end of a generic rack port-to-port cable (`rack.portLinks`). */
export interface RackPortEndpoint {
  gearId: Id
  portKind: RackPortKind
  /** Zero-based index within that kind on the gear. */
  portIndex: number
}

/** Gear-to-gear logical cable in the rack elevation (separate from plan→patch `patchPanelLinks`). */
export interface RackPortLink {
  id: Id
  from: RackPortEndpoint
  to: RackPortEndpoint
}

export interface RackGear extends BillableProduct {
  id: Id
  startRU: number
  heightRU: number
  notes: string
  /** Count of copper-style ports shown on the elevation; default 0 when omitted in JSON. */
  rj45PortCount?: number
  /** Count of SFP-style ports shown on the elevation; default 0 when omitted in JSON. */
  sfpPortCount?: number
}

/**
 * Maps a plan or wall Ethernet-class device to a logical patch-port label on the rack field.
 * Physical patch panels remain `RackGear` rows; this links drops to port names for documentation.
 */
export interface RackPatchPanelLink {
  deviceId: Id
  patchLabel: string
}

export interface RackFrame {
  totalRU: number
  widthLabel: string
  /** BOM line for the rack cabinet / frame (not mounted modules). */
  enclosureProductName: string
  enclosureUnitPrice: number
  enclosureBillCategory: BillCategory
  gear: RackGear[]
  /** Logical patch-field labels keyed by plan/wall `deviceId` (see `RackPatchPanelLink`). */
  patchPanelLinks: RackPatchPanelLink[]
  /** Generic gear-to-gear port cables on the rack canvas (RJ45 / SFP geometry in the editor). */
  portLinks: RackPortLink[]
}

/** Floor-plan editor preferences (persisted with the project). */
export interface EditorSettings {
  snapGridM: number
  wallOrtho: boolean
}

export interface PlanstudioProject {
  schemaVersion: typeof SCHEMA_VERSION
  name: string
  updatedAt: string
  floors: FloorLevel[]
  /** Logical KNX / TP lines (name freely — e.g. per apartment + common). */
  knxLines: KnxLine[]
  panel: PanelBoard
  rack: RackFrame
  editorSettings: EditorSettings
  /** Reusable device definitions for drag-from-palette placement on plan and wall. */
  deviceCatalog: DeviceTemplate[]
}

export type EditorTab = 'floor' | 'wall' | 'panel' | 'rack' | 'devices'

export type FloorTool = 'select' | 'wall' | 'region' | 'opening'
