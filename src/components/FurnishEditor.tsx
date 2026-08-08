import type Konva from 'konva'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type DragEventHandler,
} from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import { FLOOR_PADDING_PX, floorStageSize, PPM } from '../lib/renderScale'
import {
  DND_FURNITURE_KIND,
  furnitureDisplayLabel,
  furnitureSpec,
  isFurnitureKind,
} from '../lib/furnitureCatalog'
import {
  effectiveWallMaterial,
  effectiveWallThicknessM,
  wallMaterialPlanHatch,
  wallMaterialPlanStroke,
} from '../lib/wallConstruction'
import { segmentAngleDegFromPlusX } from '../lib/wallPlanSync'
import { worldXYForWallMirrorOnPlan } from '../lib/planWallMirrorPosition'
import { snapMeters } from '../lib/geometry'
import { regionIsExternal } from '../types/project'
import { useProjectStore } from '../store/projectStore'
import { FurnitureGlyphShape } from './FurnitureGlyphShape'
import { PlanWallOpeningIcon } from './PlanWallOpeningIcon'

type FurnishEditorProps = {
  className?: string
}

/** Rotation step for the R / Shift+R hotkeys (degrees). */
const ROTATE_STEP_DEG = 15

/**
 * Furnish tab canvas: the electrical plan geometry (walls, rooms, openings) is drawn
 * read-only underneath, and furniture / sanitary blocks on top are selectable, draggable
 * and rotatable. Nothing here touches the BOM — it is metadata for the 3D render prompt.
 */
