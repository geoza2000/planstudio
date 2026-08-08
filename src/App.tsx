import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import './App.css'
import { FloorPlanEditor } from './components/FloorPlanEditor'
import { PanelEditor } from './components/PanelEditor'
import { PanelModulePaletteList } from './components/PanelModulePaletteList'
import { RackEditor } from './components/RackEditor'
import { WallElevationEditor } from './components/WallElevationEditor'
import { DeviceCatalogPanel } from './components/DeviceCatalogEditor'
import { DeviceTemplatePalette } from './components/DeviceTemplatePalette'
import { KnxBusDeviceFields } from './components/KnxBusDeviceFields'
import { UnlinkedDevicesImportModal } from './components/UnlinkedDevicesImportModal'
import { WallConstructionFields } from './components/WallConstructionFields'
import { FurnishEditor } from './components/FurnishEditor'
import { FurniturePalette } from './components/FurniturePalette'
import { FurnitureInspector } from './components/FurnitureInspector'
import { WallOpeningInspector } from './components/WallOpeningInspector'
import { RenderPromptModal } from './components/RenderPromptModal'
import { RoomListPanel } from './components/RoomListPanel'
import {
  downloadBlob,
  downloadJson,
  slug,
  stageToPngDataUrl,
} from './lib/exporters'
import { buildBom } from './lib/bom'
import { pdfDeviceProductCell } from './lib/deviceCatalog'
import { buildProjectPdfBlob, type ProjectPdfFloorPart } from './lib/projectPdfDocument'
import { renderRoomIsolationPngDataUrl } from './lib/renderRoomPlanIsolation'
import {
  aggregateShoppingLines,
  buildPanelEquipmentPriceTable,
  buildPdfDeviceListEntries,
  buildRackEquipmentPriceTable,
  buildShoppingPriceTable,
  formatProjectMetaLines,
  shoppingGroupsByFloor,
  shoppingGroupsByManufacturer,
} from './lib/projectPdfData'
import { DIN_SCALE_TOOLTIP } from './lib/dinScale'
import {
  isProjectFile,
  normalizeProject,
  stripLeadingUtf8Bom,
  validateProjectSchemaVersion,
} from './lib/projectLoad'
import { anchorSlotForCell } from './lib/panelSpans'
import { DEFAULT_CEILING_HEIGHT_M } from './lib/floorDeviceCluster'
import { mergeRequirementsWithDeviceTypeDefaults } from './lib/requirementDefaults'
import {
  buildPlanVsPanelRackRows,
  buildRequirementsSummary,
  collectEthernetClassPlanDevices,
  panelDinRollup,
  planVsRowsForRequirementsRailTab,
  rackOccupiedRUHigh,
} from './lib/requirementsAggregate'
import {
  effectiveWallMaterial,
  effectiveWallThicknessM,
  MAX_WALL_THICKNESS_M,
  MIN_WALL_THICKNESS_M,
} from './lib/wallConstruction'
import { useUndoHotkeys } from './hooks/useUndoHotkeys'
import { useProjectStore } from './store/projectStore'
import type {
  ConnectorSubtype,
  DeviceRequirements,
  DeviceType,
  EditorTab,
  FloorDeviceMounting,
  FloorTool,
  Id,
  PlanstudioProject,
  RackFrame,
  WallSheet,
} from './types/project'
import {
  CONNECTOR_SUBTYPES,
  DEVICE_TYPES,
  regionIsExternal,
  SCHEMA_VERSION,
  WALL_MATERIALS,
  wallMaterialLabel,
  type WallMaterial,
} from './types/project'
import { listUnlinkedPlanWallDevices } from './lib/unlinkedDeviceMigration'
import {
  segmentAngleDegFromPlusX,
  segmentLengthM,
} from './lib/wallPlanSync'

type RequirementsRollupVariant = 'panel' | 'rack' | 'full'

