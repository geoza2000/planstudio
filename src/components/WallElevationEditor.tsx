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
import { DND_DEVICE_TEMPLATE, filterWallDevicesForElevationView } from '../lib/deviceCatalog'
import {
  WALL_ELEVATION_INNER_X,
  WALL_ELEVATION_INNER_Y,
  wallMetersFromWallDeviceDragEnd,
  wallPointerStagePxToMeters,
} from '../lib/planCoordinates'
import { newWallOpeningMeters } from '../lib/wallOpeningDefaults'
import { getKonvaGroupScreenAnchorBelow } from '../lib/konvaScreenAnchor'
import { PPM, wallStageSize } from '../lib/renderScale'
import { deviceFill, deviceGlyph } from '../lib/deviceStyle'
import { useProjectStore } from '../store/projectStore'
import { deviceHoverLabel, type WallSheet } from '../types/project'
import type { Node as KonvaNode } from 'konva/lib/Node'

/** Stable placeholder so hooks always run before any early return. */
const WALL_ELEVATION_PLACEHOLDER: WallSheet = {
  id: '__wall_elevation_placeholder__',
  floorLevelId: '',
  label: '',
  lengthM: 4,
  heightM: 2.8,
  devices: [],
  openings: [],
}

type WallElevationEditorProps = {
  className?: string
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

export const WallElevationEditor = forwardRef<KonvaStage, WallElevationEditorProps>(
  function WallElevationEditor({ className }, ref) {
    const project = useProjectStore((s) => s.project)
    const activeFloorId = useProjectStore((s) => s.activeFloorId)
    const activeWallId = useProjectStore((s) => s.activeWallId)
    const tool = useProjectStore((s) => s.floorTool)
    const addWallMountDevice = useProjectStore((s) => s.addWallMountDevice)
    const deviceCatalog = useProjectStore((s) => s.project.deviceCatalog ?? [])
    const moveWallMountDevice = useProjectStore((s) => s.moveWallMountDevice)
    const addWallOpening = useProjectStore((s) => s.addWallOpening)
    const moveWallOpening = useProjectStore((s) => s.moveWallOpening)
    const wallOpeningKind = useProjectStore((s) => s.wallOpeningKind)
    const selectionWallOpening = useProjectStore((s) => s.selectionWallOpening)
    const setSelectionWallDevice = useProjectStore(
      (s) => s.setSelectionWallDevice,
    )
    const setSelectionWallOpening = useProjectStore(
      (s) => s.setSelectionWallOpening,
    )

    const wallSheets = useMemo(
      () =>
        project.floors.find((f) => f.id === activeFloorId)?.wallSheets ?? [],
      [project.floors, activeFloorId],
    )
    const resolvedWall =
      wallSheets.find((w) => w.id === activeWallId) ?? wallSheets[0] ?? null
    const hasRealWall = resolvedWall != null
    const wall = resolvedWall ?? WALL_ELEVATION_PLACEHOLDER

    const { width, height } = useMemo(
      () => wallStageSize(wall.lengthM, wall.heightM),
      [wall.lengthM, wall.heightM],
    )

    const innerLeft = WALL_ELEVATION_INNER_X
    const innerTop = WALL_ELEVATION_INNER_Y
    const innerW = wall.lengthM * PPM
    const innerH = wall.heightM * PPM
    const floorY = innerTop + innerH

    const [selectedId, setSelectedId] = useState<string | null>(null)
    /** Pointer meters while placing an opening — drives ghost preview before click. */
    const [openingHoverM, setOpeningHoverM] = useState<{
      xM: number
      zM: number
    } | null>(null)
    const [deviceTooltip, setDeviceTooltip] = useState<{
      text: string
      left: number
      top: number
    } | null>(null)
    const deviceTooltipTimerRef = useRef<number | null>(null)

    const wallDropWrapRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
      if (tool !== 'opening') setOpeningHoverM(null)
    }, [tool])

    const visibleWallDevices = useMemo(
      () => filterWallDevicesForElevationView(wall.devices, deviceCatalog),
      [wall.devices, deviceCatalog],
    )

    const deleteWallSelection = useCallback((): boolean => {
      const st = useProjectStore.getState()
      if (st.selectionWallOpening) {
        st.removeWallOpening(
          st.selectionWallOpening.wallSheetId,
          st.selectionWallOpening.openingId,
        )
        st.setSelectionWallOpening(null, null)
        setSelectedId(null)
        return true
      }
      const { selectionWallDevice } = st
      if (!selectionWallDevice) return false
      const { removeWallMountDevice, setSelectionWallDevice: clearSel } = st
      removeWallMountDevice(
        selectionWallDevice.wallSheetId,
        selectionWallDevice.deviceId,
      )
      clearSel(null, null)
      setSelectedId(null)
      return true
    }, [])

    useEffect(() => {
      const onWindowKeyDown = (e: KeyboardEvent) => {
        if (e.key !== 'Backspace' && e.key !== 'Delete') return
        if (e.defaultPrevented) return
        const { activeTab, floorTool } = useProjectStore.getState()
        if (activeTab !== 'wall' || floorTool !== 'select') return
        const t = e.target
        if (
          t instanceof Element &&
          t.closest('input, textarea, select, [contenteditable="true"]')
        ) {
          return
        }
        if (!deleteWallSelection()) return
        e.preventDefault()
      }
      window.addEventListener('keydown', onWindowKeyDown)
      return () => window.removeEventListener('keydown', onWindowKeyDown)
    }, [deleteWallSelection])

    const focusStage = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage()
      stage?.container().focus()
    }, [])

    const onDragOverWallStage: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDropWallStage: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      if (!hasRealWall) return
      const id =
        e.dataTransfer.getData(DND_DEVICE_TEMPLATE) || e.dataTransfer.getData('text/plain')
      if (!id) return
      const el = wallDropWrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const xPx = e.clientX - r.left
      const yPx = e.clientY - r.top
      const { xM, zM } = wallPointerStagePxToMeters(
        xPx,
        yPx,
        wall.heightM,
        innerLeft,
        innerTop,
      )
      addWallMountDevice(
        wall.id,
        clamp(xM, 0, wall.lengthM),
        clamp(zM, 0, wall.heightM),
        id,
      )
      setSelectedId(null)
    }

    const onWallAreaDown = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (!hasRealWall) return
        focusStage(e)
        const stage = e.target.getStage()
        if (!stage) return

        if (tool === 'opening') {
          const pos = stage.getPointerPosition()
          if (!pos) return
          const { xM, zM } = wallPointerStagePxToMeters(
            pos.x,
            pos.y,
            wall.heightM,
            innerLeft,
            innerTop,
          )
          addWallOpening(
            wall.id,
            clamp(xM, 0, wall.lengthM),
            clamp(zM, 0, wall.heightM),
          )
          setSelectedId(null)
          setOpeningHoverM(null)
          return
        }

        if (tool === 'select') {
          setSelectedId(null)
          setSelectionWallDevice(null, null)
          setSelectionWallOpening(null, null)
        }
      },
      [
        addWallOpening,
        focusStage,
        hasRealWall,
        innerLeft,
        innerTop,
        setSelectionWallDevice,
        setSelectionWallOpening,
        tool,
        wall.id,
        wall.lengthM,
        wall.heightM,
      ],
    )

    const openingPreview =
      tool === 'opening' && openingHoverM && hasRealWall
        ? newWallOpeningMeters(wall, wallOpeningKind, openingHoverM.xM, openingHoverM.zM)
        : null

    const onWallSurfacePointerMove = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (tool !== 'opening' || !hasRealWall) return
        const stage = e.target.getStage()
        if (!stage) return
        const pos = stage.getPointerPosition()
        if (!pos) return
        const { xM, zM } = wallPointerStagePxToMeters(
          pos.x,
          pos.y,
          wall.heightM,
          innerLeft,
          innerTop,
        )
        setOpeningHoverM({
          xM: clamp(xM, 0, wall.lengthM),
          zM: clamp(zM, 0, wall.heightM),
        })
      },
      [hasRealWall, innerLeft, innerTop, tool, wall.heightM, wall.lengthM],
    )

    const onWallSurfacePointerLeave = useCallback(() => {
      if (tool === 'opening') setOpeningHoverM(null)
    }, [tool])

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
          const pos = getKonvaGroupScreenAnchorBelow(grp, 14)
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

    useEffect(() => () => clearDeviceTooltipTimer(), [clearDeviceTooltipTimer])

    if (!hasRealWall) {
      return (
        <div className={className}>
          <p className="editor-hint">
            No wall sheets on this floor yet. Draw a wall on the floor plan, use “Sync
            walls from plan”, or add a custom wall on the Wall tab
          </p>
        </div>
      )
    }

    return (
      <div className={`editor-wall ${className ?? ''}`}>
        <div className="editor-hint">
          {tool === 'opening' && (
            <span>
              Click to place {wallOpeningKind} on elevation; shown on the floor plan when
              the wall is linked to a plan segment. Drag a device template from the palette to
              add wall or plan-linked devices.
            </span>
          )}
          {tool === 'select' && (
            <span>
              Drag, Backspace removes, green = device linked to plan. Drag a template from the
              palette to add devices.
            </span>
          )}
        </div>
        <div
          ref={wallDropWrapRef}
          onDragOver={onDragOverWallStage}
          onDrop={onDropWallStage}
          style={{ display: 'inline-block' }}
        >
          <Stage
            ref={ref}
            width={width}
            height={height}
            onKeyDown={(e: Konva.KonvaEventObject<KeyboardEvent>) => {
              if (e.evt.key !== 'Backspace' && e.evt.key !== 'Delete') return
              if (deleteWallSelection()) {
                e.evt.preventDefault()
              }
            }}
            tabIndex={0}
          >
          <Layer listening={false}>
            <Rect width={width} height={height} fill="#0f1419" />
            <Text
              x={WALL_ELEVATION_INNER_X}
              y={12}
              text={`${wall.label} · ${wall.lengthM}×${wall.heightM} m`}
              fill="#98a7b8"
              fontSize={14}
              fontFamily="system-ui, sans-serif"
            />
            <Rect
              x={innerLeft}
              y={innerTop}
              width={innerW}
              height={innerH}
              stroke="#3d5a80"
              strokeWidth={2}
              fill="rgba(61,90,128,0.1)"
            />
            <Line
              points={[innerLeft, floorY, innerLeft + innerW, floorY]}
              stroke="#98a7b8"
              strokeWidth={2}
              dash={[8, 6]}
            />
          </Layer>
          <Layer>
            <Rect
              x={innerLeft}
              y={innerTop}
              width={innerW}
              height={innerH}
              fill="rgba(0,0,0,0.01)"
              onMouseDown={onWallAreaDown}
              onMouseMove={onWallSurfacePointerMove}
              onMouseLeave={onWallSurfacePointerLeave}
            />
            {(wall.openings ?? []).map((o) => {
              const left = innerLeft + (o.xM - o.widthM / 2) * PPM
              const top =
                innerTop + (wall.heightM - o.zM - o.heightM / 2) * PPM
              const wpx = o.widthM * PPM
              const hpx = o.heightM * PPM
              const selO =
                selectionWallOpening?.wallSheetId === wall.id &&
                selectionWallOpening.openingId === o.id
              const fill =
                o.kind === 'door'
                  ? 'rgba(196,165,116,0.35)'
                  : 'rgba(125,211,252,0.28)'
              return (
                <Group
                  key={o.id}
                  x={left + wpx / 2}
                  y={top + hpx / 2}
                  draggable={tool === 'select'}
                  listening={tool === 'select'}
                  onMouseDown={(ev) => {
                    ev.cancelBubble = true
                    focusStage(ev)
                    if (tool === 'select') {
                      setSelectedId(null)
                      setSelectionWallDevice(null, null)
                      setSelectionWallOpening(wall.id, o.id)
                    }
                  }}
                  onDragEnd={(ev) => {
                    const { xM, zM } = wallMetersFromWallDeviceDragEnd(
                      ev.target,
                      wall.heightM,
                      innerLeft,
                      innerTop,
                    )
                    moveWallOpening(
                      wall.id,
                      o.id,
                      clamp(xM, 0, wall.lengthM),
                      clamp(zM, 0, wall.heightM),
                    )
                  }}
                >
                  <Rect
                    x={-wpx / 2}
                    y={-hpx / 2}
                    width={wpx}
                    height={hpx}
                    fill={fill}
                    cornerRadius={2}
                    stroke={selO ? '#ffffff' : '#0b0f14'}
                    strokeWidth={selO ? 2 : 1}
                  />
                  {o.label ? (
                    <Text
                      text={o.label}
                      fontSize={10}
                      fill="#e2e8f0"
                      width={wpx}
                      height={hpx}
                      offsetX={wpx / 2}
                      offsetY={hpx / 2}
                      align="center"
                      verticalAlign="middle"
                    />
                  ) : null}
                </Group>
              )
            })}
            {openingPreview ? (
              <Group listening={false}>
                <Rect
                  x={innerLeft + (openingPreview.xM - openingPreview.widthM / 2) * PPM}
                  y={
                    innerTop +
                    (wall.heightM - openingPreview.zM - openingPreview.heightM / 2) * PPM
                  }
                  width={openingPreview.widthM * PPM}
                  height={openingPreview.heightM * PPM}
                  fill={
                    openingPreview.kind === 'door'
                      ? 'rgba(196,165,116,0.22)'
                      : 'rgba(125,211,252,0.18)'
                  }
                  stroke={
                    openingPreview.kind === 'door' ? '#c4a574' : '#7dd3fc'
                  }
                  strokeWidth={1.5}
                  dash={[6, 5]}
                  cornerRadius={2}
                />
              </Group>
            ) : null}
            {visibleWallDevices.map((d) => {
              const cx = innerLeft + d.xM * PPM
              const cy = innerTop + (wall.heightM - d.zM) * PPM
              const selected = d.id === selectedId
              const linked = Boolean(d.linkedFloorDeviceId)
              return (
                <Group
                  key={d.id}
                  x={cx}
                  y={cy}
                  draggable={tool === 'select'}
                  listening={tool === 'select'}
                  onMouseDown={(ev) => {
                    ev.cancelBubble = true
                    focusStage(ev)
                    if (tool === 'select') {
                      setSelectedId(d.id)
                      setSelectionWallOpening(null, null)
                      setSelectionWallDevice(wall.id, d.id)
                    }
                  }}
                  onMouseEnter={(e) => {
                    if (tool !== 'select') return
                    showDeviceTooltipSoon(e.currentTarget, deviceHoverLabel(d))
                  }}
                  onMouseLeave={hideDeviceTooltip}
                  onDragEnd={(ev) => {
                    const { xM, zM } = wallMetersFromWallDeviceDragEnd(
                      ev.target,
                      wall.heightM,
                      innerLeft,
                      innerTop,
                    )
                    moveWallMountDevice(
                      wall.id,
                      d.id,
                      clamp(xM, 0, wall.lengthM),
                      clamp(zM, 0, wall.heightM),
                    )
                  }}
                >
                  <Circle
                    radius={16}
                    fill="rgba(0,0,0,0.02)"
                    strokeEnabled={false}
                  />
                  <Circle
                    radius={12}
                    fill={deviceFill(d.type)}
                    stroke={selected ? '#ffffff' : linked ? '#4ade80' : '#0b0f14'}
                    strokeWidth={selected || linked ? 2 : 1}
                    listening={false}
                  />
                  <Text
                    text={deviceGlyph(d.type, d.connectorSubtype)}
                    fontSize={12}
                    fill="#0b0f14"
                    width={24}
                    height={24}
                    offsetX={12}
                    offsetY={12}
                    align="center"
                    verticalAlign="middle"
                    fontStyle="bold"
                    listening={false}
                  />
                </Group>
              )
            })}
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
      </div>
    )
  },
)
