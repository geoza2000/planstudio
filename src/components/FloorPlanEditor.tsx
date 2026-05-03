import Konva from 'konva'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEventHandler,
} from 'react'
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { DND_DEVICE_TEMPLATE } from '../lib/deviceCatalog'
import {
  clusterWallMountDevicesForPlan,
  type PlanWallMountClusterItem,
} from '../lib/planWallMountPlanClusters'
import { worldXYForWallMirrorOnPlan } from '../lib/planWallMirrorPosition'
import { FLOOR_PADDING_PX, floorStageSize, PPM } from '../lib/renderScale'
import {
  derivedPlanWallCode,
  floorLevelSortIndex,
  readableWallLabelRotationDeg,
  segmentAngleDegFromPlusX,
  wallSegmentStableIndexMap,
} from '../lib/wallPlanSync'
import { segmentIntersectsAabb } from '../lib/segmentAabb'
import { getKonvaGroupScreenAnchorBelow } from '../lib/konvaScreenAnchor'
import { deviceFill, deviceGlyph } from '../lib/deviceStyle'
import { useProjectStore } from '../store/projectStore'
import { deviceHoverLabel, type PointM } from '../types/project'
import type { Node as KonvaNode } from 'konva/lib/Node'
import { PlanWallOpeningIcon } from './PlanWallOpeningIcon'