function RequirementsRollupPanel({
  variant,
  reqRollup,
  panelDinActive,
  planVsPanelRackRows,
  rack,
  ethernetPlanDevices,
  onPatchLabelChange,
}: {
  variant: RequirementsRollupVariant
  reqRollup: ReturnType<typeof buildRequirementsSummary>
  panelDinActive: ReturnType<typeof panelDinRollup>
  planVsPanelRackRows: ReturnType<typeof buildPlanVsPanelRackRows>
  rack?: RackFrame
  ethernetPlanDevices?: ReturnType<typeof collectEthernetClassPlanDevices>
  onPatchLabelChange?: (deviceId: Id, patchLabel: string) => void
}) {
  const tabFilter = variant === 'full' ? 'full' : variant === 'panel' ? 'panel' : 'rack'
  const planVsRows = planVsRowsForRequirementsRailTab(tabFilter, planVsPanelRackRows)

  const rackHi = rack ? rackOccupiedRUHigh(rack) : 0
  const rackSpare = rack ? Math.max(0, rack.totalRU - rackHi) : 0
  const patchLinks = rack?.patchPanelLinks ?? []
  const patchLinkedCount = patchLinks.filter((l) => l.patchLabel.trim() !== '').length

  return (
    <div className="panel-block">
      <h3 className="side-heading">Roll-up</h3>
      {variant === 'panel' ? (
        <>
          <p className="muted small" title={DIN_SCALE_TOOLTIP}>
            Panel context: DIN and slot occupancy vs plan-wide device metrics (same floor/wall rules
            as BOM). DIN scale: 17.5 mm per TE.
          </p>
          <ul className="muted small" style={{ paddingLeft: '1.1rem', lineHeight: 1.6 }}>
            <li>Plan devices counted: {reqRollup.deviceCount}</li>
            <li>DIN TE required (Σ metrics): {reqRollup.totalDinTe}</li>
            <li>DIN rail mm required (Σ metrics): {reqRollup.totalDinRailMm}</li>
            <li>Panel occupied TE (slots with data): {panelDinActive.occupiedTe}</li>
            <li>Panel rail mm (slot fields): {panelDinActive.railMm}</li>
            <li>Plan PoE watts (Σ, not on grid): {reqRollup.totalPoeWatts}</li>
            <li>Plan Ethernet ports (Σ): {reqRollup.totalEthernetPorts}</li>
            <li>KNX outputs / actuators (flags): {reqRollup.knxOutputActuatorCount}</li>
            <li>KNX binary inputs / switches (flags): {reqRollup.knxBinaryInputCount}</li>
            <li>KNX bus sensors (flags): {reqRollup.knxBusSensorCount}</li>
          </ul>
        </>
      ) : variant === 'rack' ? (
        <>
          <p className="muted small">
            Rack context: U usage, gear rows, cabling hints from the plan (Ethernet-class devices
            use the same rules as BOM / requirements). Patch labels are stored on the rack JSON.
          </p>
          {rack ? (
            <ul className="muted small" style={{ paddingLeft: '1.1rem', lineHeight: 1.6 }}>
              <li>
                Rack U (high occupied / total): {rackHi} / {rack.totalRU} U ({rackSpare} U spare)
              </li>
              <li>Gear rows: {rack.gear.length}</li>
              <li>Ethernet-class plan devices: {ethernetPlanDevices?.length ?? 0}</li>
              <li>Σ Ethernet ports (device metrics): {reqRollup.totalEthernetPorts}</li>
              <li>Patch assignments (non-empty label): {patchLinkedCount}</li>
              <li>PoE watts (Σ plan, PDU hint): {reqRollup.totalPoeWatts}</li>
              <li>Cameras / readers (homerun hint): {reqRollup.cameraCount} / {reqRollup.readerCount}</li>
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <p className="muted small" title={DIN_SCALE_TOOLTIP}>
            All project floors: device requirements from floor + wall (same rules as BOM: wall rows
            linked to a plan device are omitted). DIN scale: 17.5 mm per TE. Panel and rack are
            project-wide.
          </p>
          <ul className="muted small" style={{ paddingLeft: '1.1rem', lineHeight: 1.6 }}>
            <li>Devices counted: {reqRollup.deviceCount}</li>
            <li>DIN TE (device metrics): {reqRollup.totalDinTe}</li>
            <li>Rail mm (device metrics): {reqRollup.totalDinRailMm}</li>
            <li>PoE watts (Σ): {reqRollup.totalPoeWatts}</li>
            <li>Ethernet ports (Σ): {reqRollup.totalEthernetPorts}</li>
            <li>Cameras (by kind): {reqRollup.cameraCount}</li>
            <li>Readers (by kind): {reqRollup.readerCount}</li>
            <li>KNX outputs / actuators (flags): {reqRollup.knxOutputActuatorCount}</li>
            <li>KNX binary inputs / switches (flags): {reqRollup.knxBinaryInputCount}</li>
            <li>KNX bus sensors (flags): {reqRollup.knxBusSensorCount}</li>
            <li>Panel occupied TE (slots with data): {panelDinActive.occupiedTe}</li>
            <li>Panel rail mm (slot fields): {panelDinActive.railMm}</li>
          </ul>
        </>
      )}
      <h3 className="side-heading" style={{ marginTop: '1rem' }}>
        Plan vs panel / rack
      </h3>
      <p className="muted small">
        {variant === 'panel'
          ? 'Rows below omit pure rack-U when you are on the Panel tab. Required = all floors (floor + unlinked wall).'
          : variant === 'rack'
            ? 'Rows below omit DIN metrics on the Rack tab; rack U and cabling hints stay visible.'
            : 'Required = all project floors (floor + unlinked wall devices, same as roll-up). Gap = Required − Panel − Rack when all three are numeric; otherwise — (hover for hint).'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="bom-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Required</th>
              <th>Panel</th>
              <th>Rack</th>
              <th>Gap</th>
            </tr>
          </thead>
          <tbody>
            {planVsRows.map((row) => (
              <tr key={row.metric}>
                <td>{row.metric}</td>
                <td title={row.required.hint}>{row.required.text}</td>
                <td title={row.panel.hint}>{row.panel.text}</td>
                <td title={row.rack.hint}>{row.rack.text}</td>
                <td title={row.gap.hint}>{row.gap.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {variant === 'rack' && ethernetPlanDevices && rack && onPatchLabelChange ? (
        <>
          <h3 className="side-heading" style={{ marginTop: '1rem' }}>
            Ethernet-class devices → patch field
          </h3>
          <p className="muted small">
            Read-only listing from plan/wall (BOM scope). Enter a patch port label (e.g. P1-12);
            cleared field removes the link. Persists on <code>rack.patchPanelLinks</code> with undo.
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="bom-table">
              <thead>
                <tr>
                  <th>Floor</th>
                  <th>Surface</th>
                  <th>Kind</th>
                  <th>Label</th>
                  <th>Eth ports</th>
                  <th>Circuit</th>
                  <th>Patch label</th>
                </tr>
              </thead>
              <tbody>
                {ethernetPlanDevices.map((row) => {
                  const link = patchLinks.find((l) => l.deviceId === row.deviceId)
                  return (
                    <tr key={row.deviceId}>
                      <td>{row.floorLabel}</td>
                      <td>{row.surface}</td>
                      <td>{row.kindLabel}</td>
                      <td>{row.label}</td>
                      <td>{row.ethernetPorts}</td>
                      <td>{row.circuitRef || '—'}</td>
                      <td>
                        <input
                          aria-label={`Patch label for ${row.label}`}
                          value={link?.patchLabel ?? ''}
                          placeholder="e.g. P1-12"
                          onChange={(e) => onPatchLabelChange(row.deviceId, e.target.value)}
                          style={{ width: '6.5rem', fontSize: '0.85rem' }}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Floor S/W/R shortcuts: skip when focus is in a field (activeElement; capture-safe). */
function isFloorToolHotkeySuppressed(): boolean {
  const el = document.activeElement
  if (!el || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'))
}

function App() {
  const project = useProjectStore((s) => s.project)
  const activeFloorId = useProjectStore((s) => s.activeFloorId)
  const setActiveFloorId = useProjectStore((s) => s.setActiveFloorId)
  const addFloorLevel = useProjectStore((s) => s.addFloorLevel)
  const removeFloorLevel = useProjectStore((s) => s.removeFloorLevel)
  const setFloorLevelLabel = useProjectStore((s) => s.setFloorLevelLabel)
  const duplicateFloorLevel = useProjectStore((s) => s.duplicateFloorLevel)
  const moveFloorLevel = useProjectStore((s) => s.moveFloorLevel)
  const activeTab = useProjectStore((s) => s.activeTab)
  const setActiveTabRaw = useProjectStore((s) => s.setActiveTab)
  const setActiveTab = (tab: EditorTab) => {
    const ft = useProjectStore.getState().floorTool
    setActiveTabRaw(tab)
    if (tab === 'floor' && ft === 'opening') {
      useProjectStore.getState().setFloorTool('select')
    }
    if (tab !== 'floor' && (ft === 'wall' || ft === 'region')) {
      useProjectStore.getState().setFloorTool('select')
    }
  }
  const setProjectName = useProjectStore((s) => s.setProjectName)
  const knxLines = useProjectStore((s) => s.project.knxLines)
  const setKnxLines = useProjectStore((s) => s.setKnxLines)
  const addKnxLine = useProjectStore((s) => s.addKnxLine)
  const removeKnxLine = useProjectStore((s) => s.removeKnxLine)
  const setFloorSize = useProjectStore((s) => s.setFloorSize)
  const setFloorLabel = useProjectStore((s) => s.setFloorLabel)
  const floorTool = useProjectStore((s) => s.floorTool)
  const setFloorTool = useProjectStore((s) => s.setFloorTool)
  const setWallOpeningKind = useProjectStore((s) => s.setWallOpeningKind)
  const wallOpeningKind = useProjectStore((s) => s.wallOpeningKind)
  const snapGridM = useProjectStore((s) => s.project.editorSettings.snapGridM)
  const setSnapGridM = useProjectStore((s) => s.setSnapGridM)
  const wallOrtho = useProjectStore((s) => s.project.editorSettings.wallOrtho)
  const setWallOrtho = useProjectStore((s) => s.setWallOrtho)
  const editorSettings = useProjectStore((s) => s.project.editorSettings)
  const setDefaultWallThicknessM = useProjectStore((s) => s.setDefaultWallThicknessM)
  const setDefaultWallMaterial = useProjectStore((s) => s.setDefaultWallMaterial)
  const updateWallSegmentsConstruction = useProjectStore(
    (s) => s.updateWallSegmentsConstruction,
  )
  const wallDrawA = useProjectStore((s) => s.wallDrawA)
  const wallDrawLengthInput = useProjectStore((s) => s.wallDrawLengthInput)
  const wallDrawAngleInput = useProjectStore((s) => s.wallDrawAngleInput)
  const setWallDrawLengthInput = useProjectStore((s) => s.setWallDrawLengthInput)
  const setWallDrawAngleInput = useProjectStore((s) => s.setWallDrawAngleInput)
  const commitWallFromNumericDraft = useProjectStore(
    (s) => s.commitWallFromNumericDraft,
  )
  const clearWallDraw = useProjectStore((s) => s.clearWallDraw)
  const setNextRegionKind = useProjectStore((s) => s.setNextRegionKind)
  const nextRegionKind = useProjectStore((s) => s.nextRegionKind)
  const closeRegionDraft = useProjectStore((s) => s.closeRegionDraft)
  const cancelRegionDraft = useProjectStore((s) => s.cancelRegionDraft)
  const activeWallId = useProjectStore((s) => s.activeWallId)
  const setActiveWallId = useProjectStore((s) => s.setActiveWallId)
  const updateWallSheetMeta = useProjectStore((s) => s.updateWallSheetMeta)
  const updatePlanRegionLabel = useProjectStore((s) => s.updatePlanRegionLabel)
  const setPlanRegionExternal = useProjectStore((s) => s.setPlanRegionExternal)
  const addWallSheet = useProjectStore((s) => s.addWallSheet)
  const removeWallSheet = useProjectStore((s) => s.removeWallSheet)
  const setFloorDeviceWallLink = useProjectStore((s) => s.setFloorDeviceWallLink)
  const selectionFloorDeviceId = useProjectStore((s) => s.selectionFloorDeviceId)
  const selectionFloorDeviceIds = useProjectStore((s) => s.selectionFloorDeviceIds)
  const selectionWallDevice = useProjectStore((s) => s.selectionWallDevice)
  const floorPlan = useProjectStore(
    (s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.plan,
  )
  const selectedWallSegmentIds = useProjectStore((s) => s.selectedWallSegmentIds)
  const updateWallSegment = useProjectStore((s) => s.updateWallSegment)
  const wallSheets = useProjectStore(
    (s) => s.project.floors.find((f) => f.id === s.activeFloorId)?.wallSheets ?? [],
  )
  const rack = useProjectStore((s) => s.project.rack)
  const setRackTotalRU = useProjectStore((s) => s.setRackTotalRU)
  const setRackWidthLabel = useProjectStore((s) => s.setRackWidthLabel)
  const addRackGear = useProjectStore((s) => s.addRackGear)
  const updateRackGear = useProjectStore((s) => s.updateRackGear)
  const removeRackGear = useProjectStore((s) => s.removeRackGear)
  const duplicateRackGear = useProjectStore((s) => s.duplicateRackGear)
  const setRackPatchPanelLink = useProjectStore((s) => s.setRackPatchPanelLink)
  const updateRackEnclosure = useProjectStore((s) => s.updateRackEnclosure)
  const updateFloorDevice = useProjectStore((s) => s.updateFloorDevice)
  const removeFloorDevices = useProjectStore((s) => s.removeFloorDevices)
  const updateWallMountDevice = useProjectStore((s) => s.updateWallMountDevice)
  const setPanelDimensions = useProjectStore((s) => s.setPanelDimensions)
  const updatePanelSlot = useProjectStore((s) => s.updatePanelSlot)
  const reapplyFloorDeviceRequirementDefaults = useProjectStore(
    (s) => s.reapplyFloorDeviceRequirementDefaults,
  )
  const reapplyWallMountDeviceRequirementDefaults = useProjectStore(
    (s) => s.reapplyWallMountDeviceRequirementDefaults,
  )
  const selectedPanelSlot = useProjectStore((s) => s.selectedPanelSlot)
  const selectedRackGearId = useProjectStore((s) => s.selectedRackGearId)
  const setSelectedRackGearId = useProjectStore((s) => s.setSelectedRackGearId)
  const panel = useProjectStore((s) => s.project.panel)
  const resetProject = useProjectStore((s) => s.resetProject)
  const replaceProjectFromImport = useProjectStore((s) => s.replaceProjectFromImport)
  const undo = useProjectStore((s) => s.undo)
  const redo = useProjectStore((s) => s.redo)
  const canUndo = useProjectStore((s) => s.historyPast.length > 0)
  const canRedo = useProjectStore((s) => s.historyFuture.length > 0)

  const catalogLinkIssueCount = useMemo(
    () => listUnlinkedPlanWallDevices(project).length,
    [project],
  )

  const floorStageRef = useRef<KonvaStage>(null)
  const wallStageRef = useRef<KonvaStage>(null)
  const furnishStageRef = useRef<KonvaStage>(null)
  const panelStageRef = useRef<KonvaStage>(null)
  const rackStageRef = useRef<KonvaStage>(null)

  useUndoHotkeys()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (useProjectStore.getState().activeTab !== 'floor') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isFloorToolHotkeySuppressed()) return
      const toolByKey: Record<string, FloorTool> = {
        s: 'select',
        w: 'wall',
        r: 'region',
      }
      const toolByCode: Record<string, FloorTool> = {
        KeyS: 'select',
        KeyW: 'wall',
        KeyR: 'region',
      }
      const ch = e.key.length === 1 ? e.key.toLowerCase() : ''
      const next = toolByKey[ch] ?? toolByCode[e.code]
      if (!next) return
      e.preventDefault()
      useProjectStore.getState().setFloorTool(next)
    }
    document.addEventListener('keydown', onKeyDown, { capture: true })
    return () => document.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  const activeFloor = useMemo(
    () => project.floors.find((f) => f.id === activeFloorId),
    [project.floors, activeFloorId],
  )

  const sortedFloorIds = useMemo(
    () =>
      [...project.floors]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map((f) => f.id),
    [project.floors],
  )
  const floorOrderIndex = sortedFloorIds.indexOf(activeFloorId)
  const canMoveFloorUp = floorOrderIndex > 0
  const canMoveFloorDown =
    floorOrderIndex >= 0 && floorOrderIndex < sortedFloorIds.length - 1

  const activeWall: WallSheet | undefined =
    wallSheets.length === 0
      ? undefined
      : (wallSheets.find((w) => w.id === activeWallId) ?? wallSheets[0])

  const wallSheetsSamePlanSegment = useMemo(() => {
    if (!activeWall?.wallSegmentId) return []
    const sid = activeWall.wallSegmentId
    return [...wallSheets.filter((w) => w.wallSegmentId === sid)].sort((a, b) => {
      const ra = a.roomRegionId
        ? floorPlan?.regions.find((r) => r.id === a.roomRegionId)?.label
        : undefined
      const rb = b.roomRegionId
        ? floorPlan?.regions.find((r) => r.id === b.roomRegionId)?.label
        : undefined
      return (ra ?? a.label).localeCompare(rb ?? b.label) || a.id.localeCompare(b.id)
    })
  }, [activeWall?.wallSegmentId, wallSheets, floorPlan?.regions])

  const selectedWallSeg = useMemo(() => {
    if (!floorPlan || selectedWallSegmentIds.length !== 1) return null
    return floorPlan.wallSegments.find((w) => w.id === selectedWallSegmentIds[0]!) ?? null
  }, [floorPlan, selectedWallSegmentIds])

  /** Shared thickness / material across a multi-segment selection, or a "mixed" marker. */
  const multiWallConstruction = useMemo(() => {
    const segs = (floorPlan?.wallSegments ?? []).filter((w) =>
      selectedWallSegmentIds.includes(w.id),
    )
    const thicknesses = segs.map((w) => effectiveWallThicknessM(w, editorSettings))
    const materials = segs.map((w) => effectiveWallMaterial(w, editorSettings))
    const first = { t: thicknesses[0], m: materials[0] }
    return {
      thicknessM: first.t ?? editorSettings.defaultWallThicknessM,
      material: first.m ?? editorSettings.defaultWallMaterial,
      mixedThickness: thicknesses.some((t) => t !== first.t),
      mixedMaterial: materials.some((m) => m !== first.m),
    }
  }, [floorPlan?.wallSegments, selectedWallSegmentIds, editorSettings])

  const [wallEditLength, setWallEditLength] = useState('')
  const [wallEditAngle, setWallEditAngle] = useState('')
  const [wallEditOrthoLock, setWallEditOrthoLock] = useState(false)

  /* Keep wall segment numeric inputs in sync with selection (external store). */
  /* eslint-disable react-hooks/set-state-in-effect -- form fields reset when selected segment changes */
  useEffect(() => {
    if (!selectedWallSeg) {
      setWallEditLength('')
      setWallEditAngle('')
      return
    }
    const L = segmentLengthM(selectedWallSeg.a, selectedWallSeg.b)
    const ang = segmentAngleDegFromPlusX(selectedWallSeg.a, selectedWallSeg.b)
    setWallEditLength(String(+L.toFixed(4)))
    setWallEditAngle(String(+ang.toFixed(2)))
    setWallEditOrthoLock(useProjectStore.getState().project.editorSettings.wallOrtho)
  }, [
    selectedWallSeg?.id,
    selectedWallSeg?.a.x,
    selectedWallSeg?.a.y,
    selectedWallSeg?.b.x,
    selectedWallSeg?.b.y,
  ])
  /* eslint-enable react-hooks/set-state-in-effect */

  const wallDeviceOptions = useMemo(() => {
    const o: { sheetId: string; devId: string; label: string }[] = []
    for (const ws of wallSheets) {
      for (const d of ws.devices) {
        o.push({
          sheetId: ws.id,
          devId: d.id,
          label: `${ws.label} · ${d.label || d.type}`,
        })
      }
    }
    return o
  }, [wallSheets])

  const [showRenderPrompt, setShowRenderPrompt] = useState(false)
  const [pdfExportBusy, setPdfExportBusy] = useState(false)
  const pdfExportBusyRef = useRef(false)

  const exportJson = () => {
    downloadJson(slug(project.name), project)
  }

  const capturePngForTab = useCallback((tab: EditorTab) => {
    const map: Record<EditorTab, KonvaStage | null> = {
      floor: floorStageRef.current,
      wall: wallStageRef.current,
      furnish: furnishStageRef.current,
      panel: panelStageRef.current,
      rack: rackStageRef.current,
      devices: null,
    }
    const stage = map[tab]
    if (!stage) return null
    const st = useProjectStore.getState()
    const p = st.project
    const nameSlug = slug(p.name)
    const flId = st.activeFloorId ?? p.floors[0]?.id
    const floor = p.floors.find((f) => f.id === flId)
    const floorSlug = slug(floor?.label ?? 'floor')
    let name: string
    if (tab === 'floor') {
      name = `${nameSlug}-floor-${floorSlug}.png`
    } else if (tab === 'wall') {
      const ws = floor?.wallSheets ?? []
      const aw = ws.find((w) => w.id === st.activeWallId) ?? ws[0]
      name = aw
        ? `${nameSlug}-floor-${floorSlug}-wall-${slug(aw.label)}.png`
        : `${nameSlug}-wall.png`
    } else {
      name = `${nameSlug}-${tab}.png`
    }
    const ru = st.project.rack.totalRU
    const pixelRatio =
      tab === 'rack' && ru > 42
        ? 1
        : tab === 'rack' && ru > 32
          ? 1
          : tab === 'rack' && ru > 22
            ? 1.5
            : 2
    return {
      filename: name,
      dataUrl: stageToPngDataUrl(stage, { pixelRatio }),
    }
  }, [])

  const PDF_EXPORT_TICK_MS = 200

  const runProjectPdfExport = useCallback(async () => {
    if (pdfExportBusyRef.current) return
    pdfExportBusyRef.current = true
    setPdfExportBusy(true)
    const st0 = useProjectStore.getState()
    const savedTab = st0.activeTab
    const savedFloor = st0.activeFloorId
    const savedWall = st0.activeWallId

    const wait = () => new Promise<void>((r) => window.setTimeout(r, PDF_EXPORT_TICK_MS))
    const paint = () =>
      new Promise<void>((r) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.setTimeout(r, 40)
          })
        })
      })

    try {
      setActiveTab('floor')
      await paint()
      await wait()

      const p = useProjectStore.getState().project
      const floorsSorted = [...p.floors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      )

      const metaLines = formatProjectMetaLines(p)
      const overviewFloorImages: { floorLabel: string; dataUrl: string }[] = []

      for (const fl of floorsSorted) {
        setActiveFloorId(fl.id)
        await paint()
        await wait()
        const c = capturePngForTab('floor')
        if (c) overviewFloorImages.push({ floorLabel: fl.label, dataUrl: c.dataUrl })
      }

      const perFloor: ProjectPdfFloorPart[] = []

      for (const fl of floorsSorted) {
        setActiveFloorId(fl.id)
        setActiveTab('floor')
        await paint()
        await wait()
        const fp = capturePngForTab('floor')

        const roomRegions = [...fl.plan.regions]
          .filter((r) => r.kind === 'room' || r.kind === 'patio' || r.kind === 'other')
          .sort(
            (a, b) =>
              (a.label || '').localeCompare(b.label || '') || a.id.localeCompare(b.id),
          )
        const roomIds = new Set(roomRegions.map((r) => r.id))
        const rooms: ProjectPdfFloorPart['rooms'] = []

        for (const reg of roomRegions) {
          const walls = [...fl.wallSheets]
            .filter((ws) => ws.roomRegionId === reg.id)
            .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
          const wallParts: ProjectPdfFloorPart['rooms'][number]['walls'] = []
          for (const ws of walls) {
            setActiveWallId(ws.id)
            setActiveTab('wall')
            await paint()
            await wait()
            const wcap = capturePngForTab('wall')
            const deviceNames = ws.devices.map((d) => pdfDeviceProductCell(p, d))
            wallParts.push({
              wallLabel: ws.label,
              elevationDataUrl: wcap?.dataUrl ?? '',
              deviceNames,
            })
          }
          rooms.push({
            regionLabel:
              reg.label.trim() ||
              (reg.kind === 'patio' ? 'Patio' : reg.kind === 'other' ? 'Area' : 'Room'),
            roomPlanDataUrl:
              renderRoomIsolationPngDataUrl(fl, reg.id, { allFloors: floorsSorted }) ?? '',
            walls: wallParts,
          })
        }

        const orphanSheets = [...fl.wallSheets]
          .filter((ws) => !ws.roomRegionId || !roomIds.has(ws.roomRegionId))
          .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
        if (orphanSheets.length > 0) {
          const wallParts: ProjectPdfFloorPart['rooms'][number]['walls'] = []
          for (const ws of orphanSheets) {
            setActiveWallId(ws.id)
            setActiveTab('wall')
            await paint()
            await wait()
            const wcap = capturePngForTab('wall')
            const deviceNames = ws.devices.map((d) => pdfDeviceProductCell(p, d))
            wallParts.push({
              wallLabel: ws.label,
              elevationDataUrl: wcap?.dataUrl ?? '',
              deviceNames,
            })
          }
          rooms.push({
            regionLabel: 'Walls not assigned to a room or patio',
            roomPlanDataUrl: '',
            walls: wallParts,
          })
        }

        perFloor.push({
          floorLabel: fl.label,
          floorPlanDataUrl: fp?.dataUrl ?? '',
          rooms,
        })
      }

      const pFinal = useProjectStore.getState().project
      const built = buildBom(pFinal)

      setActiveTab('panel')
      await paint()
      await wait()
      const panelCap = capturePngForTab('panel')

      setActiveTab('rack')
      await paint()
      await wait()
      const rackCap = capturePngForTab('rack')

      const blob = buildProjectPdfBlob({
        projectName: pFinal.name,
        generatedAtISO: new Date().toISOString(),
        metaLines,
        overviewFloorImages,
        perFloor,
        deviceListEntries: buildPdfDeviceListEntries(pFinal),
        panelDiagramDataUrl: panelCap?.dataUrl ?? '',
        panelEquipment: buildPanelEquipmentPriceTable(pFinal),
        panelShopping: buildShoppingPriceTable(
          aggregateShoppingLines(pFinal, built.lines.filter((l) => l.source === 'panel')),
        ),
        rackDiagramDataUrl: rackCap?.dataUrl ?? '',
        rackEquipment: buildRackEquipmentPriceTable(pFinal),
        rackShopping: buildShoppingPriceTable(
          aggregateShoppingLines(
            pFinal,
            built.lines.filter((l) => l.source === 'rack' || l.source === 'rack_enclosure'),
          ),
        ),
        shoppingByManufacturer: shoppingGroupsByManufacturer(pFinal, built.lines),
        shoppingByFloor: shoppingGroupsByFloor(pFinal, built.lines),
      })

      downloadBlob(`${slug(pFinal.name)}.pdf`, blob)
    } finally {
      setActiveTab(savedTab)
      setActiveFloorId(savedFloor)
      setActiveWallId(savedWall)
      pdfExportBusyRef.current = false
      setPdfExportBusy(false)
    }
  }, [capturePngForTab, setActiveFloorId, setActiveTab, setActiveWallId])

  const [pendingImportMigration, setPendingImportMigration] = useState<PlanstudioProject | null>(
    null,
  )

  const onLoadFile: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = stripLeadingUtf8Bom(String(reader.result))
        const raw = JSON.parse(text) as unknown
        if (raw == null || typeof raw !== 'object') {
          window.alert('Project file must be a JSON object.')
          return
        }
        if (!isProjectFile(raw)) {
          const msg =
            !Array.isArray(raw) && typeof raw === 'object'
              ? validateProjectSchemaVersion(
                  (raw as Record<string, unknown>).schemaVersion,
                )
              : 'Project file must be a JSON object.'
          window.alert(msg ?? 'Not a supported Planstudio project file.')
          return
        }
        const copy = { ...(raw as Record<string, unknown>) }
        delete copy.bom
        let normalized: PlanstudioProject
        try {
          normalized = normalizeProject(copy)
        } catch (e) {
          window.alert(e instanceof Error ? e.message : 'Could not load project file.')
          return
        }
        if (listUnlinkedPlanWallDevices(normalized).length > 0) {
          setPendingImportMigration(normalized)
        } else {
          replaceProjectFromImport(normalized)
        }
      } catch {
        window.alert('Could not parse JSON.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const onLinkValueChange = (v: string) => {
    if (!selectionFloorDeviceId) return
    if (v === '' || v === 'none') {
      const fd = floorPlan?.devices.find((d) => d.id === selectionFloorDeviceId)
      if (fd?.linkedWallDeviceId) {
        for (const ws of wallSheets) {
          const w = ws.devices.find((x) => x.id === fd.linkedWallDeviceId)
          if (w) {
            setFloorDeviceWallLink(selectionFloorDeviceId, ws.id, null)
            return
          }
        }
        if (wallSheets[0]) {
          setFloorDeviceWallLink(selectionFloorDeviceId, wallSheets[0].id, null)
        } else {
          updateFloorDevice(fd.id, { linkedWallDeviceId: undefined })
        }
      }
      return
    }
    const [sheetId, devId] = v.split('::')
    if (sheetId && devId) {
      setFloorDeviceWallLink(selectionFloorDeviceId, sheetId, devId)
    }
  }

  const onWallLinkPick = (v: string) => {
    if (v === '' || v === 'none') {
      if (selectionWallDevice) {
        const ws = wallSheets.find((x) => x.id === selectionWallDevice.wallSheetId)
        const w = ws?.devices.find((d) => d.id === selectionWallDevice.deviceId)
        if (w?.linkedFloorDeviceId) {
          setFloorDeviceWallLink(
            w.linkedFloorDeviceId,
            selectionWallDevice.wallSheetId,
            null,
          )
        }
      }
      return
    }
    if (v.startsWith('fd::') && selectionWallDevice) {
      const floorDevId = v.slice(4)
      setFloorDeviceWallLink(
        floorDevId,
        selectionWallDevice.wallSheetId,
        selectionWallDevice.deviceId,
      )
    }
  }

  const selectedFd =
    floorPlan &&
    selectionFloorDeviceIds.length === 1 &&
    selectionFloorDeviceId
      ? (floorPlan.devices.find((d) => d.id === selectionFloorDeviceId) ?? null)
      : null

  const linkSelectValue = selectedFd?.linkedWallDeviceId
    ? (() => {
        const ws = wallSheets.find((w) =>
          w.devices.some((d) => d.id === selectedFd!.linkedWallDeviceId),
        )
        return ws
          ? `${ws.id}::${selectedFd!.linkedWallDeviceId!}`
          : 'none'
      })()
    : 'none'

  const roomRegionOptions = useMemo(() => {
    if (!floorPlan) return []
    return (floorPlan.regions ?? []).map((r) => ({
      value: r.id,
      label: (r.label?.trim() || r.kind) + ' — ' + r.kind,
    }))
  }, [floorPlan])

  const selectedPanelAnchor = useMemo(() => {
    if (!selectedPanelSlot) return undefined
    return anchorSlotForCell(panel.slots, selectedPanelSlot.row, selectedPanelSlot.col)
  }, [panel.slots, selectedPanelSlot])

  const wallDevForInspector =
    floorPlan && activeWall && selectionWallDevice
      ? (activeWall.devices.find((d) => d.id === selectionWallDevice.deviceId) ?? null)
      : null

  const reqRollup = useMemo(() => buildRequirementsSummary(project), [project])

  const panelDinActive = useMemo(() => panelDinRollup(project), [project])

  const planVsPanelRackRows = useMemo(
    () => buildPlanVsPanelRackRows(project),
    [project],
  )

  const ethernetPlanDevices = useMemo(
    () => collectEthernetClassPlanDevices(project),
    [project],
  )

  if (!activeFloor || !floorPlan) {
    if (pendingImportMigration) {
      return (
        <UnlinkedDevicesImportModal
          initialProject={pendingImportMigration}
          onCommit={(p) => {
            replaceProjectFromImport(p)
            setPendingImportMigration(null)
          }}
          onAbort={() => setPendingImportMigration(null)}
        />
      )
    }
    return <div>Loading…</div>
  }

  const tabs: { id: EditorTab; label: string }[] = [
    { id: 'floor', label: 'Floor plan' },
    { id: 'wall', label: 'Wall' },
    { id: 'furnish', label: 'Furnish' },
    { id: 'panel', label: 'Panel' },
    { id: 'rack', label: 'Rack' },
    { id: 'devices', label: 'Devices' },
  ]

  const showDevicePaletteRail = activeTab === 'floor' || activeTab === 'wall'
  const showFurniturePaletteRail = activeTab === 'furnish'
  /** Panel/rack: roll-up + plan vs panel/rack table in the right rail (not the floor/wall device template rail). */
  const showRequirementsRail = activeTab === 'panel' || activeTab === 'rack'

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <h1>Planstudio</h1>
          <p className="tagline">Multi-floor plans · v{SCHEMA_VERSION} JSON + PDF</p>
        </div>
        <div className="header-actions">
          <label className="btn secondary">
            Load JSON
            <input type="file" accept="application/json" hidden onChange={onLoadFile} />
          </label>
          {catalogLinkIssueCount > 0 ? (
            <button
              type="button"
              className="btn secondary"
              disabled={pendingImportMigration != null}
              title="Plan or wall marks: missing or deleted template id, mounting mismatch for the surface, or linked template exists but label / product / requirements on the mark still differ from the catalog row."
              onClick={() => setPendingImportMigration(structuredClone(project))}
            >
              Fix catalog links ({catalogLinkIssueCount})
            </button>
          ) : null}
          <button type="button" className="btn secondary" onClick={exportJson}>
            Download JSON
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void runProjectPdfExport()}
            disabled={pdfExportBusy}
            title="Single PDF: project details, floor plans in order, each floor with rooms and wall elevations, full device list, panel and rack (diagram + equipment + shopping), then shopping by manufacturer and by floor."
          >
            {pdfExportBusy ? 'Building PDF…' : 'Export PDF'}
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setShowRenderPrompt(true)}
            title="Build a text brief for an LLM / gen-AI model to render this floor in 3D: rooms, wall thickness and finish, doors and windows at real sizes, furniture and visible fittings."
          >
            3D render prompt
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => undo()}
            disabled={!canUndo}
            title="Undo (Ctrl+Z or ⌘Z)"
          >
            Undo
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => redo()}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z, Ctrl+Y, or ⌘⇧Z / ⌘Y)"
          >
            Redo
          </button>
          <button type="button" className="btn ghost" onClick={resetProject}>
            Reset
          </button>
        </div>
      </header>

      <div
        className={`app-body${
          showDevicePaletteRail || showFurniturePaletteRail ? ' app-body-with-palette' : ''
        }${showRequirementsRail ? ' app-body-with-requirements-rail' : ''}`}
      >
        <aside className="sidebar">
          <label className="field">
            <span>Project name</span>
            <input
              value={project.name}
              onChange={(e) => setProjectName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Floor level</span>
            <select
              value={activeFloorId}
              onChange={(e) => setActiveFloorId(e.target.value)}
            >
              {[...project.floors]
                .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>Floor name</span>
            <input
              value={activeFloor?.label ?? ''}
              onChange={(e) => {
                if (activeFloor) setFloorLevelLabel(activeFloor.id, e.target.value)
              }}
              disabled={!activeFloor}
              aria-label="Floor name"
            />
          </label>
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={addFloorLevel}>
              Add floor
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => removeFloorLevel(activeFloorId)}
              disabled={project.floors.length <= 1}
            >
              Remove floor
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => duplicateFloorLevel(activeFloorId)}
              disabled={!activeFloor}
            >
              Duplicate
            </button>
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn ghost"
              onClick={() => moveFloorLevel(activeFloorId, 'up')}
              disabled={!canMoveFloorUp}
            >
              Move up
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => moveFloorLevel(activeFloorId, 'down')}
              disabled={!canMoveFloorDown}
            >
              Move down
            </button>
          </div>

          <nav className="tabs" aria-label="Editor">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === activeTab ? 'tab active' : 'tab'}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {activeTab === 'devices' ? (
            <div className="panel-block">
              <p className="muted small" style={{ margin: 0 }}>
                Templates are edited in the <strong>main</strong> column. Use the Floor or Wall
                tab with the Device tool for drag-drop from the palette rail.
              </p>
            </div>
          ) : activeTab === 'furnish' ? (
            <FurnitureInspector />
          ) : (
          <>
          {(activeTab === 'floor' || activeTab === 'wall') && (
            <div className="panel-block link-block">
              <h3 className="side-heading">Device link</h3>
              <p className="muted small">
                Green ring = linked. Pick a plan device, then a wall target (same floor).
              </p>
              {activeTab === 'floor' && (
                <label className="field">
                  <span>Wall device (for selected plan device)</span>
                  <select
                    value={linkSelectValue}
                    onChange={(e) => onLinkValueChange(e.target.value)}
                    disabled={selectionFloorDeviceIds.length !== 1}
                  >
                    <option value="none">Unlinked</option>
                    {wallDeviceOptions.map((o) => (
                      <option key={o.devId} value={`${o.sheetId}::${o.devId}`}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {activeTab === 'wall' && selectionWallDevice && (
                <label className="field">
                  <span>Link to plan device</span>
                  <select
                    value={
                      (() => {
                        const ws = wallSheets.find(
                          (x) => x.id === selectionWallDevice.wallSheetId,
                        )
                        const w = ws?.devices.find(
                          (d) => d.id === selectionWallDevice.deviceId,
                        )
                        if (w?.linkedFloorDeviceId) {
                          return `fd::${w.linkedFloorDeviceId}`
                        }
                        return 'none'
                      })()
                    }
                    onChange={(e) => onWallLinkPick(e.target.value)}
                  >
                    <option value="none">Unlinked</option>
                    {floorPlan.devices.map((d) => (
                      <option key={d.id} value={`fd::${d.id}`}>
                        {d.label || d.type} ({d.x.toFixed(1)}, {d.y.toFixed(1)} m)
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          {activeTab === 'floor' && (
            <div className="panel-block">
              <label className="field">
                <span>Plan label</span>
                <input
                  value={floorPlan.label}
                  onChange={(e) => setFloorLabel(e.target.value)}
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Min width (m)</span>
                  <input
                    type="number"
                    min={2}
                    max={80}
                    step={0.1}
                    value={floorPlan.widthM}
                    onChange={(e) =>
                      setFloorSize(Number(e.target.value), floorPlan.depthM)
                    }
                  />
                </label>
                <label className="field">
                  <span>Min depth (m)</span>
                  <input
                    type="number"
                    min={2}
                    max={80}
                    step={0.1}
                    value={floorPlan.depthM}
                    onChange={(e) =>
                      setFloorSize(floorPlan.widthM, Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Grid snap (m)</span>
                <input
                  type="number"
                  min={0.01}
                  max={0.5}
                  step={0.01}
                  value={snapGridM}
                  onChange={(e) => setSnapGridM(Number(e.target.value))}
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>New wall thickness (m)</span>
                  <input
                    type="number"
                    min={MIN_WALL_THICKNESS_M}
                    max={MAX_WALL_THICKNESS_M}
                    step={0.01}
                    value={editorSettings.defaultWallThicknessM}
                    onChange={(e) => setDefaultWallThicknessM(Number(e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>New wall material</span>
                  <select
                    value={editorSettings.defaultWallMaterial}
                    onChange={(e) => setDefaultWallMaterial(e.target.value as WallMaterial)}
                  >
                    {WALL_MATERIALS.map((m) => (
                      <option key={m} value={m}>
                        {wallMaterialLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted small" style={{ marginTop: 0 }}>
                Defaults for walls drawn from now on. Walls are drawn to scale on the plan;
                select one to change its own thickness or finish.
              </p>
              <label className="field check">
                <input
                  type="checkbox"
                  checked={wallOrtho}
                  onChange={(e) => setWallOrtho(e.target.checked)}
                />
                <span>Orthogonal walls (Shift inverts for one edge)</span>
              </label>
              <RoomListPanel />
              {floorTool === 'select' && selectedWallSegmentIds.length > 1 && (
                <div className="panel-block inner">
                  <h3 className="side-heading">Plan walls</h3>
                  <p className="muted small">
                    {selectedWallSegmentIds.length} segments selected. Drag any highlighted wall to
                    move all of them together.
                  </p>
                  <WallConstructionFields
                    thicknessM={multiWallConstruction.thicknessM}
                    material={multiWallConstruction.material}
                    mixedThickness={multiWallConstruction.mixedThickness}
                    mixedMaterial={multiWallConstruction.mixedMaterial}
                    onThicknessChange={(m) =>
                      updateWallSegmentsConstruction(selectedWallSegmentIds, {
                        thicknessM: m,
                      })
                    }
                    onMaterialChange={(m) =>
                      updateWallSegmentsConstruction(selectedWallSegmentIds, { material: m })
                    }
                    hint={`Applies to all ${selectedWallSegmentIds.length} selected segments.`}
                  />
                </div>
              )}
              {floorTool === 'select' && selectedWallSeg && (
                <div className="panel-block inner">
                  <h3 className="side-heading">Plan wall segment</h3>
                  <p className="muted small">
                    Drag the <strong>yellow handles</strong> on the plan at each end to move
                    endpoint A or B independently (snapped to the grid). You can still drag the
                    wall line to translate the whole segment. Endpoint A (the first point when the
                    wall was drawn) and B can also be adjusted here via length and angle; angle is
                    degrees from +X, same as the wall tool. The free endpoint is snapped to the
                    grid ({snapGridM} m).
                  </p>
                  <label className="field">
                    <span>Length (m)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={wallEditLength}
                      onChange={(e) => setWallEditLength(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Angle (° from +X)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={wallEditAngle}
                      onChange={(e) => setWallEditAngle(e.target.value)}
                    />
                  </label>
                  <label className="field check">
                    <input
                      type="checkbox"
                      checked={wallEditOrthoLock}
                      onChange={(e) => setWallEditOrthoLock(e.target.checked)}
                    />
                    <span>Lock orthogonal (edit only; uses same rule as wall tool)</span>
                  </label>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => {
                        if (!selectedWallSeg) return
                        const L = parseFloat(wallEditLength.trim())
                        const ang = parseFloat(wallEditAngle.trim())
                        if (!Number.isFinite(L) || L <= 0 || !Number.isFinite(ang)) return
                        updateWallSegment(selectedWallSeg.id, {
                          lengthM: L,
                          angleDeg: ang,
                          lockOrtho: wallEditOrthoLock,
                        })
                      }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        if (!selectedWallSeg) return
                        const L = segmentLengthM(selectedWallSeg.a, selectedWallSeg.b)
                        const ang = segmentAngleDegFromPlusX(
                          selectedWallSeg.a,
                          selectedWallSeg.b,
                        )
                        setWallEditLength(String(+L.toFixed(4)))
                        setWallEditAngle(String(+ang.toFixed(2)))
                        setWallEditOrthoLock(wallOrtho)
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <WallConstructionFields
                    thicknessM={effectiveWallThicknessM(selectedWallSeg, editorSettings)}
                    material={effectiveWallMaterial(selectedWallSeg, editorSettings)}
                    onThicknessChange={(m) =>
                      updateWallSegmentsConstruction([selectedWallSeg.id], { thicknessM: m })
                    }
                    onMaterialChange={(m) =>
                      updateWallSegmentsConstruction([selectedWallSeg.id], { material: m })
                    }
                    hint="Construction metadata: drawn to scale on the plan and used by the 3D render prompt. Each room face can override the finish on the Wall tab."
                  />
                </div>
              )}
              {floorTool === 'wall' && wallDrawA && (
                <div className="panel-block inner">
                  <h3 className="side-heading">Wall length</h3>
                  <p className="muted small">
                    Type length to drive the dashed preview from the first point
                    (ortho + grid snap apply). Optional angle is degrees from +X.
                    Apply commits without a second click.
                  </p>
                  <label className="field">
                    <span>Length (m)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="e.g. 3.2"
                      value={wallDrawLengthInput}
                      onChange={(e) => setWallDrawLengthInput(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Angle (°)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="optional"
                      value={wallDrawAngleInput}
                      onChange={(e) => setWallDrawAngleInput(e.target.value)}
                    />
                  </label>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() => commitWallFromNumericDraft()}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => clearWallDraw()}
                    >
                      Cancel segment
                    </button>
                  </div>
                </div>
              )}
              {floorTool === 'region' && (
                <div className="panel-block inner">
                  <label className="field">
                    <span>Next region</span>
                    <select
                      value={nextRegionKind}
                      onChange={(e) =>
                        setNextRegionKind(
                          e.target.value as 'room' | 'patio' | 'other',
                        )
                      }
                    >
                      <option value="room">Room</option>
                      <option value="patio">Patio / outdoor</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => closeRegionDraft('Area')}
                    >
                      Close polygon
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={cancelRegionDraft}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {activeTab === 'floor' &&
                floorTool === 'select' &&
                selectionFloorDeviceIds.length > 1 && (
                  <div className="panel-block inner">
                    <h3 className="side-heading">{selectionFloorDeviceIds.length} plan devices</h3>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      Drag any selected marker to move the group. Delete / Backspace removes all
                      selected devices.
                    </p>
                    <div className="btn-row">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => removeFloorDevices(selectionFloorDeviceIds)}
                      >
                        Remove all selected
                      </button>
                    </div>
                  </div>
                )}
              {selectedFd && (
                <div className="panel-block inner">
                  <h3 className="side-heading">Product (BOM)</h3>
                  <label className="field">
                    <span>Type</span>
                    <select
                      value={selectedFd.type}
                      onChange={(e) => {
                        const k = e.target.value as DeviceType
                        const nextSubtype =
                          k === 'connector'
                            ? (selectedFd.connectorSubtype ?? 'ethernet')
                            : undefined
                        updateFloorDevice(selectedFd.id, {
                          type: k,
                          connectorSubtype: nextSubtype,
                          requirements: mergeRequirementsWithDeviceTypeDefaults(
                            k,
                            selectedFd.requirements,
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
                  {selectedFd.type === 'connector' && (
                    <label className="field">
                      <span>Connector</span>
                      <select
                        value={selectedFd.connectorSubtype ?? 'ethernet'}
                        onChange={(e) => {
                          const s = e.target.value as ConnectorSubtype
                          updateFloorDevice(selectedFd.id, {
                            connectorSubtype: s,
                            requirements: mergeRequirementsWithDeviceTypeDefaults(
                              'connector',
                              selectedFd.requirements,
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
                  )}
                  <label className="field">
                    <span>Label</span>
                    <input
                      value={selectedFd.label}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, { label: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Circuit ref</span>
                    <input
                      value={selectedFd.circuitRef}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, { circuitRef: e.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Mounting</span>
                    <select
                      value={selectedFd.mounting ?? 'floor'}
                      onChange={(e) => {
                        const mounting = e.target.value as FloorDeviceMounting
                        updateFloorDevice(selectedFd.id, {
                          mounting,
                          ...(mounting === 'ceiling'
                            ? {
                                ceilingHeightM:
                                  selectedFd.ceilingHeightM ?? DEFAULT_CEILING_HEIGHT_M,
                              }
                            : { ceilingHeightM: undefined }),
                        })
                      }}
                    >
                      <option value="floor">Floor</option>
                      <option value="ceiling">Ceiling</option>
                      <option value="wall">Wall (elevation mirror)</option>
                    </select>
                  </label>
                  {(selectedFd.mounting ?? 'floor') === 'ceiling' ? (
                    <label className="field">
                      <span>Ceiling height (m)</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={selectedFd.ceilingHeightM ?? DEFAULT_CEILING_HEIGHT_M}
                        onChange={(e) =>
                          updateFloorDevice(selectedFd.id, {
                            ceilingHeightM: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ) : null}
                  <label className="field">
                    <span>Product name</span>
                    <input
                      value={selectedFd.productName}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, {
                          productName: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Unit price</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={selectedFd.unitPrice}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, {
                          unitPrice: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <h4 className="side-heading" style={{ fontSize: '0.85rem' }}>
                    Requirements (metrics)
                  </h4>
                  <div className="field-row">
                    <label className="field">
                      <span>DIN TE</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={selectedFd.requirements?.dinTe ?? ''}
                        onChange={(e) =>
                          updateFloorDevice(selectedFd.id, {
                            requirements: {
                              ...selectedFd.requirements,
                              dinTe: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Rail mm</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={selectedFd.requirements?.dinRailMm ?? ''}
                        onChange={(e) =>
                          updateFloorDevice(selectedFd.id, {
                            requirements: {
                              ...selectedFd.requirements,
                              dinRailMm: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
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
                        value={selectedFd.requirements?.poeWatts ?? ''}
                        onChange={(e) =>
                          updateFloorDevice(selectedFd.id, {
                            requirements: {
                              ...selectedFd.requirements,
                              poeWatts: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
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
                        value={selectedFd.requirements?.ethernetPorts ?? ''}
                        onChange={(e) =>
                          updateFloorDevice(selectedFd.id, {
                            requirements: {
                              ...selectedFd.requirements,
                              ethernetPorts: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <KnxBusDeviceFields
                    knxLines={knxLines}
                    requirements={selectedFd.requirements}
                    knxLineId={selectedFd.knxLineId}
                    onPatchRequirements={(p: Partial<DeviceRequirements>) =>
                      updateFloorDevice(selectedFd.id, {
                        requirements: { ...selectedFd.requirements, ...p },
                      })
                    }
                    onKnxLineId={(id: Id | undefined) => updateFloorDevice(selectedFd.id, { knxLineId: id })}
                  />
                  <label className="field check">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedFd.requirements?.protectCamera)}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, {
                          requirements: {
                            ...selectedFd.requirements,
                            protectCamera: e.target.checked || undefined,
                          },
                        })
                      }
                    />
                    <span>Protect / camera stack</span>
                  </label>
                  <label className="field check">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedFd.requirements?.accessReader)}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, {
                          requirements: {
                            ...selectedFd.requirements,
                            accessReader: e.target.checked || undefined,
                          },
                        })
                      }
                    />
                    <span>Access reader</span>
                  </label>
                  <label className="field">
                    <span>Notes</span>
                    <input
                      value={selectedFd.requirements?.notes ?? ''}
                      onChange={(e) =>
                        updateFloorDevice(selectedFd.id, {
                          requirements: {
                            ...selectedFd.requirements,
                            notes: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => reapplyFloorDeviceRequirementDefaults(selectedFd.id)}
                  >
                    Reset metrics to kind defaults
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'wall' && wallSheets.length === 0 && (
            <div className="panel-block">
              <p className="muted small" title="Draw walls on the Floor tool, or open a segment from the plan.">
                Each new floor plan wall segment automatically creates a matching wall sheet
                (length from the segment, default height, label from the plan code e.g. L0_1).
                Double-click a plan segment on the Floor tab to open its elevation if a sheet
                is still missing. Add a custom wall when you need an elevation that is not tied
                to a floor segment.
              </p>
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn secondary" onClick={addWallSheet}>
                  Add custom wall
                </button>
              </div>
            </div>
          )}

          {activeTab === 'wall' && wallSheets.length > 0 && activeWall && (
            <div className="panel-block">
              <label className="field">
                <span>Active wall (this floor)</span>
                <select
                  value={activeWall.id}
                  onChange={(e) => setActiveWallId(e.target.value)}
                >
                  {wallSheets.map((w) => {
                    const room =
                      w.roomRegionId &&
                      floorPlan?.regions.find((r) => r.id === w.roomRegionId)
                    const suffix = w.wallSegmentId
                      ? room
                        ? `From plan · ${room.label} side`
                        : 'From plan'
                      : 'Custom'
                    return (
                      <option key={w.id} value={w.id}>
                        {w.label} — {suffix}
                      </option>
                    )
                  })}
                </select>
              </label>
              {activeWall.wallSegmentId && wallSheetsSamePlanSegment.length > 1 ? (
                <div className="field" style={{ marginTop: 10 }}>
                  <span>Room faces on this plan segment</span>
                  <div className="btn-row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    {wallSheetsSamePlanSegment.map((w) => {
                      const room = w.roomRegionId
                        ? floorPlan?.regions.find((r) => r.id === w.roomRegionId)
                        : undefined
                      const title = room?.label ?? w.label
                      return (
                        <button
                          key={w.id}
                          type="button"
                          className={w.id === activeWall.id ? 'btn secondary' : 'btn ghost'}
                          onClick={() => setActiveWallId(w.id)}
                        >
                          {title}
                        </button>
                      )
                    })}
                  </div>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    One physical wall segment can border several rooms (for example at a
                    T-junction). Doors and windows stay in sync across every face that shares
                    this segment.
                  </p>
                </div>
              ) : null}
              <div className="btn-row">
                <button
                  type="button"
                  className={
                    (floorPlan?.wallSegments.length ?? 0) > 0
                      ? 'btn ghost'
                      : 'btn secondary'
                  }
                  onClick={addWallSheet}
                  title="Custom wall: not linked to a floor plan segment. Prefer drawing segments on the floor plan when you can."
                >
                  Add custom wall
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => removeWallSheet(activeWall.id)}
                >
                  Remove wall
                </button>
              </div>
              {activeWall.wallSegmentId ? (
                <div className="field">
                  <span>Wall label</span>
                  <div
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border, #2a3544)',
                      background: 'var(--panel-2, #151b24)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    }}
                  >
                    {activeWall.label}
                  </div>
                  <p className="muted small" style={{ marginTop: 6 }}>
                    From floor plan — matches the segment code on the Floor tab (updates when
                    segments are added, removed, or moved).
                  </p>
                </div>
              ) : (
                <label className="field">
                  <span>Wall label</span>
                  <input
                    value={activeWall.label}
                    onChange={(e) =>
                      updateWallSheetMeta(activeWall.id, { label: e.target.value })
                    }
                  />
                </label>
              )}
              {(() => {
                const autoRoom =
                  activeWall.roomRegionId
                    ? floorPlan?.regions.find((r) => r.id === activeWall.roomRegionId)
                    : undefined
                if (autoRoom?.wallCycleSignature) {
                  // Auto-detected room: rename inline; the wall label suffix updates on next reconcile.
                  return (
                    <label className="field">
                      <span>Room (auto-detected from wall cycle)</span>
                      <input
                        value={autoRoom.label}
                        onChange={(e) =>
                          updatePlanRegionLabel(autoRoom.id, e.target.value)
                        }
                        title="Renaming this room updates every wall sheet on its boundary."
                      />
                      <p className="muted small" style={{ marginTop: 6 }}>
                        Wall label includes the room slug ({activeWall.label}).
                        The opposite face of this wall edits the same opening list.
                      </p>
                      <label className="field check" style={{ marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={regionIsExternal(autoRoom)}
                          onChange={(e) =>
                            setPlanRegionExternal(autoRoom.id, e.target.checked)
                          }
                        />
                        <span>Outdoor space (terrace, balcony, courtyard)</span>
                      </label>
                    </label>
                  )
                }
                if (roomRegionOptions.length > 0) {
                  return (
                    <label className="field">
                      <span>Link wall to region (BOM room)</span>
                      <select
                        value={activeWall.roomRegionId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value
                          updateWallSheetMeta(activeWall.id, {
                            roomRegionId: v ? (v as Id) : undefined,
                          })
                        }}
                      >
                        <option value="">(use floor-device links / default)</option>
                        {roomRegionOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )
                }
                return null
              })()}
              <div className="field-row">
                <label className="field">
                  <span>
                    Length (m)
                    {activeWall.wallSegmentId ? ' · from plan (editable override)' : ''}
                  </span>
                  <input
                    type="number"
                    min={0.5}
                    max={40}
                    step={0.05}
                    value={activeWall.lengthM}
                    onChange={(e) =>
                      updateWallSheetMeta(activeWall.id, {
                        lengthM: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Height (m)</span>
                  <input
                    type="number"
                    min={2}
                    max={6}
                    step={0.05}
                    value={activeWall.heightM}
                    onChange={(e) =>
                      updateWallSheetMeta(activeWall.id, {
                        heightM: Number(e.target.value),
                      })
                    }
                  />
                </label>
              </div>
              {(() => {
                const seg = activeWall.wallSegmentId
                  ? floorPlan?.wallSegments.find((w) => w.id === activeWall.wallSegmentId)
                  : undefined
                const inherited = effectiveWallMaterial(seg, editorSettings)
                return (
                  <label className="field">
                    <span>Finish on this face</span>
                    <select
                      value={activeWall.materialOverride ?? ''}
                      onChange={(e) => {
                        const v = e.target.value
                        updateWallSheetMeta(activeWall.id, {
                          materialOverride: v ? (v as WallMaterial) : undefined,
                        })
                      }}
                    >
                      <option value="">
                        Inherit from wall ({wallMaterialLabel(inherited)})
                      </option>
                      {WALL_MATERIALS.map((m) => (
                        <option key={m} value={m}>
                          {wallMaterialLabel(m)}
                        </option>
                      ))}
                    </select>
                    <p className="muted small" style={{ marginTop: 6 }}>
                      Override only this room's side of the wall — e.g. a stone feature wall in
                      the living room whose other face stays painted. The wall's own material
                      and thickness live on the Floor tab.
                    </p>
                  </label>
                )
              })()}
              {floorTool === 'opening' && (
                <label className="field">
                  <span>Opening</span>
                  <select
                    value={wallOpeningKind}
                    onChange={(e) =>
                      setWallOpeningKind(e.target.value as 'door' | 'window')
                    }
                  >
                    <option value="door">door</option>
                    <option value="window">window</option>
                  </select>
                </label>
              )}
              <WallOpeningInspector />
              <p className="muted small">
                Plan wall segments (Floor tab) auto-create and update these sheets. You can
                add custom walls (no plan link) for extra elevations. Double-click a plan
                segment to ensure a linked sheet exists before editing its elevation.
              </p>
              <p className="muted small">
                <strong>Doors &amp; windows:</strong> on the Wall tab, choose the opening
                tool and click the elevation. They use the same horizontal position as the
                plan only when this sheet is linked to a floor-plan wall; then a door (tan
                jamb + swing) or window (blue cross) appears on the Floor plan along that
                segment. Custom walls (no plan link) keep openings on the elevation only.
              </p>
              {activeWall && wallDevForInspector && (
                <div className="panel-block inner">
                  <h3 className="side-heading">Wall device (BOM)</h3>
                  <label className="field">
                    <span>Type</span>
                    <select
                      value={wallDevForInspector.type}
                      onChange={(e) => {
                        const k = e.target.value as DeviceType
                        const nextSubtype =
                          k === 'connector'
                            ? (wallDevForInspector.connectorSubtype ?? 'ethernet')
                            : undefined
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          type: k,
                          connectorSubtype: nextSubtype,
                          requirements: mergeRequirementsWithDeviceTypeDefaults(
                            k,
                            wallDevForInspector.requirements,
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
                  {wallDevForInspector.type === 'connector' && (
                    <label className="field">
                      <span>Connector</span>
                      <select
                        value={wallDevForInspector.connectorSubtype ?? 'ethernet'}
                        onChange={(e) => {
                          const s = e.target.value as ConnectorSubtype
                          updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                            connectorSubtype: s,
                            requirements: mergeRequirementsWithDeviceTypeDefaults(
                              'connector',
                              wallDevForInspector.requirements,
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
                  )}
                  <label className="field">
                    <span>Label</span>
                    <input
                      value={wallDevForInspector.label}
                      onChange={(e) =>
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          label: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Circuit ref</span>
                    <input
                      value={wallDevForInspector.circuitRef}
                      onChange={(e) =>
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          circuitRef: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Product name</span>
                    <input
                      value={wallDevForInspector.productName}
                      onChange={(e) =>
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          productName: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Unit price</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={wallDevForInspector.unitPrice}
                      onChange={(e) =>
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          unitPrice: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <h4 className="side-heading" style={{ fontSize: '0.85rem' }}>
                    Requirements
                  </h4>
                  <div className="field-row">
                    <label className="field">
                      <span>DIN TE</span>
                      <input
                        type="number"
                        min={0}
                        value={wallDevForInspector.requirements?.dinTe ?? ''}
                        onChange={(e) =>
                          updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                            requirements: {
                              ...wallDevForInspector.requirements,
                              dinTe: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Rail mm</span>
                      <input
                        type="number"
                        min={0}
                        value={wallDevForInspector.requirements?.dinRailMm ?? ''}
                        onChange={(e) =>
                          updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                            requirements: {
                              ...wallDevForInspector.requirements,
                              dinRailMm: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
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
                        value={wallDevForInspector.requirements?.poeWatts ?? ''}
                        onChange={(e) =>
                          updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                            requirements: {
                              ...wallDevForInspector.requirements,
                              poeWatts: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Eth ports</span>
                      <input
                        type="number"
                        min={0}
                        value={wallDevForInspector.requirements?.ethernetPorts ?? ''}
                        onChange={(e) =>
                          updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                            requirements: {
                              ...wallDevForInspector.requirements,
                              ethernetPorts: e.target.value
                                ? Number(e.target.value)
                                : undefined,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <KnxBusDeviceFields
                    knxLines={knxLines}
                    requirements={wallDevForInspector.requirements}
                    knxLineId={wallDevForInspector.knxLineId}
                    onPatchRequirements={(p: Partial<DeviceRequirements>) =>
                      updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                        requirements: { ...wallDevForInspector.requirements, ...p },
                      })
                    }
                    onKnxLineId={(id: Id | undefined) =>
                      updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                        knxLineId: id,
                      })
                    }
                  />
                  <label className="field">
                    <span>Notes</span>
                    <input
                      value={wallDevForInspector.requirements?.notes ?? ''}
                      onChange={(e) =>
                        updateWallMountDevice(activeWall.id, wallDevForInspector.id, {
                          requirements: {
                            ...wallDevForInspector.requirements,
                            notes: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() =>
                      reapplyWallMountDeviceRequirementDefaults(
                        activeWall.id,
                        wallDevForInspector.id,
                      )
                    }
                  >
                    Reset metrics to kind defaults
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'panel' && selectedPanelAnchor && (
            <div className="panel-block">
              <h3 className="side-heading">
                Module R{selectedPanelAnchor.row + 1}C{selectedPanelAnchor.col + 1} ·{' '}
                {selectedPanelAnchor.spanWidthTe ?? 1} TE wide
              </h3>
              <label className="field">
                <span>Manufacturer line</span>
                <input
                  value={selectedPanelAnchor.manufacturerLine ?? ''}
                  placeholder="e.g. manufacturer series"
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      manufacturerLine: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>KNX / bus line</span>
                <select
                  value={selectedPanelAnchor.knxLineId ?? ''}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      knxLineId: e.target.value ? e.target.value : undefined,
                    })
                  }
                >
                  <option value="">(unassigned)</option>
                  {[...knxLines]
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Description</span>
                <input
                  value={selectedPanelAnchor.description ?? ''}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      description: e.target.value || undefined,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Width (TE, spans columns)</span>
                <input
                  type="number"
                  min={1}
                  max={panel.widthTe - selectedPanelAnchor.col}
                  value={selectedPanelAnchor.spanWidthTe ?? 1}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      spanWidthTe: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </label>
              <div className="field-row">
                <label className="field">
                  <span>Rail segment (mm)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={selectedPanelAnchor.dinRailSegmentMm ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      updatePanelSlot(selectedPanelAnchor.id, {
                        dinRailSegmentMm: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Rail use (mm)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={selectedPanelAnchor.railConsumeMm ?? ''}
                    placeholder="—"
                    onChange={(e) =>
                      updatePanelSlot(selectedPanelAnchor.id, {
                        railConsumeMm: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
              </div>
              <label className="field">
                <span>Product name (BOM)</span>
                <input
                  value={selectedPanelAnchor.productName}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      productName: e.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Label</span>
                <input
                  value={selectedPanelAnchor.label}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, { label: e.target.value })
                  }
                />
              </label>
              <label className="field">
                <span>Unit price</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={selectedPanelAnchor.unitPrice}
                  onChange={(e) =>
                    updatePanelSlot(selectedPanelAnchor.id, {
                      unitPrice: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          )}
            </>
          )}
        </aside>

        <main className="main">
          <div className="editor-stack">
            <section
              className={activeTab === 'floor' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'floor'}
            >
              <div className="editor-canvas-col">
                <div className="tool-row">
                  <span className="muted">Tool</span>
                  {(['select', 'wall', 'region'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={floorTool === t ? 'chip active' : 'chip'}
                      onClick={() => setFloorTool(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <FloorPlanEditor ref={floorStageRef} />
              </div>
            </section>
            <section
              className={activeTab === 'wall' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'wall'}
            >
              <div className="editor-canvas-col">
                {wallSheets.length > 0 && activeWall ? (
                  <div className="tool-row">
                    <span className="muted">Tool</span>
                    {(['select', 'opening'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={floorTool === t ? 'chip active' : 'chip'}
                        onClick={() => setFloorTool(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                ) : null}
                <WallElevationEditor ref={wallStageRef} />
              </div>
            </section>
            <section
              className={activeTab === 'furnish' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'furnish'}
            >
              <div className="editor-canvas-col">
                <FurnishEditor ref={furnishStageRef} />
              </div>
            </section>
            <section
              className={activeTab === 'panel' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'panel'}
            >
              <div className="editor-main-with-rail">
                <div className="editor-canvas-col">
                  <PanelEditor ref={panelStageRef} />
                </div>
                <aside
                  className="editor-context-rail"
                  aria-label="Panel module templates — drag rows onto the DIN grid (not floor/wall device templates)"
                >
                  <div className="panel-block">
                    <p className="muted small" title={DIN_SCALE_TOOLTIP}>
                      True-scale DIN grid (17.5 mm/TE horizontal, 90 mm/row vertical). Click a cell
                      to cycle its module type. Multi-TE width cannot cover cells already used by
                      another device (or non-blank); span changes clamp to free space. Drag a
                      palette row below onto a cell to drop a new module from your template list.
                    </p>
                    <div className="field-row">
                      <label className="field">
                        <span>Rows</span>
                        <input
                          type="number"
                          min={1}
                          max={24}
                          value={panel.rows}
                          onChange={(e) =>
                            setPanelDimensions(Number(e.target.value), panel.widthTe)
                          }
                        />
                      </label>
                      <label className="field">
                        <span>Width (TE)</span>
                        <input
                          type="number"
                          min={1}
                          max={72}
                          value={panel.widthTe}
                          onChange={(e) =>
                            setPanelDimensions(panel.rows, Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                  </div>
                  <div className="panel-block">
                    <h3 className="side-heading">KNX / bus lines</h3>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      Project-wide segments (e.g. each apartment + common). Assign floor/wall devices
                      and DIN slots to a line for planning and counts — independent of vendor (same
                      idea when wiring TP segments or IP routers).
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0' }}>
                      {[...knxLines]
                        .sort((a, b) => a.sortOrder - b.sortOrder)
                        .map((l) => (
                          <li
                            key={l.id}
                            style={{
                              display: 'flex',
                              gap: 8,
                              alignItems: 'center',
                              marginBottom: 8,
                            }}
                          >
                            <input
                              aria-label={`KNX line ${l.label}`}
                              style={{ flex: 1, minWidth: 0 }}
                              value={l.label}
                              onChange={(e) => {
                                const next = knxLines.map((x) =>
                                  x.id === l.id ? { ...x, label: e.target.value } : x,
                                )
                                setKnxLines(next)
                              }}
                            />
                            <button
                              type="button"
                              className="btn secondary"
                              title="Remove line"
                              onClick={() => removeKnxLine(l.id)}
                            >
                              ×
                            </button>
                          </li>
                        ))}
                    </ul>
                    <button type="button" className="btn secondary" onClick={() => addKnxLine()}>
                      Add line
                    </button>
                  </div>
                  <div className="panel-block">
                    <h3 className="side-heading">Panel modules (drag to grid)</h3>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      Add palette rows, fill in fields, then drag <strong>Drag to grid</strong>{' '}
                      onto a cell. Templates stay in the list; each drop is a new instance (new id).
                      Width may clamp to the longest clear run to the right.
                    </p>
                    <PanelModulePaletteList />
                  </div>
                </aside>
              </div>
            </section>
            <section
              className={activeTab === 'rack' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'rack'}
            >
              <div className="editor-main-with-rail">
                <div className="editor-canvas-col">
                  <RackEditor ref={rackStageRef} />
                </div>
                <aside
                  className="editor-context-rail"
                  aria-label="Rack gear and enclosure — BOM line items beside the elevation (floor/wall use DeviceTemplatePalette on the right instead)"
                >
                  <div className="panel-block">
                    <label className="field">
                      <span>Total RU</span>
                      <input
                        type="number"
                        min={1}
                        max={48}
                        value={rack.totalRU}
                        onChange={(e) => setRackTotalRU(Number(e.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>Width label</span>
                      <input
                        value={rack.widthLabel}
                        onChange={(e) => setRackWidthLabel(e.target.value)}
                      />
                    </label>
                    <h3 className="side-heading">Rack enclosure (BOM)</h3>
                    <p className="muted small" style={{ marginTop: 0 }}>
                      Cabinet / frame line item, separate from mounted gear.
                    </p>
                    <label className="field">
                      <span>Product name</span>
                      <input
                        value={rack.enclosureProductName}
                        onChange={(e) =>
                          updateRackEnclosure({ enclosureProductName: e.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Unit price</span>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={rack.enclosureUnitPrice}
                        onChange={(e) =>
                          updateRackEnclosure({
                            enclosureUnitPrice: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                    <button type="button" className="btn secondary" onClick={addRackGear}>
                      Add gear
                    </button>
                    <div className="gear-list">
                      {rack.gear.map((g) => (
                        <div
                          key={g.id}
                          className={
                            g.id === selectedRackGearId ? 'gear-card selected' : 'gear-card'
                          }
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedRackGearId(g.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') setSelectedRackGearId(g.id)
                          }}
                        >
                          <label className="field">
                            <span>Product name</span>
                            <input
                              value={g.productName}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateRackGear(g.id, { productName: e.target.value })
                              }
                            />
                          </label>
                          <div className="field-row">
                            <label className="field">
                              <span>Start RU</span>
                              <input
                                type="number"
                                min={1}
                                max={Math.max(1, rack.totalRU - g.heightRU + 1)}
                                value={g.startRU}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateRackGear(g.id, {
                                    startRU: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>Height U</span>
                              <input
                                type="number"
                                min={1}
                                max={rack.totalRU}
                                value={g.heightRU}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateRackGear(g.id, {
                                    heightRU: Number(e.target.value),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <div className="field-row">
                            <label className="field">
                              <span>RJ45 ports</span>
                              <input
                                type="number"
                                min={0}
                                max={48}
                                value={g.rj45PortCount ?? 0}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateRackGear(g.id, {
                                    rj45PortCount: Math.max(
                                      0,
                                      Math.min(48, Math.floor(Number(e.target.value)) || 0),
                                    ),
                                  })
                                }
                              />
                            </label>
                            <label className="field">
                              <span>SFP ports</span>
                              <input
                                type="number"
                                min={0}
                                max={48}
                                value={g.sfpPortCount ?? 0}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) =>
                                  updateRackGear(g.id, {
                                    sfpPortCount: Math.max(
                                      0,
                                      Math.min(48, Math.floor(Number(e.target.value)) || 0),
                                    ),
                                  })
                                }
                              />
                            </label>
                          </div>
                          <label className="field">
                            <span>Unit price</span>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              value={g.unitPrice}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateRackGear(g.id, { unitPrice: Number(e.target.value) })
                              }
                            />
                          </label>
                          <label className="field">
                            <span>Notes</span>
                            <input
                              value={g.notes}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => updateRackGear(g.id, { notes: e.target.value })}
                            />
                          </label>
                          <div className="field-row" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                duplicateRackGear(g.id)
                              }}
                            >
                              Duplicate
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedRackGearId(g.id)
                                removeRackGear(g.id)
                              }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </aside>
              </div>
            </section>
            <section
              className={activeTab === 'devices' ? 'editor-pane active' : 'editor-pane'}
              aria-hidden={activeTab !== 'devices'}
            >
              <div className="device-catalog-main">
                <DeviceCatalogPanel />
              </div>
            </section>
          </div>
        </main>

        {showDevicePaletteRail ? (
          <aside className="palette-rail" aria-label="Device templates">
            {activeTab === 'floor' ? (
              <DeviceTemplatePalette surface="plan" />
            ) : (
              <DeviceTemplatePalette surface="wall" />
            )}
          </aside>
        ) : null}
        {showFurniturePaletteRail ? (
          <aside className="palette-rail" aria-label="Furniture and fixtures">
            <FurniturePalette />
          </aside>
        ) : null}
        {showRequirementsRail ? (
          <aside className="requirements-rail" aria-label="Requirements roll-up and plan vs panel/rack">
            <RequirementsRollupPanel
              variant={activeTab === 'panel' ? 'panel' : 'rack'}
              reqRollup={reqRollup}
              panelDinActive={panelDinActive}
              planVsPanelRackRows={planVsPanelRackRows}
              rack={rack}
              ethernetPlanDevices={ethernetPlanDevices}
              onPatchLabelChange={setRackPatchPanelLink}
            />
          </aside>
        ) : null}
        {showRenderPrompt ? (
          <RenderPromptModal onClose={() => setShowRenderPrompt(false)} />
        ) : null}
        {pendingImportMigration ? (
          <UnlinkedDevicesImportModal
            initialProject={pendingImportMigration}
            onCommit={(p) => {
              replaceProjectFromImport(p)
              setPendingImportMigration(null)
            }}
            onAbort={() => setPendingImportMigration(null)}
          />
        ) : null}
      </div>
    </div>
  )
}

export default App
