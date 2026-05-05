import { nanoid } from 'nanoid'
import { create } from 'zustand'
import { defaultBillableFields, defaultPanelProductName } from '../lib/billable'
import { normalizeProject } from '../lib/projectLoad'
import { canPlaceAt, maxPlaceableWidth } from '../lib/panelPlacement'
import {
  defaultRequirementsForDeviceType,
  mergeRequirementsWithDeviceTypeDefaults,
} from '../lib/requirementDefaults'
import {
  applyCatalogTemplateRemoval,
  countInstancesForTemplate,
  syncProjectDevicesWithCatalogTemplate,
} from '../lib/deviceCatalogInstanceSync'
import { emptyPanelSlot } from '../model/defaults'
import { resizePanelBoard } from '../lib/panelResize'
import { computeWallDrawB, snapMeters, snapWallPointToPlanGeometry } from '../lib/geometry'
import {
  normalizeRackGearList,
  clampRackGear,
  findNextFreeRackStartRu,
  occupiedRuSet,
  rackSlotIsFree,
} from '../lib/rackLayout'
import { portEndpointValid, pruneInvalidPortLinks } from '../lib/rackPortLinks'
import { reconcilePanelSpans } from '../lib/panelSpans'
import { DEFAULT_CEILING_HEIGHT_M } from '../lib/floorDeviceCluster'
import { worldXYForWallMirrorOnPlan } from '../lib/planWallMirrorPosition'
import {
  clearPlanLinksToWallDeviceIds,
  syncAllPlanWallSheetLabels,
  syncFloorWallsFromPlan,
  syncLinkedWallSheetLengthForSegment,
  wallSheetChordFromPlanGeometry,
} from '../lib/wallPlanSync'
import { cloneFloorWithNewIds } from '../lib/duplicateFloorLevel'
import { reconcileFloorWallTopology } from '../lib/wallRoomReconcile'
import {
  insertGroupedOpening,
  removeGroupedOpening,
  updateGroupedOpening,
} from '../lib/wallOpeningGroupSync'
import { createFloorLevel, createInitialProject } from '../model/defaults'
import { clampWallOpeningMeters, newWallOpeningMeters } from '../lib/wallOpeningDefaults'
import type {
  ConnectorSubtype,
  DeviceTemplate,
  EditorTab,
  FloorDevice,
  FloorLevel,
  Id,
  KnxLine,
  PanelModuleType,
  PanelModuleTemplate,
  PanelSlot,
  PlanRegion,
  PlanstudioProject,
  PointM,
  RackFrame,
  RackGear,
  RackPatchPanelLink,
  RackPortEndpoint,
  RegionKind,
  WallMountDevice,
  WallOpening,
  WallOpeningKind,
  WallSegment,
  WallSheet,
} from '../types/project'
import type { PanelBoard } from '../types/project'
import type { FloorTool } from '../types/project'

const HISTORY_MAX = 50

/** When true, project edits do not push onto the undo stack (used by undo/redo). */
let recordProjectHistory = true

function cloneProject(p: PlanstudioProject): PlanstudioProject {
  return structuredClone(p)
}

function withKnxLinesAndPrunedRefs(
  p: PlanstudioProject,
  knxLines: KnxLine[],
): PlanstudioProject {
  const idSet = new Set(knxLines.map((l) => l.id))
  const fix = (x: string | undefined) => (x && idSet.has(x) ? x : undefined)
  return {
    ...p,
    knxLines,
    floors: p.floors.map((fl) => ({
      ...fl,
      plan: {
        ...fl.plan,
        devices: fl.plan.devices.map((d) => ({ ...d, knxLineId: fix(d.knxLineId) })),
      },
      wallSheets: fl.wallSheets.map((w) => ({
        ...w,
        devices: w.devices.map((d) => ({ ...d, knxLineId: fix(d.knxLineId) })),
      })),
    })),
    panel: {
      ...p.panel,
      slots: p.panel.slots.map((sl) => ({ ...sl, knxLineId: fix(sl.knxLineId) })),
    },
  }
}

function appendPast(
  past: PlanstudioProject[],
  snapshot: PlanstudioProject,
): PlanstudioProject[] {
  const merged = [...past, snapshot]
  return merged.length > HISTORY_MAX ? merged.slice(-HISTORY_MAX) : merged
}

function uniqueFloorLevelLabel(floors: FloorLevel[], base: string): string {
  const used = new Set(floors.map((f) => f.label.trim()))
  const root = base.trim() || 'Floor'
  let label = root
  let n = 2
  while (used.has(label)) {
    label = `${root} (${n})`
    n += 1
  }
  return label
}

function runWithoutHistory(fn: () => void) {
  const prev = recordProjectHistory
  recordProjectHistory = false
  try {
    fn()
  } finally {
    recordProjectHistory = prev
  }
}

function reconcileAfterProjectRestore(s: ProjectStore): Partial<ProjectStore> {
  const p = s.project
  const out: Partial<ProjectStore> = {}
  let floorId = s.activeFloorId
  if (!p.floors.some((f) => f.id === floorId)) {
    floorId = p.floors[0]!.id
    out.activeFloorId = floorId
  }
  const fl = p.floors.find((f) => f.id === floorId) ?? p.floors[0]!
  const wallId = s.activeWallId
  if (wallId != null && !fl.wallSheets.some((w) => w.id === wallId)) {
    out.activeWallId = fl.wallSheets[0]?.id ?? null
  }
  const aliveFloorDev = new Set(fl.plan.devices.map((d) => d.id))
  const rawIds =
    s.selectionFloorDeviceIds && s.selectionFloorDeviceIds.length > 0
      ? [...new Set(s.selectionFloorDeviceIds)]
      : s.selectionFloorDeviceId
        ? [s.selectionFloorDeviceId]
        : []
  const prunedSel = rawIds.filter((id) => aliveFloorDev.has(id))
  const prevIds =
    s.selectionFloorDeviceIds && s.selectionFloorDeviceIds.length > 0
      ? [...new Set(s.selectionFloorDeviceIds)]
      : s.selectionFloorDeviceId
        ? [s.selectionFloorDeviceId]
        : []
  const changed =
    prunedSel.length !== prevIds.length ||
    prunedSel.some((id, i) => id !== prevIds[i]) ||
    s.selectionFloorDeviceId !== (prunedSel[0] ?? null)
  if (changed) {
    out.selectionFloorDeviceIds = prunedSel
    out.selectionFloorDeviceId = prunedSel[0] ?? null
  }
  const wallSel = s.selectionWallDevice
  if (wallSel) {
    const ws = fl.wallSheets.find((w) => w.id === wallSel.wallSheetId)
    if (!ws?.devices.some((d) => d.id === wallSel.deviceId)) {
      out.selectionWallDevice = null
    }
  }
  const osel = s.selectionWallOpening
  if (osel) {
    const ws = fl.wallSheets.find((w) => w.id === osel.wallSheetId)
    if (!ws?.openings.some((o) => o.id === osel.openingId)) {
      out.selectionWallOpening = null
    }
  }
  if (s.selectedRackGearId) {
    if (!p.rack.gear.some((g) => g.id === s.selectedRackGearId)) {
      out.selectedRackGearId = null
    }
  }
  if (s.selectedPanelSlot) {
    const { row, col } = s.selectedPanelSlot
    if (!p.panel.slots.some((sl) => sl.row === row && sl.col === col)) {
      out.selectedPanelSlot = null
    }
  }
  if (s.selectedWallSegmentId || (s.selectedWallSegmentIds?.length ?? 0) > 0) {
    const segs = fl.plan.wallSegments ?? []
    const aliveSeg = new Set(segs.map((s) => s.id))
    const rawW =
      s.selectedWallSegmentIds && s.selectedWallSegmentIds.length > 0
        ? [...new Set(s.selectedWallSegmentIds)]
        : s.selectedWallSegmentId
          ? [s.selectedWallSegmentId]
          : []
    const prunedW = rawW.filter((id) => aliveSeg.has(id))
    const prevW =
      s.selectedWallSegmentIds && s.selectedWallSegmentIds.length > 0
        ? [...new Set(s.selectedWallSegmentIds)]
        : s.selectedWallSegmentId
          ? [s.selectedWallSegmentId]
          : []
    const wChanged =
      prunedW.length !== prevW.length ||
      prunedW.some((id, i) => id !== prevW[i]) ||
      s.selectedWallSegmentId !== (prunedW[0] ?? null)
    if (wChanged) {
      out.selectedWallSegmentIds = prunedW
      out.selectedWallSegmentId = prunedW[0] ?? null
    }
  }
  return out
}

function projectMutation(
  s: ProjectStore,
  nextProject: PlanstudioProject,
  rest: Partial<ProjectStore> = {},
): Partial<ProjectStore> {
  const base: Partial<ProjectStore> = {
    project: nextProject,
    ...rest,
  }
  if (!recordProjectHistory) {
    return base
  }
  return {
    ...base,
    historyPast: appendPast(s.historyPast, cloneProject(s.project)),
    historyFuture: [],
  }
}

function touch(project: PlanstudioProject): PlanstudioProject {
  return { ...project, updatedAt: new Date().toISOString() }
}

function activeLevel(
  p: PlanstudioProject,
  activeId: string | null,
): FloorLevel {
  return p.floors.find((f) => f.id === (activeId ?? p.floors[0]?.id)) ?? p.floors[0]!
}

function mapFloors(
  s: { project: PlanstudioProject; activeFloorId: string | null },
  mapFn: (fl: FloorLevel) => FloorLevel,
): PlanstudioProject {
  return {
    ...s.project,
    floors: s.project.floors.map((fl) =>
      fl.id === (s.activeFloorId ?? s.project.floors[0]?.id) ? mapFn(fl) : fl,
    ),
  }
}

/** After grid-snapped tentative moves, snap each moved endpoint to other walls (vertices + edges). */
function snapMovedWallEndpointsToPlan(
  fl: FloorLevel,
  wallSet: Set<string>,
  tentative: Map<string, { a: PointM; b: PointM }>,
): WallSegment[] {
  const lifted = fl.plan.wallSegments.map((seg) =>
    wallSet.has(seg.id) ? { ...seg, ...tentative.get(seg.id)! } : seg,
  )
  return fl.plan.wallSegments.map((seg) => {
    if (!wallSet.has(seg.id)) return seg
    const t = tentative.get(seg.id)!
    const a2 = snapWallPointToPlanGeometry(t.a, lifted, {
      ignoreSegmentId: seg.id,
      ignoreVertex: 'a',
    })
    const b2 = snapWallPointToPlanGeometry(t.b, lifted, {
      ignoreSegmentId: seg.id,
      ignoreVertex: 'b',
    })
    return { ...seg, a: a2, b: b2 }
  })
}