type FloorPlanEditorProps = {
  className?: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

/** Snap plan point to nearest wall corner when starting/finishing a segment (meters). */
const SNAP_WALL_ENDPOINT_M = 0.25

function snapWallPointToEndpointsM(
  p: PointM,
  segments: { a: PointM; b: PointM }[],
  toleranceM: number,
): PointM {
  let best: PointM | null = null
  let bestD = toleranceM
  for (const seg of segments) {
    for (const q of [seg.a, seg.b]) {
      const d = Math.hypot(p.x - q.x, p.y - q.y)
      if (d < bestD) {
        bestD = d
        best = q
      }
    }
  }
  return best ?? p
}

export const FloorPlanEditor = forwardRef<KonvaStage, FloorPlanEditorProps>(
  function FloorPlanEditor({ className }, ref) {
    const stageRef = useRef<KonvaStage | null>(null)
    const project = useProjectStore((s) => s.project)
    const deviceCatalog = useProjectStore((s) => s.project.deviceCatalog ?? [])
    const activeFloorId = useProjectStore((s) => s.activeFloorId)
    const activeFloor = useMemo(
      () =>
        project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0]!,
      [project.floors, activeFloorId],
    )
    const floor = activeFloor.plan
    const wallPlanLabeling = useMemo(() => {
      const levelIdx = floorLevelSortIndex(project.floors, activeFloor.id)
      const idxMap = wallSegmentStableIndexMap(floor.wallSegments)
      return { levelIdx, idxMap }
    }, [project.floors, activeFloor.id, floor.wallSegments])
    const tool = useProjectStore((s) => s.floorTool)
    const addWallSegment = useProjectStore((s) => s.addWallSegment)
    const addFloorDevice = useProjectStore((s) => s.addFloorDevice)
    const moveFloorDevice = useProjectStore((s) => s.moveFloorDevice)
    const removeWallSegments = useProjectStore((s) => s.removeWallSegments)
    const selectedWallSegmentIds = useProjectStore((s) => s.selectedWallSegmentIds)
    const setSelectedWallSegmentId = useProjectStore((s) => s.setSelectedWallSegmentId)
    const movePlanSelectionByDelta = useProjectStore((s) => s.movePlanSelectionByDelta)
    const selectionFloorDeviceIds = useProjectStore((s) => s.selectionFloorDeviceIds)
    const setSelectionFloorDevices = useProjectStore((s) => s.setSelectionFloorDevices)
    const removeFloorDevices = useProjectStore((s) => s.removeFloorDevices)

    const openWallElevationForSegment = useCallback(
      (wallSegmentId: string) => {
        const st = useProjectStore.getState()
        const fl =
          st.project.floors.find((f) => f.id === st.activeFloorId) ??
          st.project.floors[0]
        if (
          fl &&
          !fl.wallSheets.some((w) => w.wallSegmentId === wallSegmentId)
        ) {
          st.syncWallsFromPlan()
        }
        st.setActiveTab('wall')
        st.setActiveWallForPlanSegment(wallSegmentId)
      },
      [],
    )
    const selectedFloorIdSet = useMemo(
      () => new Set(selectionFloorDeviceIds),
      [selectionFloorDeviceIds],
    )
    const selectedWallIdSet = useMemo(
      () => new Set(selectedWallSegmentIds),
      [selectedWallSegmentIds],
    )
    const marqueeRef = useRef<{
      x0: number
      y0: number
      x1: number
      y1: number
    } | null>(null)
    const marqueeShiftRef = useRef(false)
    const [marquee, setMarquee] = useState<{
      x0: number
      y0: number
      x1: number
      y1: number
    } | null>(null)
    const dragPlanRef = useRef<{
      primaryId: string
      positions: Map<string, { x: number; y: number }>
    } | null>(null)
    const dragWallRef = useRef<{ primaryId: string; groupIds: string[] } | null>(null)

    const [wallMountPopover, setWallMountPopover] = useState<{
      anchorLeft: number
      anchorTop: number
      items: PlanWallMountClusterItem[]
    } | null>(null)
    const wallMountPopoverHideRef = useRef<number | null>(null)
    const [deviceTooltip, setDeviceTooltip] = useState<{
      text: string
      left: number
      top: number
    } | null>(null)
    const deviceTooltipTimerRef = useRef<number | null>(null)
    const [wallA, setWallA] = useState<PointM | null>(null)
    const wallARef = useRef<PointM | null>(null)
    wallARef.current = wallA

    const [wallRubberBandM, setWallRubberBandM] = useState<PointM | null>(null)
    const wallPreviewRafRef = useRef<number | null>(null)
    const wallPreviewPendingRef = useRef<{ clientX: number; clientY: number } | null>(
      null,
    )

    const clearWallMountPopoverHide = useCallback(() => {
      if (wallMountPopoverHideRef.current != null) {
        window.clearTimeout(wallMountPopoverHideRef.current)
        wallMountPopoverHideRef.current = null
      }
    }, [])

    const scheduleWallMountPopoverHide = useCallback(() => {
      clearWallMountPopoverHide()
      wallMountPopoverHideRef.current = window.setTimeout(() => {
        wallMountPopoverHideRef.current = null
        setWallMountPopover(null)
      }, 220)
    }, [clearWallMountPopoverHide])

    const clearDeviceTooltipTimer = useCallback(() => {
      if (deviceTooltipTimerRef.current != null) {
        window.clearTimeout(deviceTooltipTimerRef.current)
        deviceTooltipTimerRef.current = null
      }
    }, [])

    const showDeviceTooltipSoon = useCallback(
      (grp: KonvaNode, text: string) => {
        clearDeviceTooltipTimer()
        deviceTooltipTimerRef.current = window.setTimeout(() => {
          deviceTooltipTimerRef.current = null
          const pos = getKonvaGroupScreenAnchorBelow(grp, 16)
          if (!pos) return
          setDeviceTooltip({ text, left: pos.left, top: pos.top })
        }, 180)
      },
      [clearDeviceTooltipTimer],
    )

    const hideDeviceTooltip = useCallback(() => {
      clearDeviceTooltipTimer()
      setDeviceTooltip(null)
    }, [clearDeviceTooltipTimer])

    useEffect(() => () => clearWallMountPopoverHide(), [clearWallMountPopoverHide])
    useEffect(() => () => clearDeviceTooltipTimer(), [clearDeviceTooltipTimer])

    useEffect(() => {
      if (marquee == null) return
      const stage = stageRef.current
      if (!stage) return
      const onMove = (ev: MouseEvent) => {
        const cr = stage.container().getBoundingClientRect()
        const scaleX = stage.width() / cr.width
        const scaleY = stage.height() / cr.height
        const x = (ev.clientX - cr.left) * scaleX
        const y = (ev.clientY - cr.top) * scaleY
        setMarquee((m) => {
          if (!m) return null
          const n = { ...m, x1: x, y1: y }
          marqueeRef.current = n
          return n
        })
      }
      const onUp = () => {
        const m = marqueeRef.current
        setMarquee(null)
        if (!m) return
        const minX = Math.min(m.x0, m.x1)
        const maxX = Math.max(m.x0, m.x1)
        const minY = Math.min(m.y0, m.y1)
        const maxY = Math.max(m.y0, m.y1)
        const st = useProjectStore.getState()
        const dx = maxX - minX
        const dy = maxY - minY
        if (dx < 4 && dy < 4) {
          if (!marqueeShiftRef.current) {
            st.setSelectionFloorDevices([])
          }
          st.setSelectedWallSegmentId(null)
          return
        }
        const fl =
          st.project.floors.find((f) => f.id === st.activeFloorId) ?? st.project.floors[0]!
        const hits: string[] = []
        for (const d of fl.plan.devices) {
          const cx = FLOOR_PADDING_PX + d.x * PPM
          const cy = FLOOR_PADDING_PX + d.y * PPM
          if (cx >= minX && cx <= maxX && cy >= minY && cy <= maxY) {
            hits.push(d.id)
          }
        }
        const wallHits: string[] = []
        for (const w of fl.plan.wallSegments) {
          const xa = FLOOR_PADDING_PX + w.a.x * PPM
          const ya = FLOOR_PADDING_PX + w.a.y * PPM
          const xb = FLOOR_PADDING_PX + w.b.x * PPM
          const yb = FLOOR_PADDING_PX + w.b.y * PPM
          if (segmentIntersectsAabb(xa, ya, xb, yb, minX, minY, maxX, maxY)) {
            wallHits.push(w.id)
          }
        }
        if (marqueeShiftRef.current) {
          const curD = new Set(st.selectionFloorDeviceIds)
          for (const id of hits) curD.add(id)
          st.setSelectionFloorDevices([...curD])
          const curW = new Set(st.selectedWallSegmentIds)
          for (const id of wallHits) curW.add(id)
          st.setSelectedWallSegmentIds([...curW])
        } else {
          st.setSelectionFloorDevices(hits)
          st.setSelectedWallSegmentIds(wallHits)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
    }, [marquee])

    useEffect(() => {
      if (!wallA) {
        setWallRubberBandM(null)
        wallPreviewPendingRef.current = null
        if (wallPreviewRafRef.current != null) {
          cancelAnimationFrame(wallPreviewRafRef.current)
          wallPreviewRafRef.current = null
        }
      }
    }, [wallA])

    useEffect(() => {
      const onWindowKeyDown = (e: KeyboardEvent) => {
        if (useProjectStore.getState().activeTab !== 'floor') return

        const inForm =
          e.target instanceof Element &&
          e.target.closest('input, textarea, select, [contenteditable="true"]')

        if (e.key === 'Escape') {
          if (inForm) return
          if (marquee) {
            e.preventDefault()
            setMarquee(null)
            return
          }
          if (tool === 'wall' && wallA) {
            e.preventDefault()
            setWallA(null)
          }
          return
        }

        if (e.key !== 'Backspace' && e.key !== 'Delete') return
        if (e.defaultPrevented) return
        if (inForm) return
        if (tool !== 'select') return

        const st = useProjectStore.getState()
        const ids = st.selectionFloorDeviceIds
        if (ids.length > 0) {
          e.preventDefault()
          removeFloorDevices(ids)
          return
        }
        const wallIds = st.selectedWallSegmentIds
        if (wallIds.length > 0) {
          e.preventDefault()
          removeWallSegments(wallIds)
          st.setSelectedWallSegmentIds([])
        }
      }
      window.addEventListener('keydown', onWindowKeyDown)
      return () => window.removeEventListener('keydown', onWindowKeyDown)
    }, [tool, wallA, removeFloorDevices, removeWallSegments, marquee])

    const { width, height } = useMemo(
      () => floorStageSize(floor.widthM, floor.depthM),
      [floor.widthM, floor.depthM],
    )

    const toMeters = useCallback(
      (stage: Konva.Stage, clientX: number, clientY: number): PointM => {
        const p = stage.container().getBoundingClientRect()
        const scaleX = stage.width() / p.width
        const scaleY = stage.height() / p.height
        const xPx = (clientX - p.left) * scaleX
        const yPx = (clientY - p.top) * scaleY
        const x = (xPx - FLOOR_PADDING_PX) / PPM
        const y = (yPx - FLOOR_PADDING_PX) / PPM
        return {
          x: clamp(x, 0, floor.widthM),
          y: clamp(y, 0, floor.depthM),
        }
      },
      [floor.widthM, floor.depthM],
    )

    const flushWallRubberBand = useCallback(() => {
      wallPreviewRafRef.current = null
      const p = wallPreviewPendingRef.current
      const stage = stageRef.current
      const anchor = wallARef.current
      if (!p || !stage || !anchor || tool !== 'wall') return
      setWallRubberBandM(toMeters(stage, p.clientX, p.clientY))
    }, [tool, toMeters])

    const onStageMouseMove = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== 'wall' || !wallARef.current) return
        wallPreviewPendingRef.current = {
          clientX: e.evt.clientX,
          clientY: e.evt.clientY,
        }
        if (wallPreviewRafRef.current == null) {
          wallPreviewRafRef.current = requestAnimationFrame(flushWallRubberBand)
        }
      },
      [tool, flushWallRubberBand],
    )

    const bindStageRef = useCallback(
      (node: KonvaStage | null) => {
        stageRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref != null) {
          ;(ref as React.MutableRefObject<KonvaStage | null>).current = node
        }
      },
      [ref],
    )

    const onDragOverPlan: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDropPlan: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      const templateId =
        e.dataTransfer.getData(DND_DEVICE_TEMPLATE) || e.dataTransfer.getData('text/plain')
      if (!templateId) return
      const stage = stageRef.current
      if (!stage) return
      const m = toMeters(stage, e.clientX, e.clientY)
      addFloorDevice(m.x, m.y, templateId)
      setSelectionFloorDevices([])
      setSelectedWallSegmentId(null)
    }

    const onStageMouseDown = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        const stage = e.target.getStage()
        if (!stage) return
        /* Wall corners are drawn as Groups/Lines; bubble must reach Stage (see onMouseDown on walls). */
        if (tool !== 'wall' && e.target !== stage) return

        stage.container().focus()

        let m = toMeters(stage, e.evt.clientX, e.evt.clientY)
        if (tool === 'wall') {
          m = snapWallPointToEndpointsM(m, floor.wallSegments, SNAP_WALL_ENDPOINT_M)
        }

        if (tool === 'wall') {
          if (!wallA) {
            setWallA(m)
            setWallRubberBandM(m)
          } else {
            addWallSegment(wallA, m)
            setWallA(null)
          }
          setSelectionFloorDevices([])
          setSelectedWallSegmentId(null)
          return
        }

        setSelectionFloorDevices([])
        setSelectedWallSegmentId(null)
      },
      [
        addWallSegment,
        floor.wallSegments,
        setSelectedWallSegmentId,
        tool,
        toMeters,
        wallA,
      ],
    )

    const vLines = useMemo(() => {
      const out: number[] = []
      for (let x = 0; x <= floor.widthM; x++) {
        out.push(FLOOR_PADDING_PX + x * PPM)
      }
      return out
    }, [floor.widthM])

    const hLines = useMemo(() => {
      const out: number[] = []
      for (let y = 0; y <= floor.depthM; y++) {
        out.push(FLOOR_PADDING_PX + y * PPM)
      }
      return out
    }, [floor.depthM])

    const wallMountPlanClusters = useMemo(
      () => clusterWallMountDevicesForPlan(activeFloor, deviceCatalog),
      [activeFloor, deviceCatalog],
    )

    return (
      <div className={`editor-floor ${className ?? ''}`}>
        <div className="editor-hint">
          {tool === 'wall' && (
            <span>
              Wall: {wallA ? 'Click second corner' : 'Click first corner'}. Drag a template
              from the palette to add devices.
            </span>
          )}
          {tool === 'region' && (
            <span>Click vertices to outline a region. Drag a template from the palette to add devices.</span>
          )}
          {tool === 'select' && (
            <span>
              Click devices or wall segments; Shift+click to add/remove devices from the
              selection. Drag on empty plan area to box-select devices. Drag a selected device to
              move all selected together. Backspace/Delete removes the selection. Drag a template
              from the palette to add devices.
            </span>
          )}
        </div>
        <div
          onDragOver={onDragOverPlan}
          onDrop={onDropPlan}
          style={{ display: 'inline-block' }}
        >
        <Stage
          ref={bindStageRef}
          width={width}
          height={height}
          onMouseDown={onStageMouseDown}
          onMouseMove={onStageMouseMove}
          tabIndex={0}
        >
          <Layer listening={false}>
            <Rect width={width} height={height} fill="#0f1419" />
            {vLines.map((gx) => (
              <Line
                key={`vx-${gx}`}
                points={[
                  gx,
                  FLOOR_PADDING_PX,
                  gx,
                  FLOOR_PADDING_PX + floor.depthM * PPM,
                ]}
                stroke="#1f2a38"
                strokeWidth={1}
              />
            ))}
            {hLines.map((gy) => (
              <Line
                key={`hz-${gy}`}
                points={[
                  FLOOR_PADDING_PX,
                  gy,
                  FLOOR_PADDING_PX + floor.widthM * PPM,
                  gy,
                ]}
                stroke="#1f2a38"
                strokeWidth={1}
              />
            ))}
            <Rect
              x={FLOOR_PADDING_PX}
              y={FLOOR_PADDING_PX}
              width={floor.widthM * PPM}
              height={floor.depthM * PPM}
              stroke="#3d5a80"
              strokeWidth={2}
              fill="rgba(61,90,128,0.12)"
            />
            <Text
              x={FLOOR_PADDING_PX + 6}
              y={FLOOR_PADDING_PX + 6}
              text={`${floor.label} · ${floor.widthM}×${floor.depthM} m`}
              fill="#98a7b8"
              fontSize={14}
              fontFamily="system-ui, sans-serif"
            />
          </Layer>
          <Layer>
            {tool === 'select' ? (
              <Rect
                x={FLOOR_PADDING_PX}
                y={FLOOR_PADDING_PX}
                width={floor.widthM * PPM}
                height={floor.depthM * PPM}
                fill="rgba(0,0,0,0.02)"
                listening
                onMouseDown={(e) => {
                  e.cancelBubble = true
                  const stage = e.target.getStage()
                  if (!stage) return
                  const pos = stage.getPointerPosition()
                  if (!pos) return
                  marqueeShiftRef.current = e.evt.shiftKey
                  const n = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y }
                  marqueeRef.current = n
                  setMarquee(n)
                }}
              />
            ) : null}
            {floor.wallSegments.map((seg) => {
              const xa = FLOOR_PADDING_PX + seg.a.x * PPM
              const ya = FLOOR_PADDING_PX + seg.a.y * PPM
              const xb = FLOOR_PADDING_PX + seg.b.x * PPM
              const yb = FLOOR_PADDING_PX + seg.b.y * PPM
              const dx = xb - xa
              const dy = yb - ya
              const wallSel = tool === 'select' && selectedWallIdSet.has(seg.id)
              const stableN = wallPlanLabeling.idxMap.get(seg.id) ?? 1
              const wallCode = derivedPlanWallCode(wallPlanLabeling.levelIdx, stableN)
              const alongDeg = segmentAngleDegFromPlusX(seg.a, seg.b)
              const labelW = Math.max(40, wallCode.length * 7)
              const labelH = 14
              return (
                <Group
                  key={seg.id}
                  x={xa}
                  y={ya}
                  draggable={tool === 'select'}
                  onMouseDown={(ev) => {
                    if (tool !== 'wall') ev.cancelBubble = true
                    ev.target.getStage()?.container().focus()
                    if (tool === 'select') {
                      const st = useProjectStore.getState()
                      if (ev.evt.shiftKey) {
                        const cur = [...st.selectedWallSegmentIds]
                        const i = cur.indexOf(seg.id)
                        if (i >= 0) cur.splice(i, 1)
                        else cur.push(seg.id)
                        st.setSelectedWallSegmentIds(cur)
                      } else if (!st.selectedWallSegmentIds.includes(seg.id)) {
                        /* Plain click on an unselected wall: select only it. Click on an already-selected
                         * wall keeps the multi-selection so a subsequent drag moves the whole set. */
                        st.setSelectedWallSegmentIds([seg.id])
                      }
                      st.setSelectionFloorDevices([])
                    }
                  }}
                  onDblClick={(ev) => {
                    ev.cancelBubble = true
                    openWallElevationForSegment(seg.id)
                  }}
                  onDragStart={() => {
                    if (tool !== 'select') return
                    const st = useProjectStore.getState()
                    const groupIds = st.selectedWallSegmentIds.includes(seg.id)
                      ? st.selectedWallSegmentIds
                      : [seg.id]
                    dragWallRef.current = { primaryId: seg.id, groupIds }
                  }}
                  onDragEnd={(ev) => {
                    if (tool !== 'select') return
                    const t = ev.target
                    const node =
                      t.getType() === 'Group' ? t : t.getParent()
                    if (!node) return
                    const dMx = (node.x() - xa) / PPM
                    const dMy = (node.y() - ya) / PPM
                    const info = dragWallRef.current
                    dragWallRef.current = null
                    const ids = info?.groupIds ?? [seg.id]
                    if (dMx === 0 && dMy === 0) {
                      node.position({ x: xa, y: ya })
                      node.getLayer()?.batchDraw()
                      return
                    }
                    const stDrag = useProjectStore.getState()
                    movePlanSelectionByDelta(ids, stDrag.selectionFloorDeviceIds, {
                      x: dMx,
                      y: dMy,
                    })
                    queueMicrotask(() => {
                      const st2 = useProjectStore.getState()
                      const fl2 =
                        st2.project.floors.find((f) => f.id === st2.activeFloorId) ??
                        st2.project.floors[0]!
                      const wseg = fl2.plan.wallSegments.find((s) => s.id === seg.id)
                      if (!wseg) return
                      const nxa = FLOOR_PADDING_PX + wseg.a.x * PPM
                      const nya = FLOOR_PADDING_PX + wseg.a.y * PPM
                      node.position({ x: nxa, y: nya })
                      node.getLayer()?.batchDraw()
                    })
                  }}
                >
                  <Line
                    points={[0, 0, dx, dy]}
                    stroke={wallSel ? '#ffffff' : '#e0e6ed'}
                    strokeWidth={wallSel ? 8 : 6}
                    lineCap="round"
                    hitStrokeWidth={16}
                  />
                  <Text
                    x={dx / 2}
                    y={dy / 2}
                    offsetX={labelW / 2}
                    offsetY={labelH / 2}
                    rotation={readableWallLabelRotationDeg(alongDeg)}
                    text={wallCode}
                    fontSize={10}
                    fill="#2c3a4a"
                    stroke="rgba(248, 250, 252, 0.92)"
                    strokeWidth={0.45}
                    shadowColor="rgba(0, 0, 0, 0.35)"
                    shadowBlur={2}
                    shadowOffset={{ x: 0, y: 1 }}
                    shadowOpacity={1}
                    fontFamily="system-ui, sans-serif"
                    width={labelW}
                    height={labelH}
                    align="center"
                    verticalAlign="middle"
                    listening={false}
                  />
                </Group>
              )
            })}
            {tool === 'wall' && wallA && wallRubberBandM ? (
              <Line
                listening={false}
                points={[
                  FLOOR_PADDING_PX + wallA.x * PPM,
                  FLOOR_PADDING_PX + wallA.y * PPM,
                  FLOOR_PADDING_PX + wallRubberBandM.x * PPM,
                  FLOOR_PADDING_PX + wallRubberBandM.y * PPM,
                ]}
                stroke="#7eb8da"
                strokeWidth={2}
                dash={[10, 6]}
                lineCap="round"
              />
            ) : null}
            {activeFloor.wallSheets.flatMap((sheet) => {
              if (!sheet.wallSegmentId) return []
              const seg = floor.wallSegments.find((s) => s.id === sheet.wallSegmentId)
              if (!seg) return []
              const alongDeg = segmentAngleDegFromPlusX(seg.a, seg.b)
              return (sheet.openings ?? []).map((o) => {
                const { x, y } = worldXYForWallMirrorOnPlan(activeFloor, sheet, o.xM)
                return (
                  <PlanWallOpeningIcon
                    key={`${sheet.id}-${o.id}`}
                    kind={o.kind}
                    x={FLOOR_PADDING_PX + x * PPM}
                    y={FLOOR_PADDING_PX + y * PPM}
                    alongDeg={alongDeg}
                  />
                )
              })
            })}
            {wallMountPlanClusters.map((cluster) => {
              const cx = FLOOR_PADDING_PX + cluster.worldX * PPM
              const cy = FLOOR_PADDING_PX + cluster.worldY * PPM
              const seg = floor.wallSegments.find((s) => s.id === cluster.segmentId)
              const alongDeg = seg ? segmentAngleDegFromPlusX(seg.a, seg.b) : 0
              const n = cluster.items.length
              if (n === 1) {
                const d = cluster.items[0]!.device
                return (
                  <Group
                    key={cluster.id}
                    x={cx}
                    y={cy}
                    onMouseEnter={(e) => {
                      showDeviceTooltipSoon(
                        e.currentTarget,
                        deviceHoverLabel(d),
                      )
                    }}
                    onMouseLeave={hideDeviceTooltip}
                  >
                    <Circle
                      radius={16}
                      fill="rgba(0,0,0,0.02)"
                      strokeEnabled={false}
                    />
                    <Circle
                      radius={9}
                      fill={deviceFill(d.type)}
                      stroke="#0b0f14"
                      strokeWidth={1}
                      listening={false}
                    />
                    <Text
                      text={deviceGlyph(d.type, d.connectorSubtype)}
                      fontSize={11}
                      fill="#0b0f14"
                      width={22}
                      height={22}
                      offsetX={11}
                      offsetY={11}
                      align="center"
                      verticalAlign="middle"
                      fontStyle="bold"
                      listening={false}
                    />
                  </Group>
                )
              }
              return (
                <Group
                  key={cluster.id}
                  x={cx}
                  y={cy}
                  rotation={alongDeg}
                  listening
                  onMouseEnter={(e) => {
                    e.cancelBubble = true
                    clearWallMountPopoverHide()
                    const grp = e.currentTarget
                    const stage = grp.getStage()
                    if (!stage) return
                    const abs = grp.getAbsolutePosition()
                    const cr = stage.container().getBoundingClientRect()
                    const sx = cr.width / stage.width()
                    const sy = cr.height / stage.height()
                    setWallMountPopover({
                      anchorLeft: cr.left + abs.x * sx,
                      anchorTop: cr.top + abs.y * sy + 14 * sy,
                      items: cluster.items,
                    })
                  }}
                  onMouseLeave={() => {
                    scheduleWallMountPopoverHide()
                  }}
                  onMouseDown={(ev) => {
                    if (tool !== 'wall') ev.cancelBubble = true
                    ev.target.getStage()?.container().focus()
                  }}
                  onDblClick={(ev) => {
                    ev.cancelBubble = true
                    openWallElevationForSegment(cluster.segmentId)
                  }}
                >
                  <Circle
                    radius={18}
                    fill="rgba(0,0,0,0.02)"
                    strokeEnabled={false}
                  />
                  <Circle
                    x={-4}
                    y={0}
                    radius={10}
                    fill="#374151"
                    stroke="#0b0f14"
                    strokeWidth={1}
                    listening={false}
                  />
                  <Circle
                    x={4}
                    y={0}
                    radius={10}
                    fill={deviceFill(cluster.items[0]!.device.type)}
                    stroke="#0b0f14"
                    strokeWidth={1}
                    listening={false}
                  />
                  <Text
                    text={String(n)}
                    fontSize={11}
                    fill="#f8fafc"
                    width={22}
                    height={18}
                    offsetX={11}
                    offsetY={9}
                    align="center"
                    verticalAlign="middle"
                    fontStyle="bold"
                    listening={false}
                  />
                </Group>
              )
            })}
            {floor.devices.map((d) => {
              const cx = FLOOR_PADDING_PX + d.x * PPM
              const cy = FLOOR_PADDING_PX + d.y * PPM
              const selected = selectedFloorIdSet.has(d.id)
              return (
                <Group
                  key={d.id}
                  x={cx}
                  y={cy}
                  draggable={tool === 'select'}
                  onMouseDown={(ev) => {
                    if (tool !== 'wall') ev.cancelBubble = true
                    ev.target.getStage()?.container().focus()
                    if (tool === 'select') {
                      const st = useProjectStore.getState()
                      if (ev.evt.shiftKey) {
                        const cur = [...st.selectionFloorDeviceIds]
                        const i = cur.indexOf(d.id)
                        if (i >= 0) cur.splice(i, 1)
                        else cur.push(d.id)
                        st.setSelectionFloorDevices(cur)
                      } else if (!st.selectionFloorDeviceIds.includes(d.id)) {
                        /* Same as walls: plain click on a selected device keeps multi-select for group drag. */
                        st.setSelectionFloorDevices([d.id])
                      }
                      st.setSelectedWallSegmentId(null)
                    }
                  }}
                  onMouseEnter={(e) => {
                    showDeviceTooltipSoon(
                      e.currentTarget,
                      deviceHoverLabel(d),
                    )
                  }}
                  onMouseLeave={hideDeviceTooltip}
                  onDragStart={() => {
                    if (tool !== 'select') return
                    const st = useProjectStore.getState()
                    const fl =
                      st.project.floors.find((f) => f.id === st.activeFloorId) ??
                      st.project.floors[0]!
                    const groupIds = st.selectionFloorDeviceIds.includes(d.id)
                      ? st.selectionFloorDeviceIds
                      : [d.id]
                    const positions = new Map<string, { x: number; y: number }>()
                    for (const id of groupIds) {
                      const dev = fl.plan.devices.find((x) => x.id === id)
                      if (dev) positions.set(id, { x: dev.x, y: dev.y })
                    }
                    dragPlanRef.current = { primaryId: d.id, positions }
                  }}
                  onDragEnd={(ev) => {
                    const node = ev.currentTarget
                    const nx = clamp(
                      (node.x() - FLOOR_PADDING_PX) / PPM,
                      0,
                      floor.widthM,
                    )
                    const ny = clamp(
                      (node.y() - FLOOR_PADDING_PX) / PPM,
                      0,
                      floor.depthM,
                    )
                    const info = dragPlanRef.current
                    dragPlanRef.current = null
                    const finishWithAbsolutePosition = () => {
                      const st0 = useProjectStore.getState()
                      const fl0 =
                        st0.project.floors.find((f) => f.id === st0.activeFloorId) ??
                        st0.project.floors[0]!
                      const curDev = fl0.plan.devices.find((x) => x.id === d.id)
                      if (!curDev) {
                        moveFloorDevice(d.id, nx, ny)
                        return
                      }
                      const devIds = st0.selectionFloorDeviceIds.includes(d.id)
                        ? st0.selectionFloorDeviceIds
                        : [d.id]
                      const rdx = nx - curDev.x
                      const rdy = ny - curDev.y
                      if (Math.abs(rdx) < 1e-9 && Math.abs(rdy) < 1e-9) return
                      movePlanSelectionByDelta(st0.selectedWallSegmentIds, devIds, {
                        x: rdx,
                        y: rdy,
                      })
                      queueMicrotask(() => {
                        const st2 = useProjectStore.getState()
                        const fl2 =
                          st2.project.floors.find((f) => f.id === st2.activeFloorId) ??
                          st2.project.floors[0]!
                        const dev = fl2.plan.devices.find((x) => x.id === d.id)
                        if (!dev) return
                        node.position({
                          x: FLOOR_PADDING_PX + dev.x * PPM,
                          y: FLOOR_PADDING_PX + dev.y * PPM,
                        })
                        node.getLayer()?.batchDraw()
                      })
                    }
                    if (!info || tool !== 'select') {
                      finishWithAbsolutePosition()
                      return
                    }
                    const start = info.positions.get(info.primaryId)
                    if (!start) {
                      finishWithAbsolutePosition()
                      return
                    }
                    const dx = nx - start.x
                    const dy = ny - start.y
                    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
                    const ids = [...info.positions.keys()]
                    const stDrag = useProjectStore.getState()
                    movePlanSelectionByDelta(stDrag.selectedWallSegmentIds, ids, {
                      x: dx,
                      y: dy,
                    })
                    queueMicrotask(() => {
                      const st2 = useProjectStore.getState()
                      const fl2 =
                        st2.project.floors.find((f) => f.id === st2.activeFloorId) ??
                        st2.project.floors[0]!
                      const dev = fl2.plan.devices.find((x) => x.id === d.id)
                      if (!dev) return
                      node.position({
                        x: FLOOR_PADDING_PX + dev.x * PPM,
                        y: FLOOR_PADDING_PX + dev.y * PPM,
                      })
                      node.getLayer()?.batchDraw()
                    })
                  }}
                >
                  <Circle
                    radius={18}
                    fill="rgba(0,0,0,0.02)"
                    strokeEnabled={false}
                  />
                  <Circle
                    radius={14}
                    fill={deviceFill(d.type)}
                    stroke={selected ? '#ffffff' : '#0b0f14'}
                    strokeWidth={selected ? 2 : 1}
                    listening={false}
                  />
                  <Text
                    text={deviceGlyph(d.type, d.connectorSubtype)}
                    fontSize={14}
                    fill="#0b0f14"
                    width={28}
                    height={28}
                    offsetX={14}
                    offsetY={14}
                    align="center"
                    verticalAlign="middle"
                    fontStyle="bold"
                    listening={false}
                  />
                </Group>
              )
            })}
            {marquee ? (
              <Rect
                listening={false}
                x={Math.min(marquee.x0, marquee.x1)}
                y={Math.min(marquee.y0, marquee.y1)}
                width={Math.abs(marquee.x1 - marquee.x0)}
                height={Math.abs(marquee.y1 - marquee.y0)}
                fill="rgba(126,184,218,0.12)"
                stroke="#7eb8da"
                strokeWidth={1}
                dash={[5, 5]}
              />
            ) : null}
          </Layer>
        </Stage>
        </div>
        {deviceTooltip ? (
          <div
            style={{
              position: 'fixed',
              left: deviceTooltip.left,
              top: deviceTooltip.top,
              zIndex: 51,
              maxWidth: 280,
              padding: '4px 8px',
              borderRadius: 4,
              background: '#1a2332',
              border: '1px solid #3d5a80',
              boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
              color: '#e8eef4',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
            }}
          >
            {deviceTooltip.text}
          </div>
        ) : null}
        {wallMountPopover ? (
          <div
            style={{
              position: 'fixed',
              left: wallMountPopover.anchorLeft,
              top: wallMountPopover.anchorTop,
              zIndex: 50,
              minWidth: 200,
              maxWidth: 320,
              maxHeight: 220,
              overflowY: 'auto',
              padding: '8px 10px',
              borderRadius: 6,
              background: '#1a2332',
              border: '1px solid #3d5a80',
              boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
              color: '#e8eef4',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
            }}
          >
            {wallMountPopover.items.map(({ sheet, device }) => (
              <div
                key={device.id}
                style={{
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(61,90,128,0.45)',
                }}
              >
                <span style={{ fontWeight: 600 }}>{device.label}</span>
                <span style={{ opacity: 0.9 }}> · {device.type}</span>
                {device.circuitRef ? (
                  <span style={{ opacity: 0.85 }}> · {device.circuitRef}</span>
                ) : null}
                <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>
                  {sheet.label}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {deviceTooltip ? (
          <div
            style={{
              position: 'fixed',
              left: deviceTooltip.left,
              top: deviceTooltip.top,
              zIndex: 60,
              maxWidth: 280,
              padding: '6px 10px',
              borderRadius: 6,
              background: '#1a2332',
              border: '1px solid #3d5a80',
              boxShadow: '0 4px 14px rgba(0,0,0,0.35)',
              color: '#e8eef4',
              fontSize: 12,
              fontFamily: 'system-ui, sans-serif',
              pointerEvents: 'none',
            }}
          >
            {deviceTooltip.text}
          </div>
        ) : null}
      </div>
    )
  },
)