export const FurnishEditor = forwardRef<KonvaStage, FurnishEditorProps>(
  function FurnishEditor({ className }, ref) {
    const stageRef = useRef<KonvaStage | null>(null)
    const project = useProjectStore((s) => s.project)
    const activeFloorId = useProjectStore((s) => s.activeFloorId)
    const activeFloor = useMemo(
      () => project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0]!,
      [project.floors, activeFloorId],
    )
    const plan = activeFloor.plan
    const editorSettings = project.editorSettings
    const selectionFurnitureId = useProjectStore((s) => s.selectionFurnitureId)
    const setSelectionFurnitureId = useProjectStore((s) => s.setSelectionFurnitureId)
    const addFurnitureItem = useProjectStore((s) => s.addFurnitureItem)
    const moveFurnitureItem = useProjectStore((s) => s.moveFurnitureItem)
    const duplicateFurnitureItem = useProjectStore((s) => s.duplicateFurnitureItem)

    const { width, height } = floorStageSize(plan.widthM, plan.depthM)

    const bindStageRef = useCallback(
      (node: KonvaStage | null) => {
        stageRef.current = node
        if (typeof ref === 'function') ref(node)
        else if (ref) {
          ;(ref as React.MutableRefObject<KonvaStage | null>).current = node
        }
      },
      [ref],
    )

    /** Delete / duplicate / rotate the selected item from the keyboard. */
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const st = useProjectStore.getState()
        if (st.activeTab !== 'furnish') return
        const id = st.selectionFurnitureId
        if (!id) return
        const target = e.target as HTMLElement | null
        const tag = target?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (target?.isContentEditable) return

        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          st.removeFurnitureItem(id)
          return
        }
        if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const fl = st.project.floors.find((f) => f.id === st.activeFloorId)
          const item = fl?.plan.furniture.find((f) => f.id === id)
          if (!item) return
          e.preventDefault()
          const step = e.shiftKey ? -ROTATE_STEP_DEG : ROTATE_STEP_DEG
          st.updateFurnitureItem(id, { rotationDeg: item.rotationDeg + step })
          return
        }
        if (e.key.toLowerCase() === 'd' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          st.duplicateFurnitureItem(id)
        }
      }
      document.addEventListener('keydown', onKeyDown)
      return () => document.removeEventListener('keydown', onKeyDown)
    }, [])

    const onDragOverCanvas: DragEventHandler<HTMLDivElement> = (e) => {
      if (e.dataTransfer.types.includes(DND_FURNITURE_KIND)) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    }

    const onDropCanvas: DragEventHandler<HTMLDivElement> = (e) => {
      const kind = e.dataTransfer.getData(DND_FURNITURE_KIND)
      if (!isFurnitureKind(kind)) return
      e.preventDefault()
      const stage = stageRef.current
      if (!stage) return
      const box = stage.container().getBoundingClientRect()
      const xM = (e.clientX - box.left - FLOOR_PADDING_PX) / PPM
      const yM = (e.clientY - box.top - FLOOR_PADDING_PX) / PPM
      const snapped = snapMeters({ x: xM, y: yM }, editorSettings.snapGridM)
      addFurnitureItem(kind, snapped.x, snapped.y)
    }

    const openingIcons = useMemo(() => {
      const out: { key: string; kind: 'door' | 'window'; x: number; y: number; deg: number; w: number }[] =
        []
      for (const sheet of activeFloor.wallSheets) {
        if (!sheet.wallSegmentId) continue
        const seg = plan.wallSegments.find((s) => s.id === sheet.wallSegmentId)
        if (!seg) continue
        const base = segmentAngleDegFromPlusX(seg.a, seg.b)
        const deg = sheet.wallFace === 'b' ? base + 180 : base
        for (const o of sheet.openings ?? []) {
          const { x, y } = worldXYForWallMirrorOnPlan(activeFloor, sheet, o.xM)
          out.push({ key: `${sheet.id}|${o.id}`, kind: o.kind, x, y, deg, w: o.widthM })
        }
      }
      return out
    }, [activeFloor, plan.wallSegments])

    const furniture = plan.furniture ?? []

    return (
      <div className={className}>
        <div className="editor-hint">
          <span>
            Drag items from the palette onto the plan. Click to select, drag to move,{' '}
            <strong>R</strong> / <strong>Shift+R</strong> rotates by {ROTATE_STEP_DEG}°,{' '}
            <strong>⌘/Ctrl+D</strong> duplicates, <strong>Delete</strong> removes. Walls,
            rooms and openings come from the Floor and Wall tabs and are read-only here.
          </span>
        </div>
        <div
          onDragOver={onDragOverCanvas}
          onDrop={onDropCanvas}
          style={{ display: 'inline-block' }}
        >
          <Stage
            ref={bindStageRef}
            width={width}
            height={height}
            tabIndex={0}
            onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
              /* Clicking empty canvas clears the selection. */
              if (e.target === e.target.getStage()) setSelectionFurnitureId(null)
            }}
          >
            <Layer listening={false}>
              <Rect width={width} height={height} fill="#0f1419" />
              <Rect
                x={FLOOR_PADDING_PX}
                y={FLOOR_PADDING_PX}
                width={plan.widthM * PPM}
                height={plan.depthM * PPM}
                stroke="#3d5a80"
                strokeWidth={2}
                fill="rgba(61,90,128,0.12)"
              />
              <Text
                x={FLOOR_PADDING_PX + 6}
                y={FLOOR_PADDING_PX + 6}
                text={`${plan.label} · furnish`}
                fill="#98a7b8"
                fontSize={14}
                fontFamily="system-ui, sans-serif"
              />
              {(plan.regions ?? []).map((region) => {
                if (region.vertices.length < 3) return null
                const pts: number[] = []
                for (const v of region.vertices) {
                  pts.push(FLOOR_PADDING_PX + v.x * PPM, FLOOR_PADDING_PX + v.y * PPM)
                }
                const cx =
                  region.vertices.reduce((s, v) => s + v.x, 0) / region.vertices.length
                const cy =
                  region.vertices.reduce((s, v) => s + v.y, 0) / region.vertices.length
                const external = regionIsExternal(region)
                return (
                  <Group key={region.id}>
                    <Line
                      points={pts}
                      closed
                      fill={
                        external
                          ? 'hsla(160, 45%, 45%, 0.18)'
                          : 'rgba(148, 163, 184, 0.10)'
                      }
                      stroke={
                        external ? 'rgba(110, 231, 183, 0.45)' : 'rgba(255,255,255,0.16)'
                      }
                      strokeWidth={1}
                      dash={external ? [7, 5] : undefined}
                    />
                    <Text
                      x={FLOOR_PADDING_PX + cx * PPM - 60}
                      y={FLOOR_PADDING_PX + cy * PPM - 8}
                      width={120}
                      height={16}
                      align="center"
                      verticalAlign="middle"
                      text={external ? `${region.label} · outdoor` : region.label}
                      fontSize={12}
                      fill={external ? '#6ee7b7' : '#8494a8'}
                      fontFamily="system-ui, sans-serif"
                    />
                  </Group>
                )
              })}
              {plan.wallSegments.map((seg) => {
                const material = effectiveWallMaterial(seg, editorSettings)
                const hatch = wallMaterialPlanHatch(material)
                const thickPx = Math.max(
                  4,
                  effectiveWallThicknessM(seg, editorSettings) * PPM,
                )
                const pts = [
                  FLOOR_PADDING_PX + seg.a.x * PPM,
                  FLOOR_PADDING_PX + seg.a.y * PPM,
                  FLOOR_PADDING_PX + seg.b.x * PPM,
                  FLOOR_PADDING_PX + seg.b.y * PPM,
                ]
                return (
                  <Group key={seg.id}>
                    <Line
                      points={pts}
                      stroke={wallMaterialPlanStroke(material)}
                      strokeWidth={thickPx}
                      lineCap="round"
                    />
                    {hatch ? (
                      <Line
                        points={pts}
                        stroke={hatch}
                        strokeWidth={Math.max(1.5, thickPx * 0.45)}
                        dash={[5, 4]}
                        lineCap="butt"
                      />
                    ) : null}
                  </Group>
                )
              })}
              {openingIcons.map((o) => (
                <PlanWallOpeningIcon
                  key={o.key}
                  kind={o.kind}
                  x={FLOOR_PADDING_PX + o.x * PPM}
                  y={FLOOR_PADDING_PX + o.y * PPM}
                  alongDeg={o.deg}
                  widthPx={o.w * PPM}
                />
              ))}
            </Layer>
            <Layer>
              {furniture.map((item) => {
                const spec = furnitureSpec(item.kind)
                const selected = item.id === selectionFurnitureId
                const wPx = item.widthM * PPM
                const dPx = item.depthM * PPM
                const cx = FLOOR_PADDING_PX + item.x * PPM
                const cy = FLOOR_PADDING_PX + item.y * PPM
                const label = furnitureDisplayLabel(item)
                return (
                  <Group
                    key={item.id}
                    x={cx}
                    y={cy}
                    draggable
                    onMouseDown={(e: Konva.KonvaEventObject<MouseEvent>) => {
                      e.cancelBubble = true
                      e.target.getStage()?.container().focus()
                      setSelectionFurnitureId(item.id)
                    }}
                    onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
                      e.cancelBubble = true
                      duplicateFurnitureItem(item.id)
                    }}
                    onDragStart={() => setSelectionFurnitureId(item.id)}
                    onDragEnd={(e: Konva.KonvaEventObject<DragEvent>) => {
                      const node = e.target
                      const rawX = (node.x() - FLOOR_PADDING_PX) / PPM
                      const rawY = (node.y() - FLOOR_PADDING_PX) / PPM
                      const snapped = snapMeters(
                        { x: rawX, y: rawY },
                        editorSettings.snapGridM,
                      )
                      moveFurnitureItem(item.id, snapped.x, snapped.y)
                      /* The store clamps to the sheet, so re-read the committed position. */
                      queueMicrotask(() => {
                        const st = useProjectStore.getState()
                        const fl =
                          st.project.floors.find((f) => f.id === st.activeFloorId) ??
                          st.project.floors[0]
                        const cur = fl?.plan.furniture.find((f) => f.id === item.id)
                        if (!cur) return
                        node.position({
                          x: FLOOR_PADDING_PX + cur.x * PPM,
                          y: FLOOR_PADDING_PX + cur.y * PPM,
                        })
                        node.getLayer()?.batchDraw()
                      })
                    }}
                  >
                    <Group rotation={item.rotationDeg}>
                      <FurnitureGlyphShape
                        glyph={spec.glyph}
                        widthPx={wPx}
                        depthPx={dPx}
                        fill={spec.fill}
                        stroke={selected ? '#ffffff' : spec.stroke}
                        strokeWidth={selected ? 2.5 : 1.5}
                      />
                    </Group>
                    <Text
                      x={-Math.max(wPx, 70) / 2}
                      y={-6}
                      width={Math.max(wPx, 70)}
                      height={12}
                      align="center"
                      verticalAlign="middle"
                      text={label}
                      fontSize={10}
                      fill="#e2e8f0"
                      fontFamily="system-ui, sans-serif"
                      listening={false}
                    />
                  </Group>
                )
              })}
            </Layer>
          </Stage>
        </div>
        {furniture.length === 0 ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            No furniture on this floor yet — drag an item from the palette on the right.
          </p>
        ) : null}
      </div>
    )
  },
)