/**
 * Apply one plan delta to wall segments (snapped) and floor devices (clamped).
 * Returns `null` if nothing would change.
 */
function applyMovePlanSelectionByDelta(
  s: { project: PlanstudioProject; activeFloorId: string | null },
  wallSegmentIds: string[],
  floorDeviceIds: string[],
  deltaM: PointM,
): PlanstudioProject | null {
  const wallSet = new Set(wallSegmentIds.filter(Boolean))
  const devSet = new Set(floorDeviceIds.filter(Boolean))
  if (!Number.isFinite(deltaM.x) || !Number.isFinite(deltaM.y)) return null
  if (deltaM.x === 0 && deltaM.y === 0) return null
  if (wallSet.size === 0 && devSet.size === 0) return null

  const floorId = s.activeFloorId ?? s.project.floors[0]!.id
  const fl = s.project.floors.find((f) => f.id === floorId)
  if (!fl) return null

  const grid = s.project.editorSettings.snapGridM
  const wm = fl.plan.widthM
  const dm = fl.plan.depthM

  const tentative = new Map<string, { a: PointM; b: PointM }>()
  for (const seg of fl.plan.wallSegments) {
    if (!wallSet.has(seg.id)) continue
    tentative.set(seg.id, {
      a: snapMeters({ x: seg.a.x + deltaM.x, y: seg.a.y + deltaM.y }, grid),
      b: snapMeters({ x: seg.b.x + deltaM.x, y: seg.b.y + deltaM.y }, grid),
    })
  }

  const nextSegments =
    wallSet.size > 0
      ? snapMovedWallEndpointsToPlan(fl, wallSet, tentative)
      : fl.plan.wallSegments

  let wallChanged = false
  for (let i = 0; i < nextSegments.length; i++) {
    const old = fl.plan.wallSegments[i]!
    const nw = nextSegments[i]!
    if (
      old.a.x !== nw.a.x ||
      old.a.y !== nw.a.y ||
      old.b.x !== nw.b.x ||
      old.b.y !== nw.b.y
    ) {
      wallChanged = true
      break
    }
  }

  let devChanged = false
  const nextDevices = fl.plan.devices.map((d) => {
    if (!devSet.has(d.id)) return d
    const nx = Math.min(wm, Math.max(0, d.x + deltaM.x))
    const ny = Math.min(dm, Math.max(0, d.y + deltaM.y))
    if (nx === d.x && ny === d.y) return d
    devChanged = true
    return { ...d, x: nx, y: ny }
  })

  if (!wallChanged && !devChanged) return null

  const mapped = mapFloors(s, (fli) => {
    if (fli.id !== floorId) return fli
    return {
      ...fli,
      plan: {
        ...fli.plan,
        wallSegments: nextSegments,
        devices: nextDevices,
      },
    }
  })

  return touch(
    wallChanged
      ? reconcileFloorTopologyInProject(mapped, s.activeFloorId)
      : mapped,
  )
}

/**
 * Recompute auto-rooms + per-face wall sheets for one floor, then refresh derived
 * labels (`L{lvl}_{idx}_<roomSlug>`). Run after any wall geometry change so the
 * room set, paired sheets, and shared openings stay consistent.
 */
function reconcileFloorTopologyInProject(
  project: PlanstudioProject,
  floorId: string | null,
): PlanstudioProject {
  const fid = floorId ?? project.floors[0]!.id
  const floors = project.floors.map((fl) =>
    fl.id === fid ? reconcileFloorWallTopology(fl, project.floors) : fl,
  )
  return { ...project, floors }
}

/** Reconcile every floor — used at project load / replace to bring legacy data forward. */
function reconcileAllFloorTopologyInProject(
  project: PlanstudioProject,
): PlanstudioProject {
  const floors = project.floors.map((fl, _i, arr) =>
    reconcileFloorWallTopology(fl, arr),
  )
  return { ...project, floors }
}

export type WallDeviceSelection = { wallSheetId: string; deviceId: string }

export type WallOpeningSelection = { wallSheetId: string; openingId: string }

export type ProjectStore = {
  project: PlanstudioProject
  historyPast: PlanstudioProject[]
  historyFuture: PlanstudioProject[]
  activeFloorId: string
  activeTab: EditorTab
  activeWallId: string | null
  floorTool: FloorTool
  wallOpeningKind: WallOpeningKind
  nextRegionKind: RegionKind
  regionVertexDraft: PointM[]
  wallDrawA: PointM | null
  wallDrawPreview: PointM | null
  wallDrawLengthInput: string
  wallDrawAngleInput: string
  selectionFloorDeviceId: string | null
  /** All selected plan devices on the active floor (select tool); first id mirrors `selectionFloorDeviceId`. */
  selectionFloorDeviceIds: string[]
  selectionWallDevice: WallDeviceSelection | null
  selectionWallOpening: WallOpeningSelection | null
  selectedPanelSlot: { row: number; col: number } | null
  selectedRackGearId: string | null
  /** Plan wall segment selected on the floor canvas (select tool). */
  selectedWallSegmentId: string | null
  /** All selected plan wall segments; first id mirrors `selectedWallSegmentId`. */
  selectedWallSegmentIds: string[]

  setActiveTab: (tab: EditorTab) => void
  setActiveFloorId: (id: string) => void
  addFloorLevel: () => void
  removeFloorLevel: (id: string) => void
  /** Sidebar / tab name for a floor (`FloorLevel.label`, not the plan canvas title). */
  setFloorLevelLabel: (floorId: string, label: string) => void
  duplicateFloorLevel: (id: string) => void
  /** Move one step in the ordered floor list (`sortOrder` swap with neighbor). */
  moveFloorLevel: (id: string, direction: 'up' | 'down') => void
  setProjectName: (name: string) => void
  /** Replace bus lines and prune stale `knxLineId` refs on devices + panel slots. */
  setKnxLines: (lines: KnxLine[]) => void
  addKnxLine: () => void
  removeKnxLine: (id: string) => void
  setFloorSize: (widthM: number, depthM: number) => void
  setFloorLabel: (label: string) => void
  setFloorTool: (tool: FloorTool) => void
  setWallOpeningKind: (kind: WallOpeningKind) => void
  setSnapGridM: (m: number) => void
  setWallOrtho: (o: boolean) => void
  setNextRegionKind: (k: RegionKind) => void
  appendRegionVertex: (p: PointM) => void
  closeRegionDraft: (defaultLabel: string) => void
  cancelRegionDraft: () => void
  beginWallDraw: (a: PointM) => void
  updateWallDrawPreview: (b: PointM) => void
  clearWallDraw: () => void
  setWallDrawLengthInput: (v: string) => void
  setWallDrawAngleInput: (v: string) => void
  commitWallFromNumericDraft: () => void
  removePlanRegion: (id: string) => void
  /** Rename / change label of a `PlanRegion`. Auto-rooms keep their `wallCycleSignature`; the next reconcile updates wall labels (`L0_12_<roomSlug>`). */
  updatePlanRegionLabel: (id: string, label: string) => void
  setSelectionFloorDevice: (id: string | null) => void
  setSelectionFloorDevices: (ids: string[]) => void
  setSelectedWallSegmentId: (id: string | null) => void
  setSelectedWallSegmentIds: (ids: string[]) => void
  setSelectionWallDevice: (wallSheetId: string | null, deviceId: string | null) => void
  setSelectionWallOpening: (wallSheetId: string | null, openingId: string | null) => void
  setSelectedPanelSlot: (row: number | null, col: number | null) => void
  setSelectedRackGearId: (id: string | null) => void
  setFloorDeviceWallLink: (floorDeviceId: string, wallSheetId: string, wallDeviceId: string | null) => void

  addWallSegment: (a: PointM, b: PointM) => void
  removeWallSegments: (ids: string[]) => void
  removeWallSegment: (id: string) => void
  /**
   * Translate a plan wall segment by `deltaM` (world meters), then snap both
   * endpoints to the grid. Relinks plan wall sheet names if stable ordering changes.
   */
  moveWallSegment: (id: string, deltaM: PointM) => void
  /** Move several wall segments by the same delta (m); one undo step. */
  moveWallSegmentsByDelta: (ids: string[], deltaM: PointM) => void
  /**
   * Move one endpoint of a plan wall segment (`a` or `b`). Point is snapped to the grid
   * and clamped to the floor plan; rejects moves that collapse the segment.
   */
  setWallSegmentEndpoint: (
    id: string,
    endpoint: 'a' | 'b',
    pointM: PointM,
  ) => void
  /**
   * Move endpoint `b` from anchor `a` using length + angle (degrees from +X).
   * Snaps `b` to the grid; updates linked wall sheet `lengthM`.
   */
  updateWallSegment: (
    id: string,
    args: { lengthM: number; angleDeg: number; lockOrtho: boolean },
  ) => void
  addFloorDevice: (x: number, y: number, templateId: string) => void
  updateFloorDevice: (id: string, partial: Partial<Omit<FloorDevice, 'id'>>) => void
  moveFloorDevice: (id: string, x: number, y: number) => void
  /** Move several plan devices by the same delta (m); one undo step. */
  moveFloorDevicesByDelta: (ids: string[], dxM: number, dyM: number) => void
  /**
   * Move plan wall segments (snapped) and floor devices (clamped) by the same delta (m);
   * one undo step — used when dragging with both walls and devices selected.
   */
  movePlanSelectionByDelta: (
    wallSegmentIds: string[],
    floorDeviceIds: string[],
    deltaM: PointM,
  ) => void
  removeFloorDevice: (id: string) => void
  removeFloorDevices: (ids: string[]) => void

  setActiveWallId: (id: string | null) => void
  addWallSheet: () => void
  updateWallSheetMeta: (
    id: string,
    partial: Partial<
      Pick<
        WallSheet,
        'label' | 'lengthM' | 'heightM' | 'roomRegionId' | 'planSpanAlongSegment01'
      >
    >,
  ) => void
  removeWallSheet: (id: string) => void
  /** Create missing plan-linked wall sheets and refresh segment lengths. */
  syncWallsFromPlan: () => void
  setActiveWallForPlanSegment: (wallSegmentId: string | null) => void
  addWallMountDevice: (wallId: string, xM: number, zM: number, templateId: string) => void
  moveWallMountDevice: (wallId: string, deviceId: string, xM: number, zM: number) => void
  updateWallMountDevice: (
    wallId: string,
    deviceId: string,
    partial: Partial<Omit<WallMountDevice, 'id'>>,
  ) => void
  removeWallMountDevice: (wallId: string, deviceId: string) => void
  addWallOpening: (wallId: string, xM: number, zM: number) => void
  moveWallOpening: (wallId: string, openingId: string, xM: number, zM: number) => void
  removeWallOpening: (wallId: string, openingId: string) => void

  setPanelSlot: (
    row: number,
    col: number,
    partial: Partial<{
      moduleType: PanelModuleType
      label: string
      productName: string
      unitPrice: number
      ratingA: number | undefined
      circuitRef: string
      spanWidthTe: number
    }>,
  ) => void
  setPanelDimensions: (rows: number, widthTe: number) => void
  updatePanelSlot: (slotId: string, partial: Partial<PanelSlot>) => void
  addPanelModuleTemplate: () => void
  updatePanelModuleTemplate: (id: string, partial: Partial<PanelModuleTemplate>) => void
  removePanelModuleTemplate: (id: string) => void
  placeFromPanelPalette: (templateId: string, row: number, col: number) => void
  addDeviceTemplate: (partial?: Partial<Omit<DeviceTemplate, 'id'>>) => void
  updateDeviceTemplate: (id: string, partial: Partial<Omit<DeviceTemplate, 'id'>>) => void
  removeDeviceTemplate: (id: string) => void
  reapplyFloorDeviceRequirementDefaults: (id: string) => void
  reapplyWallMountDeviceRequirementDefaults: (wallId: string, deviceId: string) => void

  setRackTotalRU: (totalRU: number) => void
  setRackWidthLabel: (label: string) => void
  updateRackEnclosure: (
    partial: Partial<Pick<RackFrame, 'enclosureProductName' | 'enclosureUnitPrice'>>,
  ) => void
  addRackGear: () => void
  addRackGearFromPalette: (paletteTemplateId: string) => void
  updateRackGear: (
    id: string,
    partial: Partial<
      Pick<
        RackFrame['gear'][number],
        | 'productName'
        | 'startRU'
        | 'heightRU'
        | 'notes'
        | 'unitPrice'
        | 'rj45PortCount'
        | 'sfpPortCount'
      >
    >,
  ) => void
  removeRackGear: (id: string) => void
  addRackPortLink: (from: RackPortEndpoint, to: RackPortEndpoint) => void
  removeRackPortLink: (linkId: string) => void
  duplicateRackGear: (gearId: Id) => void
  /** Upsert or remove (empty label) a plan/wall device → patch-port label on `rack.patchPanelLinks`. */
  setRackPatchPanelLink: (deviceId: string, patchLabel: string) => void
  resetProject: () => void
  loadProject: (raw: unknown) => void
  replaceProjectFromImport: (project: PlanstudioProject) => void
  undo: () => void
  redo: () => void
}

const initP = createInitialProject()
const firstF = initP.floors[0]!

const defaultUi = () => ({
  nextRegionKind: 'room' as RegionKind,
  regionVertexDraft: [] as PointM[],
  wallDrawA: null as PointM | null,
  wallDrawPreview: null as PointM | null,
  wallDrawLengthInput: '',
  wallDrawAngleInput: '',
  selectionFloorDeviceId: null as string | null,
  selectionFloorDeviceIds: [] as string[],
  selectionWallDevice: null as WallDeviceSelection | null,
  selectionWallOpening: null as WallOpeningSelection | null,
  selectedPanelSlot: null as { row: number; col: number } | null,
  selectedRackGearId: null as string | null,
  selectedWallSegmentId: null as string | null,
  selectedWallSegmentIds: [] as string[],
})

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: initP,
  historyPast: [],
  historyFuture: [],
  activeFloorId: firstF.id,
  activeTab: 'floor',
  activeWallId: firstF.wallSheets[0]?.id ?? null,
  floorTool: 'select',
  wallOpeningKind: 'door' as WallOpeningKind,
  ...defaultUi(),

  setActiveTab: (activeTab) => set({ activeTab }),
  setActiveFloorId: (id) =>
    set((s) => {
      const f = s.project.floors.find((x) => x.id === id) ?? s.project.floors[0]
      return {
        activeFloorId: f?.id ?? s.activeFloorId,
        activeWallId: f?.wallSheets[0]?.id ?? null,
        selectionFloorDeviceId: null,
        selectionFloorDeviceIds: [],
        selectionWallDevice: null,
        selectionWallOpening: null,
        selectedPanelSlot: null,
        selectedWallSegmentId: null,
        selectedWallSegmentIds: [],
      }
    }),
  addFloorLevel: () =>
    set((s) => {
      const maxO = Math.max(0, ...s.project.floors.map((f) => f.sortOrder))
      const f = createFloorLevel(
        `Level ${s.project.floors.length + 1}`,
        maxO + 1,
        'Plan',
        12,
        9,
      )
      return projectMutation(
        s,
        touch({ ...s.project, floors: [...s.project.floors, f] }),
        {
          activeFloorId: f.id,
          activeWallId: f.wallSheets[0]?.id ?? null,
          ...defaultUi(),
        },
      )
    }),
  removeFloorLevel: (id) =>
    set((s) => {
      if (s.project.floors.length <= 1) return s
      const floors = s.project.floors.filter((f) => f.id !== id)
      const nextId = s.activeFloorId === id ? floors[0]!.id : s.activeFloorId
      const nf = floors.find((f) => f.id === nextId) ?? floors[0]!
      return projectMutation(
        s,
        touch({ ...s.project, floors }),
        {
          activeFloorId: nextId,
          activeWallId: nf.wallSheets[0]?.id ?? null,
          ...defaultUi(),
        },
      )
    }),

  setFloorLevelLabel: (floorId, label) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          floors: s.project.floors.map((f) =>
            f.id === floorId ? { ...f, label: label.trim() || f.label } : f,
          ),
        }),
      ),
    ),

  duplicateFloorLevel: (id) =>
    set((s) => {
      const src = s.project.floors.find((f) => f.id === id)
      if (!src) return s
      const { floor: clonedBase, floorDeviceIdMap, wallDeviceIdMap } = cloneFloorWithNewIds(src)
      const nameBase = `${src.label.trim()} copy`
      const newLabel = uniqueFloorLevelLabel(s.project.floors, nameBase)
      const cloned = { ...clonedBase, label: newLabel }

      const sorted = [...s.project.floors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      )
      const srcIdx = sorted.findIndex((f) => f.id === id)
      const newOrder =
        srcIdx < 0
          ? [...sorted, cloned]
          : [...sorted.slice(0, srcIdx + 1), cloned, ...sorted.slice(srcIdx + 1)]
      const floors = newOrder.map((f, i) => ({ ...f, sortOrder: i }))

      const devRemap = new Map([...floorDeviceIdMap, ...wallDeviceIdMap])
      const extraPatch = s.project.rack.patchPanelLinks
        .filter((l) => devRemap.has(l.deviceId))
        .map((l) => ({ ...l, deviceId: devRemap.get(l.deviceId)! }))

      return projectMutation(
        s,
        touch({
          ...s.project,
          floors,
          rack: {
            ...s.project.rack,
            patchPanelLinks: [...s.project.rack.patchPanelLinks, ...extraPatch],
          },
        }),
        {
          activeFloorId: cloned.id,
          activeWallId: cloned.wallSheets[0]?.id ?? null,
          ...defaultUi(),
        },
      )
    }),

  moveFloorLevel: (id, direction) =>
    set((s) => {
      const sorted = [...s.project.floors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      )
      const idx = sorted.findIndex((f) => f.id === id)
      if (idx < 0) return s
      const j = direction === 'up' ? idx - 1 : idx + 1
      if (j < 0 || j >= sorted.length) return s
      const a = sorted[idx]!
      const b = sorted[j]!
      const floors = s.project.floors.map((f) => {
        if (f.id === a.id) return { ...f, sortOrder: b.sortOrder }
        if (f.id === b.id) return { ...f, sortOrder: a.sortOrder }
        return f
      })
      return projectMutation(s, touch({ ...s.project, floors }))
    }),

  setProjectName: (name) =>
    set((s) => projectMutation(s, touch({ ...s.project, name }))),

  setKnxLines: (knxLines) =>
    set((s) => projectMutation(s, touch(withKnxLinesAndPrunedRefs(s.project, knxLines)))),

  addKnxLine: () =>
    set((s) => {
      const lines = s.project.knxLines
      const maxO = lines.length ? Math.max(...lines.map((l) => l.sortOrder)) : -1
      const knxLines: KnxLine[] = [
        ...lines,
        { id: nanoid(), label: 'KNX line', sortOrder: maxO + 1 },
      ]
      return projectMutation(s, touch({ ...s.project, knxLines }))
    }),

  removeKnxLine: (id) =>
    set((s) => {
      const knxLines = s.project.knxLines.filter((l) => l.id !== id)
      return projectMutation(s, touch(withKnxLinesAndPrunedRefs(s.project, knxLines)))
    }),
  setFloorSize: (widthM, depthM) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: { ...fl.plan, widthM, depthM },
          })),
        ),
      ),
    ),

  setFloorLabel: (label) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: { ...fl.plan, label },
          })),
        ),
      ),
    ),

  setFloorTool: (floorTool) =>
    set((s) => ({
      floorTool,
      regionVertexDraft: floorTool === 'region' ? s.regionVertexDraft : [],
      ...(floorTool !== 'wall'
        ? {
            wallDrawA: null,
            wallDrawPreview: null,
            wallDrawLengthInput: '',
            wallDrawAngleInput: '',
          }
        : {}),
    })),
  setWallOpeningKind: (wallOpeningKind) => set({ wallOpeningKind }),
  setSnapGridM: (m) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          editorSettings: {
            ...s.project.editorSettings,
            snapGridM: Math.max(0.01, m),
          },
        }),
      ),
    ),
  setWallOrtho: (wallOrtho) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          editorSettings: { ...s.project.editorSettings, wallOrtho },
        }),
      ),
    ),
  setNextRegionKind: (nextRegionKind) => set({ nextRegionKind }),
  appendRegionVertex: (p) =>
    set((s) =>
      s.floorTool === 'region'
        ? { regionVertexDraft: [...s.regionVertexDraft, p] }
        : s,
    ),
  closeRegionDraft: (defaultLabel) =>
    set((s) => {
      if (s.regionVertexDraft.length < 3) return s
      const r: PlanRegion = {
        id: nanoid(),
        kind: s.nextRegionKind,
        label: defaultLabel,
        vertices: [...s.regionVertexDraft],
      }
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: { ...fl.plan, regions: [...fl.plan.regions, r] },
          })),
        ),
        { regionVertexDraft: [] },
      )
    }),
  cancelRegionDraft: () => set({ regionVertexDraft: [] }),

  beginWallDraw: (a) =>
    set({
      wallDrawA: { ...a },
      wallDrawPreview: { ...a },
      wallDrawLengthInput: '',
      wallDrawAngleInput: '',
    }),
  updateWallDrawPreview: (b) =>
    set((s) => (s.wallDrawA ? { wallDrawPreview: { ...b } } : s)),
  clearWallDraw: () =>
    set({
      wallDrawA: null,
      wallDrawPreview: null,
      wallDrawLengthInput: '',
      wallDrawAngleInput: '',
    }),
  setWallDrawLengthInput: (wallDrawLengthInput) => set({ wallDrawLengthInput }),
  setWallDrawAngleInput: (wallDrawAngleInput) => set({ wallDrawAngleInput }),
  commitWallFromNumericDraft: () => {
    const s = get()
    if (!s.wallDrawA) return
    const L = parseFloat(s.wallDrawLengthInput.trim())
    if (!Number.isFinite(L) || L <= 0) return
    const angleRaw = parseFloat(s.wallDrawAngleInput.trim())
    const angleDeg =
      s.wallDrawAngleInput.trim() !== '' && Number.isFinite(angleRaw)
        ? angleRaw
        : null
    const pointer = s.wallDrawPreview ?? {
      x: s.wallDrawA.x + 1,
      y: s.wallDrawA.y,
    }
    const b = snapMeters(
      computeWallDrawB({
        anchor: s.wallDrawA,
        pointer,
        lengthM: L,
        angleDeg,
        wallOrtho: s.project.editorSettings.wallOrtho,
        shiftKey: false,
      }),
      s.project.editorSettings.snapGridM,
    )
    if (b.x === s.wallDrawA.x && b.y === s.wallDrawA.y) return
    get().addWallSegment({ ...s.wallDrawA }, { ...b })
    set({
      wallDrawA: null,
      wallDrawPreview: null,
      wallDrawLengthInput: '',
      wallDrawAngleInput: '',
    })
  },

  removePlanRegion: (id) =>
    set((s) => ({
      project: touch(
        mapFloors(s, (fl) => ({
          ...fl,
          plan: { ...fl.plan, regions: fl.plan.regions.filter((x) => x.id !== id) },
        })),
      ),
    })),

  updatePlanRegionLabel: (id, label) =>
    set((s) => {
      const trimmed = label.trim()
      if (trimmed.length === 0) return s
      const stage1 = mapFloors(s, (fl) => ({
        ...fl,
        plan: {
          ...fl.plan,
          regions: fl.plan.regions.map((r) =>
            r.id === id ? { ...r, label: trimmed } : r,
          ),
        },
      }))
      // Reconcile so plan-linked wall sheet labels (which embed the room slug)
      // update when the user renames a room.
      const next = touch(reconcileFloorTopologyInProject(stage1, s.activeFloorId))
      return projectMutation(s, next)
    }),

  setSelectionFloorDevice: (selectionFloorDeviceId) =>
    set({
      selectionFloorDeviceId,
      selectionFloorDeviceIds: selectionFloorDeviceId ? [selectionFloorDeviceId] : [],
    }),
  setSelectionFloorDevices: (ids) =>
    set(() => {
      const uniq = [...new Set(ids.filter(Boolean))]
      return {
        selectionFloorDeviceIds: uniq,
        selectionFloorDeviceId: uniq[0] ?? null,
      }
    }),
  setSelectedWallSegmentId: (selectedWallSegmentId) =>
    set({
      selectedWallSegmentId,
      selectedWallSegmentIds: selectedWallSegmentId ? [selectedWallSegmentId] : [],
    }),
  setSelectedWallSegmentIds: (ids) =>
    set(() => {
      const uniq = [...new Set(ids.filter(Boolean))]
      return {
        selectedWallSegmentIds: uniq,
        selectedWallSegmentId: uniq[0] ?? null,
      }
    }),
  setSelectionWallDevice: (wallSheetId, deviceId) =>
    set(
      wallSheetId && deviceId
        ? { selectionWallDevice: { wallSheetId, deviceId }, selectionWallOpening: null }
        : { selectionWallDevice: null },
    ),
  setSelectionWallOpening: (wallSheetId, openingId) =>
    set(
      wallSheetId && openingId
        ? { selectionWallOpening: { wallSheetId, openingId }, selectionWallDevice: null }
        : { selectionWallOpening: null },
    ),
  setSelectedPanelSlot: (row, col) =>
    set(
      row != null && col != null
        ? { selectedPanelSlot: { row, col } }
        : { selectedPanelSlot: null },
    ),
  setSelectedRackGearId: (id) => set({ selectedRackGearId: id }),

  setFloorDeviceWallLink: (floorDeviceId, wallSheetId, wallDeviceId) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const fdi = fl.plan.devices.findIndex((d) => d.id === floorDeviceId)
            if (fdi < 0) return fl
            const devices = fl.plan.devices.map((d) => ({ ...d }))
            const wallSheets = fl.wallSheets.map((w) => ({
              ...w,
              devices: w.devices.map((d) => ({ ...d })),
            }))
            const fd = { ...devices[fdi]! }
            for (const ws of wallSheets) {
              for (let i = 0; i < ws.devices.length; i++) {
                if (ws.devices[i]!.linkedFloorDeviceId === floorDeviceId) {
                  ws.devices[i] = { ...ws.devices[i]!, linkedFloorDeviceId: undefined }
                }
              }
            }
            if (fd.linkedWallDeviceId) {
              for (const ws of wallSheets) {
                for (let i = 0; i < ws.devices.length; i++) {
                  if (ws.devices[i]!.id === fd.linkedWallDeviceId) {
                    ws.devices[i] = { ...ws.devices[i]!, linkedFloorDeviceId: undefined }
                  }
                }
              }
              fd.linkedWallDeviceId = undefined
            }
            if (!wallDeviceId) {
              devices[fdi] = { ...fd, linkedWallDeviceId: undefined }
              return { ...fl, plan: { ...fl.plan, devices }, wallSheets }
            }
            const ws = wallSheets.find((w) => w.id === wallSheetId)
            const wdi = ws?.devices.findIndex((d) => d.id === wallDeviceId) ?? -1
            if (!ws || wdi < 0) {
              return fl
            }
            const wdev = { ...ws.devices[wdi]! }
            if (wdev.linkedFloorDeviceId && wdev.linkedFloorDeviceId !== floorDeviceId) {
              const oi = devices.findIndex((d) => d.id === wdev.linkedFloorDeviceId)
              if (oi >= 0) {
                devices[oi] = { ...devices[oi]!, linkedWallDeviceId: undefined }
              }
            }
            fd.linkedWallDeviceId = wallDeviceId
            wdev.linkedFloorDeviceId = floorDeviceId
            const ws2 = wallSheets.map((w) =>
              w.id === wallSheetId
                ? {
                    ...w,
                    devices: w.devices.map((d, j) => (j === wdi ? wdev : d)),
                  }
                : w,
            )
            devices[fdi] = fd
            return { ...fl, plan: { ...fl.plan, devices }, wallSheets: ws2 }
          }),
        ),
      ),
    ),

  addWallSegment: (a, b) =>
    set((s) => {
      const targetFloorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === targetFloorId)
      if (!fl) return s
      const grid = s.project.editorSettings.snapGridM
      const wm = fl.plan.widthM
      const dm = fl.plan.depthM
      const clampPt = (p: PointM) => ({
        x: Math.min(wm, Math.max(0, p.x)),
        y: Math.min(dm, Math.max(0, p.y)),
      })
      const segs = fl.plan.wallSegments ?? []
      const a1 = snapWallPointToPlanGeometry(snapMeters(clampPt(a), grid), segs, {})
      const b1 = snapWallPointToPlanGeometry(snapMeters(clampPt(b), grid), segs, {})
      const minLen = 0.02
      if (Math.hypot(a1.x - b1.x, a1.y - b1.y) < minLen) return s

      const seg: WallSegment = { id: nanoid(), a: a1, b: b1 }
      const stage1 = mapFloors(s, (fli) => ({
        ...fli,
        plan: {
          ...fli.plan,
          wallSegments: [...(fli.plan.wallSegments ?? []), seg],
        },
      }))
      const reconciled = reconcileFloorTopologyInProject(stage1, targetFloorId)
      const nextProject = touch(reconciled)
      const flNext = nextProject.floors.find((f) => f.id === targetFloorId)
      // After reconcile a new segment has either one or two sheets — pick the first
      // so the wall list highlights the user's brand-new wall.
      const newSheet = flNext?.wallSheets.find((w) => w.wallSegmentId === seg.id)
      return projectMutation(s, nextProject, {
        activeWallId: newSheet?.id ?? s.activeWallId,
      })
    }),

  removeWallSegments: (ids) => {
    set((s) => {
      const toRemove = [...new Set(ids.filter(Boolean))]
      if (toRemove.length === 0) return s
      const targetFloorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === targetFloorId)
      if (!fl) return s
      const segAlive = new Set(fl.plan.wallSegments.map((x) => x.id))
      const removeIds = toRemove.filter((id) => segAlive.has(id))
      if (removeIds.length === 0) return s
      const removeSet = new Set(removeIds)
      let needsConfirm = false
      for (const id of removeIds) {
        const linkedSheets = fl.wallSheets.filter((w) => w.wallSegmentId === id)
        if (
          linkedSheets.some(
            (l) => l.devices.length > 0 || (l.openings?.length ?? 0) > 0,
          )
        ) {
          needsConfirm = true
          break
        }
      }
      if (
        needsConfirm &&
        !window.confirm(
          removeIds.length > 1
            ? 'Remove these plan walls? Their elevations, wall openings, and wall-mounted devices will be deleted, and any floor device links to those wall devices will be cleared.'
            : 'Remove this plan wall? Its elevation, wall openings, and wall-mounted devices will be deleted, and any floor device links to those wall devices will be cleared.',
        )
      ) {
        return s
      }
      const stage1 = mapFloors(s, (fli) => {
        if (fli.id !== targetFloorId) return fli
        let cleared: FloorLevel = fli
        for (const id of removeIds) {
          // Collect device ids from every face sharing this segment so plan→wall
          // links don't dangle after the segment (and its faces) are removed.
          const sheets = cleared.wallSheets.filter((w) => w.wallSegmentId === id)
          if (sheets.length > 0) {
            const devIds = new Set<string>()
            for (const ws of sheets) for (const d of ws.devices) devIds.add(d.id)
            cleared = clearPlanLinksToWallDeviceIds(cleared, devIds)
            cleared = {
              ...cleared,
              plan: {
                ...cleared.plan,
                wallSegments: cleared.plan.wallSegments.filter((w) => w.id !== id),
              },
              wallSheets: cleared.wallSheets.filter((w) => w.wallSegmentId !== id),
            }
          } else {
            cleared = {
              ...cleared,
              plan: {
                ...cleared.plan,
                wallSegments: cleared.plan.wallSegments.filter((w) => w.id !== id),
              },
            }
          }
        }
        return cleared
      })
      const nextProject = touch(reconcileFloorTopologyInProject(stage1, s.activeFloorId))
      const nws = nextProject.floors.find((f) => f.id === targetFloorId)!.wallSheets
      const nextActive =
        s.activeWallId && nws.some((w) => w.id === s.activeWallId)
          ? s.activeWallId
          : nws[0]?.id ?? null
      const sw = s.selectionWallDevice
      const nextSel =
        sw && !nws.some((w) => w.id === sw.wallSheetId) ? { selectionWallDevice: null } : {}
      const prevWallSel =
        s.selectedWallSegmentIds.length > 0
          ? [...new Set(s.selectedWallSegmentIds)]
          : s.selectedWallSegmentId
            ? [s.selectedWallSegmentId]
            : []
      const nextWallSel = prevWallSel.filter((id) => !removeSet.has(id))
      return projectMutation(s, nextProject, {
        activeWallId: nextActive,
        ...nextSel,
        selectedWallSegmentIds: nextWallSel,
        selectedWallSegmentId: nextWallSel[0] ?? null,
      })
    })
  },

  removeWallSegment: (id) => get().removeWallSegments([id]),

  moveWallSegment: (id, deltaM) =>
    set((s) => {
      const floorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === floorId)
      if (!fl) return s
      const seg = fl.plan.wallSegments.find((x) => x.id === id)
      if (!seg) return s
      if (!Number.isFinite(deltaM.x) || !Number.isFinite(deltaM.y)) return s
      if (deltaM.x === 0 && deltaM.y === 0) return s
      const grid = s.project.editorSettings.snapGridM
      const newA = snapMeters(
        { x: seg.a.x + deltaM.x, y: seg.a.y + deltaM.y },
        grid,
      )
      const newB = snapMeters(
        { x: seg.b.x + deltaM.x, y: seg.b.y + deltaM.y },
        grid,
      )
      const tentative = new Map<string, { a: PointM; b: PointM }>([
        [id, { a: newA, b: newB }],
      ])
      const nextSegments = snapMovedWallEndpointsToPlan(fl, new Set([id]), tentative)
      const nextSeg = nextSegments.find((w) => w.id === id)
      if (!nextSeg) return s
      if (
        nextSeg.a.x === seg.a.x &&
        nextSeg.a.y === seg.a.y &&
        nextSeg.b.x === seg.b.x &&
        nextSeg.b.y === seg.b.y
      ) {
        return s
      }
      const stage1 = mapFloors(s, (fli) => {
        if (fli.id !== floorId) return fli
        return {
          ...fli,
          plan: {
            ...fli.plan,
            wallSegments: nextSegments,
          },
        }
      })
      const nextProject = touch(
        reconcileFloorTopologyInProject(stage1, s.activeFloorId),
      )
      return projectMutation(s, nextProject)
    }),

  moveWallSegmentsByDelta: (ids, deltaM) =>
    set((s) => {
      const next = applyMovePlanSelectionByDelta(s, ids, [], deltaM)
      if (!next) return s
      return projectMutation(s, next)
    }),

  setWallSegmentEndpoint: (id, endpoint, pointM) =>
    set((s) => {
      const floorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === floorId)
      if (!fl) return s
      const seg = fl.plan.wallSegments.find((x) => x.id === id)
      if (!seg) return s
      const grid = s.project.editorSettings.snapGridM
      const wm = fl.plan.widthM
      const dm = fl.plan.depthM
      const clamped = {
        x: Math.min(wm, Math.max(0, pointM.x)),
        y: Math.min(dm, Math.max(0, pointM.y)),
      }
      const snapped = snapMeters(clamped, grid)
      const lifted = fl.plan.wallSegments.map((w) =>
        w.id === id
          ? {
              ...w,
              ...(endpoint === 'a' ? { a: snapped } : { b: snapped }),
            }
          : w,
      )
      const geomSnapped = snapWallPointToPlanGeometry(snapped, lifted, {
        ignoreSegmentId: id,
        ignoreVertex: endpoint,
      })
      const other = endpoint === 'a' ? seg.b : seg.a
      const minLen = 0.02
      if (Math.hypot(geomSnapped.x - other.x, geomSnapped.y - other.y) < minLen) {
        return s
      }
      const nextSeg: WallSegment =
        endpoint === 'a'
          ? { ...seg, a: geomSnapped, b: { ...seg.b } }
          : { ...seg, a: { ...seg.a }, b: geomSnapped }
      if (
        nextSeg.a.x === seg.a.x &&
        nextSeg.a.y === seg.a.y &&
        nextSeg.b.x === seg.b.x &&
        nextSeg.b.y === seg.b.y
      ) {
        return s
      }
      const stage1 = mapFloors(s, (fli) => {
        if (fli.id !== floorId) return fli
        const nextPlan = {
          ...fli.plan,
          wallSegments: fli.plan.wallSegments.map((w) =>
            w.id === id ? nextSeg : w,
          ),
        }
        return syncLinkedWallSheetLengthForSegment(
          { ...fli, plan: nextPlan },
          id,
          nextSeg,
        )
      })
      const nextProject = touch(
        reconcileFloorTopologyInProject(stage1, s.activeFloorId),
      )
      return projectMutation(s, nextProject)
    }),

  movePlanSelectionByDelta: (wallSegmentIds, floorDeviceIds, deltaM) =>
    set((s) => {
      const next = applyMovePlanSelectionByDelta(s, wallSegmentIds, floorDeviceIds, deltaM)
      if (!next) return s
      return projectMutation(s, next)
    }),

  updateWallSegment: (id, args) =>
    set((s) => {
      const floorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === floorId)
      if (!fl) return s
      const seg = fl.plan.wallSegments.find((x) => x.id === id)
      if (!seg) return s
      const L = args.lengthM
      const angleDeg = args.angleDeg
      if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(angleDeg)) return s
      const anchor = { ...seg.a }
      const pointer = { ...seg.b }
      let b = computeWallDrawB({
        anchor,
        pointer,
        lengthM: L,
        angleDeg,
        wallOrtho: args.lockOrtho,
        shiftKey: false,
      })
      b = snapMeters(b, s.project.editorSettings.snapGridM)
      if (b.x === anchor.x && b.y === anchor.y) return s
      const nextSeg: WallSegment = { ...seg, a: anchor, b }
      const stage1 = mapFloors(s, (fli) => {
        if (fli.id !== floorId) return fli
        const nextPlan = {
          ...fli.plan,
          wallSegments: fli.plan.wallSegments.map((w) =>
            w.id === id ? nextSeg : w,
          ),
        }
        const withLen = syncLinkedWallSheetLengthForSegment(
          { ...fli, plan: nextPlan },
          id,
          nextSeg,
        )
        return withLen
      })
      const nextProject = touch(
        reconcileFloorTopologyInProject(stage1, s.activeFloorId),
      )
      return projectMutation(s, nextProject)
    }),

  addFloorDevice: (x, y, templateId) =>
    set((s) => {
      const cat = s.project.deviceCatalog ?? []
      const tmpl = cat.find((t) => t.id === templateId)
      if (!tmpl) return s
      const devType = tmpl.type
      const connectorSubtype: ConnectorSubtype | undefined =
        devType === 'connector'
          ? (tmpl.connectorSubtype ?? 'ethernet')
          : undefined
      const label = tmpl.displayName?.trim() ? tmpl.displayName : String(devType)
      const requirements = mergeRequirementsWithDeviceTypeDefaults(
        devType,
        tmpl.requirements,
        connectorSubtype,
      )
      const bill = {
        productName: tmpl.productName,
        unitPrice: tmpl.unitPrice,
        billCategory: tmpl.billCategory,
      }
      const dev: FloorDevice = {
        id: nanoid(),
        type: devType,
        ...(devType === 'connector' ? { connectorSubtype: connectorSubtype ?? 'ethernet' } : {}),
        label,
        x,
        y,
        circuitRef: '',
        mounting: 'ceiling',
        ceilingHeightM: DEFAULT_CEILING_HEIGHT_M,
        requirements,
        ...bill,
        templateId: tmpl.id,
      }
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: { ...fl.plan, devices: [...fl.plan.devices, dev] },
          })),
        ),
      )
    }),

  updateFloorDevice: (id, partial) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: {
              ...fl.plan,
              devices: fl.plan.devices.map((d) => (d.id === id ? { ...d, ...partial } : d)),
            },
          })),
        ),
      ),
    ),

  moveFloorDevice: (id, x, y) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: {
              ...fl.plan,
              devices: fl.plan.devices.map((d) => (d.id === id ? { ...d, x, y } : d)),
            },
          })),
        ),
      ),
    ),

  moveFloorDevicesByDelta: (ids, dxM, dyM) =>
    set((s) => {
      const next = applyMovePlanSelectionByDelta(s, [], ids, { x: dxM, y: dyM })
      if (!next) return s
      return projectMutation(s, next)
    }),

  removeFloorDevices: (ids) =>
    set((s) => {
      const rem = new Set(ids.filter(Boolean))
      if (rem.size === 0) return s
      const nextIds = s.selectionFloorDeviceIds.filter((id) => !rem.has(id))
      const nextPrimary = nextIds[0] ?? null
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            plan: { ...fl.plan, devices: fl.plan.devices.filter((d) => !rem.has(d.id)) },
            wallSheets: fl.wallSheets.map((w) => ({
              ...w,
              devices: w.devices.map((d) =>
                d.linkedFloorDeviceId && rem.has(d.linkedFloorDeviceId)
                  ? { ...d, linkedFloorDeviceId: undefined }
                  : d,
              ),
            })),
          })),
        ),
        {
          selectionFloorDeviceIds: nextIds,
          selectionFloorDeviceId: nextPrimary,
        },
      )
    }),

  removeFloorDevice: (id) => get().removeFloorDevices([id]),

  setActiveWallId: (activeWallId) => set({ activeWallId }),

  addWallSheet: () =>
    set((s) => {
      const newId = nanoid()
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const nextLabel = `Wall ${fl.wallSheets.length + 1}`
            const sheet: WallSheet = {
              id: newId,
              floorLevelId: fl.id,
              label: nextLabel,
              lengthM: 4,
              heightM: 2.8,
              devices: [],
              openings: [],
            }
            return { ...fl, wallSheets: [...fl.wallSheets, sheet] }
          }),
        ),
        { activeWallId: newId },
      )
    }),

  updateWallSheetMeta: (id, partial) =>
    set((s) => {
      const fl = activeLevel(s.project, s.activeFloorId)
      const ws = fl.wallSheets.find((w) => w.id === id)
      let applied: Partial<
        Pick<
          WallSheet,
          'label' | 'lengthM' | 'heightM' | 'roomRegionId' | 'planSpanAlongSegment01'
        >
      > = partial
      if (ws?.wallSegmentId && 'label' in partial) {
        const { label: _ignored, ...rest } = partial
        applied = rest
        if (Object.keys(rest).length === 0) return s
      }
      if (
        ws?.wallSegmentId &&
        'roomRegionId' in partial &&
        !('lengthM' in partial)
      ) {
        const merged = { ...ws, ...applied }
        const seg = fl.plan.wallSegments.find((x) => x.id === merged.wallSegmentId)
        if (seg) {
          const { lengthM, planSpanAlongSegment01 } = wallSheetChordFromPlanGeometry(
            fl,
            merged,
            seg,
          )
          applied = { ...applied, lengthM, planSpanAlongSegment01 }
        }
      }
      return projectMutation(
        s,
        touch(
          mapFloors(s, (flo) => ({
            ...flo,
            wallSheets: flo.wallSheets.map((w) =>
              w.id === id ? { ...w, ...applied } : w,
            ),
          })),
        ),
      )
    }),

  removeWallSheet: (id) => {
    set((s) => {
      const targetFloorId = s.activeFloorId ?? s.project.floors[0]!.id
      const fl = s.project.floors.find((f) => f.id === targetFloorId)
      const ws = fl?.wallSheets.find((w) => w.id === id)
      if (!fl || !ws) return s
      const hasSeg = Boolean(ws.wallSegmentId)
      // Removing one face of a plan-linked wall would just be recreated by the next
      // topology reconcile, so treat sheet-remove as "remove the underlying segment too"
      // (which removes both faces). Custom (non plan-linked) sheets remove standalone.
      const sheetsForSegment = ws.wallSegmentId
        ? fl.wallSheets.filter((w) => w.wallSegmentId === ws.wallSegmentId)
        : []
      const allDevsOnSegment = sheetsForSegment.flatMap((w) => w.devices)
      const allOpsOnSegment = sheetsForSegment.flatMap((w) => w.openings ?? [])
      if (
        ws.devices.length > 0 ||
        (ws.openings?.length ?? 0) > 0 ||
        hasSeg
      ) {
        const hasContent = hasSeg
          ? allDevsOnSegment.length > 0 || allOpsOnSegment.length > 0
          : ws.devices.length > 0 || (ws.openings?.length ?? 0) > 0
        const msg = hasContent
          ? 'Remove this wall? Wall openings and wall-mounted devices on it will be deleted and any floor device links to them will be cleared' +
            (hasSeg ? ', and the matching plan wall segment (both faces) will be removed.' : '.')
          : 'Remove this plan-linked wall? The matching floor plan segment will be removed too (both faces).'
        if (!window.confirm(msg)) {
          return s
        }
      }
      const devIds = new Set<string>()
      if (hasSeg) {
        for (const w of sheetsForSegment) for (const d of w.devices) devIds.add(d.id)
      } else {
        for (const d of ws.devices) devIds.add(d.id)
      }
      const segId = ws.wallSegmentId
      const stage1 = mapFloors(s, (fli) => {
        if (fli.id !== targetFloorId) return fli
        const cleared = clearPlanLinksToWallDeviceIds(fli, devIds)
        return {
          ...cleared,
          plan: segId
            ? {
                ...cleared.plan,
                wallSegments: cleared.plan.wallSegments.filter((w) => w.id !== segId),
              }
            : cleared.plan,
          // For plan-linked sheets: removing the segment removes every face.
          // For custom sheets: only the targeted sheet is removed.
          wallSheets: segId
            ? cleared.wallSheets.filter((w) => w.wallSegmentId !== segId)
            : cleared.wallSheets.filter((w) => w.id !== id),
        }
      })
      const nextProject = touch(
        reconcileFloorTopologyInProject(stage1, s.activeFloorId),
      )
      const nws = activeLevel(nextProject, s.activeFloorId).wallSheets
      const nextActive = s.activeWallId === id ? nws[0]?.id ?? null : s.activeWallId
      const sw = s.selectionWallDevice
      const nextSel: Partial<ProjectStore> =
        sw && (sw.wallSheetId === id || !nws.some((w) => w.id === sw.wallSheetId))
          ? { selectionWallDevice: null }
          : {}
      return projectMutation(s, nextProject, { activeWallId: nextActive, ...nextSel })
    })
  },

  syncWallsFromPlan: () =>
    set((s) =>
      projectMutation(
        s,
        touch(
          reconcileAllFloorTopologyInProject(
            mapFloors(s, (fl) => syncFloorWallsFromPlan(fl, s.project.floors)),
          ),
        ),
      ),
    ),

  setActiveWallForPlanSegment: (wallSegmentId) => {
    if (wallSegmentId == null) return
    set((s) => {
      const fl = s.project.floors.find(
        (f) => f.id === (s.activeFloorId ?? s.project.floors[0]!.id),
      )
      const list = fl?.wallSheets.filter((w) => w.wallSegmentId === wallSegmentId) ?? []
      if (list.length === 0) return s
      const regions = fl?.plan.regions ?? []
      const roomLabel = (w: WallSheet) => {
        const r = w.roomRegionId ? regions.find((x) => x.id === w.roomRegionId) : undefined
        return (r?.label ?? w.label).toLowerCase()
      }
      const sorted = [...list].sort(
        (a, b) => roomLabel(a).localeCompare(roomLabel(b)) || a.id.localeCompare(b.id),
      )
      return { activeWallId: sorted[0]!.id }
    })
  },

  addWallMountDevice: (wallId, xM, zM, templateId) =>
    set((s) => {
      const cat = s.project.deviceCatalog ?? []
      const tmpl = cat.find((t) => t.id === templateId)
      if (!tmpl) return s
      const devType = tmpl.type
      const connectorSubtype: ConnectorSubtype | undefined =
        devType === 'connector'
          ? (tmpl.connectorSubtype ?? 'ethernet')
          : undefined
      const label = tmpl.displayName?.trim() ? tmpl.displayName : String(devType)
      const requirements = mergeRequirementsWithDeviceTypeDefaults(
        devType,
        tmpl.requirements,
        connectorSubtype,
      )
      const bill = {
        productName: tmpl.productName,
        unitPrice: tmpl.unitPrice,
        billCategory: tmpl.billCategory,
      }

      if (tmpl.mounting === 'wall') {
        const wallDevId = nanoid()
        return projectMutation(
          s,
          touch(
            mapFloors(s, (fl) => {
              const ws = fl.wallSheets.find((w) => w.id === wallId)
              if (!ws) return fl
              const wallDev: WallMountDevice = {
                id: wallDevId,
                type: devType,
                ...(devType === 'connector'
                  ? { connectorSubtype: connectorSubtype ?? 'ethernet' }
                  : {}),
                label,
                xM,
                zM,
                circuitRef: '',
                requirements,
                ...bill,
                templateId: tmpl.id,
              }
              return {
                ...fl,
                wallSheets: fl.wallSheets.map((w) =>
                  w.id === wallId ? { ...w, devices: [...w.devices, wallDev] } : w,
                ),
              }
            }),
          ),
        )
      }

      const wallDevId = nanoid()
      const floorDevId = nanoid()
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const ws = fl.wallSheets.find((w) => w.id === wallId)
            if (!ws) return fl
            const xy = worldXYForWallMirrorOnPlan(fl, ws, xM)
            const wallDev: WallMountDevice = {
              id: wallDevId,
              type: devType,
              ...(devType === 'connector'
                ? { connectorSubtype: connectorSubtype ?? 'ethernet' }
                : {}),
              label,
              xM,
              zM,
              circuitRef: '',
              requirements,
              ...bill,
              linkedFloorDeviceId: floorDevId,
              templateId: tmpl.id,
            }
            const floorDev: FloorDevice = {
              id: floorDevId,
              type: devType,
              ...(devType === 'connector'
                ? { connectorSubtype: connectorSubtype ?? 'ethernet' }
                : {}),
              label,
              x: xy.x,
              y: xy.y,
              circuitRef: '',
              mounting: 'wall',
              requirements,
              ...bill,
              linkedWallDeviceId: wallDevId,
              templateId: tmpl.id,
            }
            return {
              ...fl,
              plan: { ...fl.plan, devices: [...fl.plan.devices, floorDev] },
              wallSheets: fl.wallSheets.map((w) =>
                w.id === wallId ? { ...w, devices: [...w.devices, wallDev] } : w,
              ),
            }
          }),
        ),
      )
    }),

  moveWallMountDevice: (wallId, deviceId, xM, zM) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const ws = fl.wallSheets.find((w) => w.id === wallId)
            const victim = ws?.devices.find((d) => d.id === deviceId)
            const xy =
              ws && victim ? worldXYForWallMirrorOnPlan(fl, ws, xM) : null
            const linkId = victim?.linkedFloorDeviceId
            return {
              ...fl,
              plan:
                linkId && xy
                  ? {
                      ...fl.plan,
                      devices: fl.plan.devices.map((d) =>
                        d.id === linkId ? { ...d, x: xy.x, y: xy.y } : d,
                      ),
                    }
                  : fl.plan,
              wallSheets: fl.wallSheets.map((w) =>
                w.id === wallId
                  ? {
                      ...w,
                      devices: w.devices.map((d) =>
                        d.id === deviceId ? { ...d, xM, zM } : d,
                      ),
                    }
                  : w,
              ),
            }
          }),
        ),
      ),
    ),

  updateWallMountDevice: (wallId, deviceId, partial) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => ({
            ...fl,
            wallSheets: fl.wallSheets.map((w) =>
              w.id === wallId
                ? {
                    ...w,
                    devices: w.devices.map((d) =>
                      d.id === deviceId ? { ...d, ...partial } : d,
                    ),
                  }
                : w,
            ),
          })),
        ),
      ),
    ),

  removeWallMountDevice: (wallId, deviceId) =>
    set((s) => {
      const fl = activeLevel(s.project, s.activeFloorId)
      const ws = fl.wallSheets.find((w) => w.id === wallId)
      const victim = ws?.devices.find((d) => d.id === deviceId)
      const linkedFloorId = victim?.linkedFloorDeviceId
      const nextSelFloor: Partial<ProjectStore> = {}
      if (linkedFloorId) {
        if (s.selectionFloorDeviceIds.some((id) => id === linkedFloorId)) {
          const next = s.selectionFloorDeviceIds.filter((id) => id !== linkedFloorId)
          nextSelFloor.selectionFloorDeviceIds = next
          nextSelFloor.selectionFloorDeviceId = next[0] ?? null
        } else if (s.selectionFloorDeviceId === linkedFloorId) {
          nextSelFloor.selectionFloorDeviceId = null
          nextSelFloor.selectionFloorDeviceIds = []
        }
      }
      const nextSelWall =
        s.selectionWallDevice?.wallSheetId === wallId &&
        s.selectionWallDevice?.deviceId === deviceId
          ? { selectionWallDevice: null as WallDeviceSelection | null }
          : {}
      return projectMutation(
        s,
        touch(
          mapFloors(s, (floor) => ({
            ...floor,
            plan: linkedFloorId
              ? {
                  ...floor.plan,
                  devices: floor.plan.devices.filter((d) => d.id !== linkedFloorId),
                }
              : floor.plan,
            wallSheets: floor.wallSheets.map((w) =>
              w.id === wallId
                ? { ...w, devices: w.devices.filter((d) => d.id !== deviceId) }
                : w,
            ),
          })),
        ),
        { ...nextSelFloor, ...nextSelWall },
      )
    }),

  addWallOpening: (wallId, xM, zM) =>
    set((s) => {
      const newId = nanoid()
      const kind = s.wallOpeningKind
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const ws = fl.wallSheets.find((w) => w.id === wallId)
            if (!ws) return fl
            const o: WallOpening = {
              id: newId,
              ...newWallOpeningMeters(ws, kind, xM, zM),
            }
            // Propagate to every sheet on the same plan segment whose chord overlaps.
            return insertGroupedOpening(fl, wallId, o)
          }),
        ),
        { selectionWallOpening: { wallSheetId: wallId, openingId: newId } },
      )
    }),

  moveWallOpening: (wallId, openingId, xM, zM) =>
    set((s) =>
      projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => {
            const ws = fl.wallSheets.find((w) => w.id === wallId)
            const o = ws?.openings.find((x) => x.id === openingId)
            if (!ws || !o) return fl
            const clamped = clampWallOpeningMeters(ws, { ...o, xM, zM })
            return updateGroupedOpening(fl, wallId, openingId, {
              xM: clamped.xM,
              zM: clamped.zM,
              widthM: clamped.widthM,
              heightM: clamped.heightM,
              label: clamped.label,
            })
          }),
        ),
      ),
    ),

  removeWallOpening: (wallId, openingId) =>
    set((s) => {
      const clear =
        s.selectionWallOpening?.wallSheetId === wallId &&
        s.selectionWallOpening?.openingId === openingId
          ? { selectionWallOpening: null as WallOpeningSelection | null }
          : {}
      return projectMutation(
        s,
        touch(
          mapFloors(s, (fl) => removeGroupedOpening(fl, wallId, openingId)),
        ),
        clear,
      )
    }),

  setPanelSlot: (row, col, partial) =>
    set((s) => {
      const p: PanelBoard = { ...s.project.panel }
      const at = p.slots.find((x) => x.row === row && x.col === col)
      if (!at) return {}
      let eff = { ...partial }
      if (partial.spanWidthTe != null) {
        const req = Math.max(1, Math.floor(partial.spanWidthTe))
        let w = req
        if (!canPlaceAt(p.slots, p.widthTe, row, col, w, at.id)) {
          w = maxPlaceableWidth(p.slots, p.widthTe, row, col, at.id)
        }
        eff = { ...eff, spanWidthTe: Math.max(1, w) }
      }
      const slots = p.slots.map((slot) => {
        if (slot.row !== row || slot.col !== col) return slot
        const next = { ...slot, ...eff } as typeof slot
        if (partial.moduleType != null) {
          next.productName = defaultPanelProductName(
            next.row,
            next.col,
            next.moduleType,
            next.label,
          )
        }
        return next
      })
      const re = reconcilePanelSpans(slots, p.widthTe)
      return projectMutation(s, touch({ ...s.project, panel: { ...p, slots: re } }))
    }),

  setPanelDimensions: (rows, widthTe) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          panel: resizePanelBoard(s.project.panel, rows, widthTe),
        }),
        { selectedPanelSlot: null },
      ),
    ),

  updatePanelSlot: (slotId, partial) =>
    set((s) => {
      const p = s.project.panel
      const target = p.slots.find((x) => x.id === slotId)
      if (!target) return {}
      let part = { ...partial }
      if (partial.spanWidthTe != null) {
        const req = Math.max(1, Math.floor(partial.spanWidthTe))
        let w = req
        if (!canPlaceAt(p.slots, p.widthTe, target.row, target.col, w, target.id)) {
          w = maxPlaceableWidth(p.slots, p.widthTe, target.row, target.col, target.id)
        }
        part = { ...part, spanWidthTe: Math.max(1, w) }
      }
      let slots = p.slots.map((slot) => {
        if (slot.id !== slotId) return slot
        const next = { ...slot, ...part }
        if (part.moduleType != null) {
          next.productName = defaultPanelProductName(
            next.row,
            next.col,
            next.moduleType,
            next.label,
          )
        }
        return next
      })
      slots = reconcilePanelSpans(slots, p.widthTe)
      return projectMutation(s, touch({ ...s.project, panel: { ...p, slots } }))
    }),

  addPanelModuleTemplate: () =>
    set((s) => {
      const t: PanelModuleTemplate = {
        id: nanoid(),
        label: '',
        moduleType: 'mcb',
        spanWidthTe: 1,
        circuitRef: '',
        ...defaultBillableFields({ productName: 'New module' }),
      }
      return projectMutation(
        s,
        touch({
          ...s.project,
          panel: {
            ...s.project.panel,
            modulePalette: [...(s.project.panel.modulePalette ?? []), t],
          },
        }),
      )
    }),

  updatePanelModuleTemplate: (id, partial) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          panel: {
            ...s.project.panel,
            modulePalette: (s.project.panel.modulePalette ?? []).map((m) =>
              m.id === id ? { ...m, ...partial } : m,
            ),
          },
        }),
      ),
    ),

  removePanelModuleTemplate: (id) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          panel: {
            ...s.project.panel,
            modulePalette: (s.project.panel.modulePalette ?? []).filter((m) => m.id !== id),
          },
        }),
      ),
    ),

  addDeviceTemplate: (partial) =>
    set((s) => {
      const type = partial?.type ?? 'generic_eth_device'
      const mounting = partial?.mounting ?? 'ceiling'
      const connectorSubtype: ConnectorSubtype | undefined =
        type === 'connector' ? (partial?.connectorSubtype ?? 'ethernet') : undefined
      const displayName = partial?.displayName?.trim() || 'New device'
      const productName =
        partial?.productName?.trim() || displayName
      const t: DeviceTemplate = {
        id: nanoid(),
        displayName,
        type,
        mounting,
        connectorSubtype,
        requirements: mergeRequirementsWithDeviceTypeDefaults(
          type,
          partial?.requirements,
          connectorSubtype,
        ),
        manufacturerLine: partial?.manufacturerLine?.trim() || undefined,
        catalogCode: partial?.catalogCode?.trim() || undefined,
        ...defaultBillableFields({
          productName,
          unitPrice: partial?.unitPrice,
        }),
      }
      return projectMutation(
        s,
        touch({
          ...s.project,
          deviceCatalog: [...(s.project.deviceCatalog ?? []), t],
        }),
      )
    }),

  updateDeviceTemplate: (id, partial) =>
    set((s) => {
      const cat = s.project.deviceCatalog ?? []
      const i = cat.findIndex((t) => t.id === id)
      if (i < 0) return s
      const merged: DeviceTemplate = { ...cat[i]!, ...partial, id: cat[i]!.id }
      const nextCat = cat.map((t, j) => (j === i ? merged : t))
      let nextProject: PlanstudioProject = { ...s.project, deviceCatalog: nextCat }
      nextProject = syncProjectDevicesWithCatalogTemplate(nextProject, id, merged)
      return projectMutation(s, touch(nextProject))
    }),

  removeDeviceTemplate: (id) =>
    set((s) => {
      const n = countInstancesForTemplate(s.project, id)
      if (
        n > 0 &&
        !window.confirm(
          `Remove this catalog device and delete ${n} floor/wall instance${n === 1 ? '' : 's'} project-wide? You can use Undo afterward if this was a mistake.`,
        )
      ) {
        return s
      }
      const { project: nextProject, removedDeviceIds } = applyCatalogTemplateRemoval(
        s.project,
        id,
      )
      const removed = new Set(removedDeviceIds)
      const sel: Partial<ProjectStore> = {}
      if (s.selectionFloorDeviceIds.some((id) => removed.has(id))) {
        const next = s.selectionFloorDeviceIds.filter((id) => !removed.has(id))
        sel.selectionFloorDeviceIds = next
        sel.selectionFloorDeviceId = next[0] ?? null
      } else if (s.selectionFloorDeviceId && removed.has(s.selectionFloorDeviceId)) {
        sel.selectionFloorDeviceId = null
        sel.selectionFloorDeviceIds = []
      }
      const sw = s.selectionWallDevice
      if (sw && removed.has(sw.deviceId)) {
        sel.selectionWallDevice = null
      }
      return projectMutation(s, touch(nextProject), sel)
    }),

  placeFromPanelPalette: (templateId, row, col) =>
    set((s) => {
      const t = (s.project.panel.modulePalette ?? []).find((m) => m.id === templateId)
      if (!t) return {}
      const p: PanelBoard = s.project.panel
      const maxP = maxPlaceableWidth(p.slots, p.widthTe, row, col)
      if (maxP < 1) return {}
      const effW = Math.min(Math.max(1, t.spanWidthTe), maxP)
      if (!canPlaceAt(p.slots, p.widthTe, row, col, effW)) return {}
      const newAnchorId = nanoid()
      const newSlots: PanelSlot[] = p.slots.map((sl) => {
        if (sl.row !== row || sl.col < col || sl.col >= col + effW) return sl
        if (sl.col === col) {
          return {
            id: newAnchorId,
            row,
            col,
            moduleType: t.moduleType,
            label: t.label,
            circuitRef: t.circuitRef,
            spanWidthTe: effW,
            manufacturerLine: t.manufacturerLine,
            catalogCode: t.catalogCode,
            description: t.description,
            ratingA: t.ratingA,
            dinRailSegmentMm: t.dinRailSegmentMm,
            railConsumeMm: t.railConsumeMm,
            knxLineId: t.knxLineId,
            ...defaultBillableFields({
              productName:
                t.productName.trim() !== ''
                  ? t.productName
                  : defaultPanelProductName(row, col, t.moduleType, t.label),
              unitPrice: t.unitPrice,
            }),
          }
        }
        return { ...emptyPanelSlot(row, sl.col), id: nanoid() }
      })
      const re = reconcilePanelSpans(newSlots, p.widthTe)
      return projectMutation(
        s,
        touch({ ...s.project, panel: { ...p, slots: re } }),
        { selectedPanelSlot: { row, col } },
      )
    }),

  reapplyFloorDeviceRequirementDefaults: (id) =>
    set((s) => {
      const fl = activeLevel(s.project, s.activeFloorId)
      const d = fl.plan.devices.find((x) => x.id === id)
      if (!d) return s
      const tmpl =
        d.templateId != null
          ? (s.project.deviceCatalog ?? []).find((t) => t.id === d.templateId)
          : undefined
      const req = tmpl
        ? mergeRequirementsWithDeviceTypeDefaults(
            tmpl.type,
            tmpl.requirements,
            tmpl.type === 'connector' ? tmpl.connectorSubtype : undefined,
          )
        : defaultRequirementsForDeviceType(d.type, d.connectorSubtype)
      return projectMutation(
        s,
        touch(
          mapFloors(s, (flo) => ({
            ...flo,
            plan: {
              ...flo.plan,
              devices: flo.plan.devices.map((dv) =>
                dv.id === id ? { ...dv, requirements: req } : dv,
              ),
            },
          })),
        ),
      )
    }),

  reapplyWallMountDeviceRequirementDefaults: (wallId, deviceId) =>
    set((s) => {
      const fl = activeLevel(s.project, s.activeFloorId)
      const ws = fl.wallSheets.find((w) => w.id === wallId)
      const d = ws?.devices.find((x) => x.id === deviceId)
      if (!d) return s
      const tmpl =
        d.templateId != null
          ? (s.project.deviceCatalog ?? []).find((t) => t.id === d.templateId)
          : undefined
      const req = tmpl
        ? mergeRequirementsWithDeviceTypeDefaults(
            tmpl.type,
            tmpl.requirements,
            tmpl.type === 'connector' ? tmpl.connectorSubtype : undefined,
          )
        : defaultRequirementsForDeviceType(d.type, d.connectorSubtype)
      return projectMutation(
        s,
        touch(
          mapFloors(s, (flo) => ({
            ...flo,
            wallSheets: flo.wallSheets.map((w) =>
              w.id === wallId
                ? {
                    ...w,
                    devices: w.devices.map((dv) =>
                      dv.id === deviceId ? { ...dv, requirements: req } : dv,
                    ),
                  }
                : w,
            ),
          })),
        ),
      )
    }),

  setRackTotalRU: (totalRU) =>
    set((s) => {
      const total = Math.max(1, Math.min(48, totalRU))
      const rack = { ...s.project.rack, totalRU: total }
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: { ...rack, gear: normalizeRackGearList(rack.gear, total) },
        }),
      )
    }),

  setRackWidthLabel: (widthLabel) =>
    set((s) =>
      projectMutation(
        s,
        touch({ ...s.project, rack: { ...s.project.rack, widthLabel } }),
      ),
    ),

  updateRackEnclosure: (partial) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          rack: { ...s.project.rack, ...partial },
        }),
      ),
    ),

  addRackGear: () =>
    set((s) => {
      const total = s.project.rack.totalRU
      const gear = {
        id: nanoid(),
        ...defaultBillableFields({ productName: 'New item' }),
        startRU: 1,
        heightRU: 1,
        notes: '',
        rj45PortCount: 0,
        sfpPortCount: 0,
      }
      const c = clampRackGear(total, gear)
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            gear: [...s.project.rack.gear, { ...gear, ...c }],
          },
        }),
      )
    }),

  addRackGearFromPalette: (paletteTemplateId) =>
    set((s) => {
      const tmpl = s.project.rackGearPalette.find((x) => x.id === paletteTemplateId)
      if (!tmpl) return {}
      const total = s.project.rack.totalRU
      const heightRU = Math.max(1, Math.min(total, Math.floor(tmpl.heightRU) || 1))
      const gearList = s.project.rack.gear
      let startRU = findNextFreeRackStartRu(gearList, total, heightRU)
      if (startRU === null) {
        const maxStart = Math.max(1, total - heightRU + 1)
        const raw = window.prompt(
          `No free contiguous RU for ${heightRU}U. Enter bottom start RU (1–${maxStart}); may overlap existing gear:`,
          '1',
        )
        if (raw === null) return {}
        const parsed = Number.parseInt(raw.trim(), 10)
        if (!Number.isFinite(parsed)) return {}
        startRU = Math.max(1, Math.min(maxStart, parsed))
      }
      const newId = nanoid()
      const gear = {
        id: newId,
        ...defaultBillableFields({
          productName: tmpl.productName,
          unitPrice: tmpl.unitPrice,
          billCategory: tmpl.billCategory,
        }),
        startRU,
        heightRU,
        notes: '',
        rj45PortCount: 0,
        sfpPortCount: 0,
      }
      const c = clampRackGear(total, gear)
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            gear: [...s.project.rack.gear, { ...gear, ...c }],
          },
        }),
        { selectedRackGearId: newId },
      )
    }),

  updateRackGear: (id, partial) =>
    set((s) => {
      const total = s.project.rack.totalRU
      const nextGear = s.project.rack.gear.map((g) => {
        if (g.id !== id) return g
        const merged = { ...g, ...partial }
        const c = clampRackGear(total, merged)
        return { ...merged, ...c }
      })
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            gear: nextGear,
            portLinks: pruneInvalidPortLinks(nextGear, s.project.rack.portLinks),
          },
        }),
      )
    }),

  removeRackGear: (id) =>
    set((s) => {
      const nextGear = s.project.rack.gear.filter((g) => g.id !== id)
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            gear: nextGear,
            portLinks: s.project.rack.portLinks.filter(
              (l) => l.from.gearId !== id && l.to.gearId !== id,
            ),
          },
        }),
      )
    }),

  addRackPortLink: (from, to) =>
    set((s) => {
      if (from.gearId === to.gearId) return {}
      if (from.portKind !== to.portKind) return {}
      if (from.portKind !== 'rj45' && from.portKind !== 'sfp') return {}
      const gear = s.project.rack.gear
      if (!portEndpointValid(gear, from) || !portEndpointValid(gear, to)) return {}
      const next: typeof s.project.rack.portLinks = [
        ...s.project.rack.portLinks,
        { id: nanoid(), from, to },
      ]
      const portLinks = pruneInvalidPortLinks(gear, next)
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: { ...s.project.rack, portLinks },
        }),
      )
    }),

  removeRackPortLink: (linkId) =>
    set((s) =>
      projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            portLinks: s.project.rack.portLinks.filter((l) => l.id !== linkId),
          },
        }),
      ),
    ),

  duplicateRackGear: (gearId) =>
    set((s) => {
      const src = s.project.rack.gear.find((g) => g.id === gearId)
      if (!src) return {}
      const total = s.project.rack.totalRU
      const heightRU = Math.max(1, Math.min(total, Math.floor(src.heightRU) || 1))
      const gearList = s.project.rack.gear
      const occ = occupiedRuSet(gearList)

      let startRU: number | undefined
      const belowStart = src.startRU - heightRU
      if (belowStart >= 1 && rackSlotIsFree(occ, total, belowStart, heightRU)) {
        startRU = belowStart
      } else {
        const next = findNextFreeRackStartRu(gearList, total, heightRU)
        if (next !== null) startRU = next
      }

      if (startRU === undefined) {
        const maxStart = Math.max(1, total - heightRU + 1)
        const raw = window.prompt(
          `No free contiguous RU for duplicate (${heightRU}U). Enter bottom start RU (1–${maxStart}); may overlap existing gear:`,
          String(Math.max(1, Math.min(maxStart, src.startRU))),
        )
        if (raw === null) return {}
        const parsed = Number.parseInt(raw.trim(), 10)
        if (!Number.isFinite(parsed)) return {}
        startRU = Math.max(1, Math.min(maxStart, parsed))
      }

      const newId = nanoid()
      const gear: RackGear = {
        id: newId,
        productName: src.productName,
        unitPrice: src.unitPrice,
        billCategory: src.billCategory,
        startRU,
        heightRU,
        notes: src.notes,
        rj45PortCount: src.rj45PortCount ?? 0,
        sfpPortCount: src.sfpPortCount ?? 0,
      }
      const c = clampRackGear(total, gear)
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: {
            ...s.project.rack,
            gear: [...s.project.rack.gear, { ...gear, ...c }],
          },
        }),
        { selectedRackGearId: newId },
      )
    }),

  setRackPatchPanelLink: (deviceId, patchLabel) =>
    set((s) => {
      const trimmed = patchLabel.trim()
      const prev = s.project.rack.patchPanelLinks
      const next: RackPatchPanelLink[] =
        trimmed === ''
          ? prev.filter((x) => x.deviceId !== deviceId)
          : [...prev.filter((x) => x.deviceId !== deviceId), { deviceId, patchLabel: trimmed }]
      return projectMutation(
        s,
        touch({
          ...s.project,
          rack: { ...s.project.rack, patchPanelLinks: next },
        }),
      )
    }),

  resetProject: () => {
    const p = createInitialProject()
    runWithoutHistory(() => {
      set({
        project: p,
        activeFloorId: p.floors[0]!.id,
        activeWallId: p.floors[0]!.wallSheets[0]?.id ?? null,
        historyPast: [],
        historyFuture: [],
        ...defaultUi(),
      })
    })
  },

  loadProject: (raw) => {
    let project: PlanstudioProject
    try {
      // After schema validation + defaults, reconcile auto-room topology and align
      // plan-linked wall sheet names (safe on any JSON load / reopen, not just first import).
      project = syncAllPlanWallSheetLabels(
        reconcileAllFloorTopologyInProject(normalizeProject(raw)),
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load project file.'
      window.alert(msg)
      return
    }
    runWithoutHistory(() => {
      set({
        project: touch(project),
        activeFloorId: project.floors[0]!.id,
        activeWallId: project.floors[0]!.wallSheets[0]?.id ?? null,
        historyPast: [],
        historyFuture: [],
        ...defaultUi(),
      })
    })
  },

  replaceProjectFromImport: (project) => {
    const next = touch(
      syncAllPlanWallSheetLabels(reconcileAllFloorTopologyInProject(project)),
    )
    runWithoutHistory(() => {
      set({
        project: next,
        activeFloorId: next.floors[0]!.id,
        activeWallId: next.floors[0]!.wallSheets[0]?.id ?? null,
        historyPast: [],
        historyFuture: [],
        ...defaultUi(),
      })
    })
  },

  undo: () => {
    runWithoutHistory(() => {
      set((s) => {
        if (s.historyPast.length === 0) return s
        const past = [...s.historyPast]
        const prev = past.pop()!
        return {
          project: prev,
          historyPast: past,
          historyFuture: [cloneProject(s.project), ...s.historyFuture],
          ...reconcileAfterProjectRestore({ ...s, project: prev }),
        }
      })
    })
  },

  redo: () => {
    runWithoutHistory(() => {
      set((s) => {
        if (s.historyFuture.length === 0) return s
        const next = s.historyFuture[0]
        if (!next) return s
        const restFuture = s.historyFuture.slice(1)
        return {
          project: next,
          historyPast: appendPast(s.historyPast, cloneProject(s.project)),
          historyFuture: restFuture,
          ...reconcileAfterProjectRestore({ ...s, project: next }),
        }
      })
    })
  },
}))

