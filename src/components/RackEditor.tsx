import Konva from 'konva'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { MutableRefObject } from 'react'
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import {
  gearYTopFromStartRu,
  startRuFromYTop,
} from '../lib/rackLayout'
import { normalizeRackPortCount } from '../lib/rackPortLinks'
import { useProjectStore } from '../store/projectStore'
import type {
  FloorDevice,
  FloorLevel,
  RackGear,
  RackPortEndpoint,
  RackPortKind,
  RackPortLink,
  WallMountDevice,
} from '../types/project'
import { deviceHoverLabel } from '../types/project'

/** Pixel height per rack unit (~4.6× legacy 26px; keeps ports legible and easy to hit.) */
const RU_PX = 120
const RAIL_W = 96
const PAD = 40
const LABEL_W = 420
/** Right margin for patch “bus” + device labels (plan/wall devices are not drawn on the elevation). */
const BUS_LANE_W = 176

/** Truncated title + meta overlay band inside the nominal RU rect (ports start below). */
const GEAR_TITLE_OVERLAY_H = 40
const FACE_BOTTOM_PAD = 6
const RJ45_VIS_RADIUS = 11
const SFP_VIS_HALF = 12
/**
 * Drag from port A to B only commits a new `portLinks` wire if pointer moved at least this many
 * stage pixels from the mousedown anchor; smaller movement is a “click”. Click release on the
 * same port that already terminates a link removes that link (see port `onMouseUp`); short drags
 * to another port cancel without adding a link, so this does not fight drag-to-create.
 */
const WIRE_CLICK_VS_DRAG_THRESHOLD_PX = 6
/** Default invisible hit disc radius when density allows (Konva `Circle`). */
const PORT_HIT_RADIUS_DEFAULT = 17
/** Hard floor so ports stay tappable in extreme density (may overlap). */
const PORT_HIT_RADIUS_ABS_MIN = 8

/** Keystone faceplate tones (read as hardware, not “status green”). */
const RJ45_HOUSING_FILL = '#1f2a38'
const RJ45_HOUSING_STROKE = '#3d5166'
const RJ45_CAVITY_FILL = '#0f1419'
const RJ45_SLOT_STROKE = '#2a3a4d'
const RJ45_CONTACT_GOLD = '#c9a227'
const RJ45_LATCH_FILL = '#2d3d50'
const SFP_PORT_FILL = '#4a3a18'
const SFP_PORT_STROKE = '#f0a030'
const LINK_RJ45_STROKE = '#4ecf9a'
const LINK_SFP_STROKE = '#f5a524'

function gearBlockHeightPx(heightRU: number): number {
  return Math.max(1, Math.floor(Number(heightRU)) || 1) * RU_PX
}

/** One horizontal row if n ≤ 24, else two rows (ceil(n/2) top row). */
function portRowCountForKind(n: number): number {
  if (n <= 0) return 0
  return n <= 24 ? 1 : 2
}

function portsInKindRow(n: number, rowIdx: number): number {
  if (n <= 0) return 0
  if (n <= 24) return rowIdx === 0 ? n : 0
  const topRow = Math.ceil(n / 2)
  return rowIdx === 0 ? topRow : n - topRow
}

function maxPortsInAnyKindRow(n: number): number {
  if (n <= 0) return 0
  if (n <= 24) return n
  return Math.ceil(n / 2)
}

/** Largest radius so m discs fit in [xL,xR] without center overlap (equal spacing). */
function horizontalNonOverlapRadius(m: number, xL: number, xR: number): number {
  const W = Math.max(0, xR - xL)
  if (m <= 0) return PORT_HIT_RADIUS_DEFAULT
  if (m === 1) return Math.min(PORT_HIT_RADIUS_DEFAULT, W / 2)
  return W / (2 * m)
}

/** Inner face [10, labelW-10]: RJ45 4/5, gutter, SFP 1/5 (centers use column bounds). */
function columnXBounds(labelW: number): {
  rj: { xL: number; xR: number }
  sfp: { xL: number; xR: number }
} {
  const innerL = 10
  const innerR = labelW - 10
  const W = Math.max(0, innerR - innerL)
  const gutter = 6
  const usable = Math.max(0, W - gutter)
  const rjW = usable * (4 / 5)
  const sfpW = usable * (1 / 5)
  return {
    rj: { xL: innerL, xR: innerL + rjW },
    sfp: { xL: innerL + rjW + gutter, xR: innerL + rjW + gutter + sfpW },
  }
}

function centersAlongRow(m: number, xL: number, xR: number, r: number): number[] {
  if (m <= 0) return []
  const innerL = xL + r
  const innerR = xR - r
  if (m === 1) return [(innerL + innerR) / 2]
  const span = Math.max(0, innerR - innerL)
  const step = span / (m - 1)
  return Array.from({ length: m }, (_, i) => innerL + i * step)
}

/** SFP column always uses two rows when n ≥ 1 (top-heavy: ceil(n/2) on first row), centered per row. */
function layoutSfpPortsTwoRows(
  n: number,
  col: { xL: number; xR: number },
  hitRadius: number,
  yRow0: number,
  yRow1: number,
): { x: number; y: number }[] {
  if (n <= 0) return []
  const topCount = Math.ceil(n / 2)
  const bottomCount = n - topCount
  const xsTop = centersAlongRow(topCount, col.xL, col.xR, hitRadius)
  const xsBot = centersAlongRow(bottomCount, col.xL, col.xR, hitRadius)
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < topCount; i++) out.push({ x: xsTop[i]!, y: yRow0 })
  for (let i = 0; i < bottomCount; i++) out.push({ x: xsBot[i]!, y: yRow1 })
  return out
}

function rackPortEndpointsEqual(a: RackPortEndpoint, b: RackPortEndpoint): boolean {
  return (
    a.gearId === b.gearId && a.portKind === b.portKind && a.portIndex === b.portIndex
  )
}

function portLinkIdsTouchingEndpoint(links: RackPortLink[], ep: RackPortEndpoint): string[] {
  return links
    .filter((l) => rackPortEndpointsEqual(l.from, ep) || rackPortEndpointsEqual(l.to, ep))
    .map((l) => l.id)
}

function clientXYFromKonvaEvt(
  ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
): { x: number; y: number } | null {
  const e = ev.evt
  if ('changedTouches' in e && e.changedTouches?.length) {
    const t = e.changedTouches[0]!
    return { x: t.clientX, y: t.clientY }
  }
  if ('clientX' in e && typeof (e as MouseEvent).clientX === 'number') {
    const me = e as MouseEvent
    return { x: me.clientX, y: me.clientY }
  }
  return null
}

type GearPortLayout = {
  blockH: number
  hitRadius: number
  rj45VisRadius: number
  sfpVisHalf: number
  rj45: { x: number; y: number }[]
  sfp: { x: number; y: number }[]
}

function geoHitRadius(labelW: number, blockH: number, rj: number, sfp: number): number {
  const faceTop = GEAR_TITLE_OVERLAY_H
  const faceBot = blockH - FACE_BOTTOM_PAD
  const faceH = Math.max(1, faceBot - faceTop)
  const cols = columnXBounds(labelW)
  const mRj = maxPortsInAnyKindRow(rj)
  const mSfp = sfp > 0 ? Math.ceil(sfp / 2) : 0
  let cap = PORT_HIT_RADIUS_DEFAULT
  if (mRj > 0) {
    cap = Math.min(cap, horizontalNonOverlapRadius(mRj, cols.rj.xL, cols.rj.xR))
  }
  if (mSfp > 0) {
    cap = Math.min(cap, horizontalNonOverlapRadius(mSfp, cols.sfp.xL, cols.sfp.xR))
  }
  const twoRj = portRowCountForKind(rj) >= 2
  const twoSfp = sfp > 0
  if (twoRj || twoSfp) {
    const ySep = faceH * 0.52
    const vertCap = (ySep - 6 - 10) / 2
    cap = Math.min(cap, vertCap)
  }
  return cap
}

function computeGearPortLayout(g: RackGear, labelW: number): GearPortLayout {
  const hRU = Math.max(1, Math.floor(Number(g.heightRU)) || 1)
  const blockH = gearBlockHeightPx(hRU)
  const rj = normalizeRackPortCount(g.rj45PortCount)
  const sfp = normalizeRackPortCount(g.sfpPortCount)
  const rawR = geoHitRadius(labelW, blockH, rj, sfp)
  const hitRadius = Math.min(
    PORT_HIT_RADIUS_DEFAULT,
    Math.max(PORT_HIT_RADIUS_ABS_MIN, rawR),
  )
  const visScale = Math.min(1, hitRadius / PORT_HIT_RADIUS_DEFAULT)
  const rj45VisRadius = Math.max(4.5, RJ45_VIS_RADIUS * visScale)
  const sfpVisHalf = Math.max(5, SFP_VIS_HALF * visScale)

  const faceTop = GEAR_TITLE_OVERLAY_H
  const faceBot = blockH - FACE_BOTTOM_PAD
  const faceH = Math.max(1, faceBot - faceTop)
  const midY = faceTop + faceH / 2
  const yRow0 = faceTop + faceH * 0.24
  const yRow1 = faceTop + faceH * 0.76
  const cols = columnXBounds(labelW)

  const build = (
    n: number,
    col: { xL: number; xR: number },
  ): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    if (n <= 0) return out
    const rows = portRowCountForKind(n)
    if (rows === 1) {
      const xs = centersAlongRow(n, col.xL, col.xR, hitRadius)
      for (let i = 0; i < n; i++) out.push({ x: xs[i]!, y: midY })
      return out
    }
    const m0 = portsInKindRow(n, 0)
    const m1 = portsInKindRow(n, 1)
    const xs0 = centersAlongRow(m0, col.xL, col.xR, hitRadius)
    const xs1 = centersAlongRow(m1, col.xL, col.xR, hitRadius)
    for (let i = 0; i < m0; i++) out.push({ x: xs0[i]!, y: yRow0 })
    for (let i = 0; i < m1; i++) out.push({ x: xs1[i]!, y: yRow1 })
    return out
  }

  return {
    blockH,
    hitRadius,
    rj45VisRadius,
    sfpVisHalf,
    rj45: build(rj, cols.rj),
    sfp: layoutSfpPortsTwoRows(sfp, cols.sfp, hitRadius, yRow0, yRow1),
  }
}

function portCenterFromLayout(
  layout: GearPortLayout,
  kind: RackPortKind,
  index: number,
): { x: number; y: number } {
  const arr = kind === 'rj45' ? layout.rj45 : layout.sfp
  return arr[index] ?? { x: LABEL_W / 2, y: layout.blockH / 2 }
}

function findPlanOrWallDevice(
  floors: FloorLevel[],
  deviceId: string,
): FloorDevice | WallMountDevice | null {
  for (const fl of floors) {
    const fd = fl.plan.devices.find((d) => d.id === deviceId)
    if (fd) return fd
    for (const w of fl.wallSheets) {
      const wd = w.devices.find((d) => d.id === deviceId)
      if (wd) return wd
    }
  }
  return null
}

/**
 * Patch cable visualization (simplified):
 * Drops are not laid out in 2D on the rack canvas. For each `rack.patchPanelLinks` row with a
 * non-empty `patchLabel`, we draw an orthogonal polyline from a single “patch anchor” (first
 * `RackGear` whose `productName` matches /patch/i, else the first gear row as a fallback) to a
 * vertical bus in the right margin, then label the linked plan/wall device. Port order and
 * multiple patch panels are not modeled geometrically — all links share one anchor height.
 */
function firstPatchAnchorGear(gear: RackGear[]): RackGear | null {
  const named = gear.find((g) => /patch/i.test(g.productName))
  if (named) return named
  return gear[0] ?? null
}

type RackEditorProps = {
  className?: string
}

type PatchCableLabel = { x: number; y: number; text: string }

type WireDragState = {
  from: RackPortEndpoint
  ax: number
  ay: number
  bx: number
  by: number
}

export const RackEditor = forwardRef<KonvaStage, RackEditorProps>(
  function RackEditor({ className }, ref) {
    const rack = useProjectStore((s) => s.project.rack)
    const floors = useProjectStore((s) => s.project.floors)
    const rackGearPalette = useProjectStore((s) => s.project.rackGearPalette)
    const selectedRackGearId = useProjectStore((s) => s.selectedRackGearId)
    const setSelectedRackGearId = useProjectStore((s) => s.setSelectedRackGearId)
    const updateRackGear = useProjectStore((s) => s.updateRackGear)
    const addRackGearFromPalette = useProjectStore((s) => s.addRackGearFromPalette)
    const addRackPortLink = useProjectStore((s) => s.addRackPortLink)
    const removeRackPortLink = useProjectStore((s) => s.removeRackPortLink)

    const [catalogSelect, setCatalogSelect] = useState('')
    const [wireDrag, setWireDrag] = useState<WireDragState | null>(null)
    const wireDragRef = useRef<WireDragState | null>(null)
    const stageNodeRef = useRef<KonvaStage | null>(null)

    const setStageRef = useCallback(
      (node: KonvaStage | null) => {
        stageNodeRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ;(ref as MutableRefObject<KonvaStage | null>).current = node
        }
      },
      [ref],
    )

    const clientToStagePos = useCallback((clientX: number, clientY: number) => {
      const st = stageNodeRef.current
      if (!st) return null
      const rect = st.container().getBoundingClientRect()
      const sx = st.scaleX() || 1
      const sy = st.scaleY() || 1
      return { x: (clientX - rect.left) / sx, y: (clientY - rect.top) / sy }
    }, [])

    const { width, height, railX, topY, bottomY, gearX, busStemX, busJogX, cabinetRect } = useMemo(
      () => {
        const w = PAD * 2 + RAIL_W + LABEL_W + 24 + BUS_LANE_W
        const h = PAD * 2 + rack.totalRU * RU_PX + 36
        const rx = PAD + 40
        const ty = PAD + 32
        const by = ty + rack.totalRU * RU_PX
        const gx = rx + RAIL_W + 20
        const stem = w - PAD - 22
        const jog = stem - 48
        const cabX = rx - 10
        const cabY = ty - 12
        const cabW = gx + LABEL_W + 14 - cabX
        const cabH = by - cabY + 14
        return {
          width: w,
          height: h,
          railX: rx,
          topY: ty,
          bottomY: by,
          gearX: gx,
          busStemX: stem,
          busJogX: jog,
          cabinetRect: { x: cabX, y: cabY, w: cabW, h: cabH },
        }
      },
      [rack.totalRU],
    )

    const portLinkSegments = useMemo(() => {
      return rack.portLinks.map((link) => {
        const ga = rack.gear.find((g) => g.id === link.from.gearId)
        const gb = rack.gear.find((g) => g.id === link.to.gearId)
        if (!ga || !gb) return null
        const ya = gearYTopFromStartRu(bottomY, RU_PX, ga.startRU, ga.heightRU)
        const yb = gearYTopFromStartRu(bottomY, RU_PX, gb.startRU, gb.heightRU)
        const la = computeGearPortLayout(ga, LABEL_W)
        const lb = computeGearPortLayout(gb, LABEL_W)
        const pa = portCenterFromLayout(la, link.from.portKind, link.from.portIndex)
        const pb = portCenterFromLayout(lb, link.to.portKind, link.to.portIndex)
        const x1 = gearX + pa.x
        const y1 = ya + pa.y
        const x2 = gearX + pb.x
        const y2 = yb + pb.y
        const midX = (x1 + x2) / 2
        const points = [x1, y1, midX, y1, midX, y2, x2, y2]
        return {
          id: link.id,
          points,
          portKind: link.from.portKind,
        }
      })
    }, [rack.portLinks, rack.gear, bottomY, gearX])

    const cableGraphics = useMemo((): {
      lines: number[][]
      labels: PatchCableLabel[]
    } => {
      const links = rack.patchPanelLinks.filter((l) => l.patchLabel.trim().length > 0)
      if (links.length === 0) return { lines: [], labels: [] }
      const anchor = firstPatchAnchorGear(rack.gear)
      if (!anchor) return { lines: [], labels: [] }

      const yTop = gearYTopFromStartRu(bottomY, RU_PX, anchor.startRU, anchor.heightRU)
      const hPx = gearBlockHeightPx(anchor.heightRU)
      const yMid = yTop + hPx / 2
      const xPatchRight = gearX + LABEL_W

      const lineH = 20
      const y0 = topY + 28
      const labels: PatchCableLabel[] = []
      const lines: number[][] = []

      links.forEach((link, i) => {
        const dev = findPlanOrWallDevice(floors, link.deviceId)
        const devLabel = dev
          ? deviceHoverLabel(dev)
          : `Missing device ${link.deviceId.slice(0, 6)}…`
        const text = `${devLabel} — ${link.patchLabel.trim()}`
        const yBus = Math.min(bottomY - 8, y0 + i * lineH)

        lines.push([
          xPatchRight,
          yMid,
          busJogX,
          yMid,
          busJogX,
          yBus,
          busStemX,
          yBus,
        ])
        labels.push({ x: busStemX + 6, y: yBus - 7, text })
      })

      const ys = links.map((_, i) => Math.min(bottomY - 8, y0 + i * lineH))
      const yMin = Math.min(yMid, ...ys) - 6
      const yMax = Math.max(yMid, ...ys) + 10
      lines.unshift([busStemX, yMin, busStemX, yMax])

      return { lines, labels }
    }, [
      rack.patchPanelLinks,
      rack.gear,
      floors,
      bottomY,
      topY,
      gearX,
      busStemX,
      busJogX,
    ])

    const beginPortWireDrag = useCallback(
      (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>, from: RackPortEndpoint) => {
        const t = e.target.getAbsoluteTransform()
        const p = t.point({ x: 0, y: 0 })
        const next = { from, ax: p.x, ay: p.y, bx: p.x, by: p.y }
        wireDragRef.current = next
        setWireDrag(next)
        e.cancelBubble = true
      },
      [],
    )

    const cancelWire = useCallback(() => {
      wireDragRef.current = null
      setWireDrag(null)
    }, [])

    useLayoutEffect(() => {
      if (!wireDrag) return
      const onMove = (ev: MouseEvent) => {
        const pos = clientToStagePos(ev.clientX, ev.clientY)
        if (!pos) return
        const w = wireDragRef.current
        if (!w) return
        const next = { ...w, bx: pos.x, by: pos.y }
        wireDragRef.current = next
        setWireDrag(next)
      }
      const onWinUp = () => {
        if (wireDragRef.current) {
          wireDragRef.current = null
          setWireDrag(null)
        }
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onWinUp)
      return () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onWinUp)
      }
    }, [wireDrag, clientToStagePos])

    const tryCompleteWire = useCallback(
      (to: RackPortEndpoint) => {
        const w = wireDragRef.current
        if (!w) return
        const from = w.from
        const sameKind = from.portKind === to.portKind
        const allowed =
          sameKind && (from.portKind === 'rj45' || from.portKind === 'sfp')
        if (!allowed) {
          cancelWire()
          return
        }
        if (
          from.gearId === to.gearId &&
          from.portKind === to.portKind &&
          from.portIndex === to.portIndex
        ) {
          cancelWire()
          return
        }
        addRackPortLink(from, to)
        cancelWire()
      },
      [addRackPortLink, cancelWire],
    )

    const handlePortMouseUp = useCallback(
      (ev: Konva.KonvaEventObject<MouseEvent | TouchEvent>, ep: RackPortEndpoint) => {
        const w = wireDragRef.current
        if (!w) return
        const client = clientXYFromKonvaEvt(ev)
        const pos = client ? clientToStagePos(client.x, client.y) : null
        const dist =
          pos != null
            ? Math.hypot(pos.x - w.ax, pos.y - w.ay)
            : WIRE_CLICK_VS_DRAG_THRESHOLD_PX + 1

        const samePort = rackPortEndpointsEqual(w.from, ep)

        if (dist < WIRE_CLICK_VS_DRAG_THRESHOLD_PX && samePort) {
          const ids = portLinkIdsTouchingEndpoint(rack.portLinks, ep)
          if (ids.length > 0) {
            for (const id of ids) removeRackPortLink(id)
          }
          cancelWire()
          ev.cancelBubble = true
          return
        }

        if (dist < WIRE_CLICK_VS_DRAG_THRESHOLD_PX && !samePort) {
          cancelWire()
          ev.cancelBubble = true
          return
        }

        tryCompleteWire(ep)
        ev.cancelBubble = true
      },
      [
        rack.portLinks,
        clientToStagePos,
        tryCompleteWire,
        cancelWire,
        removeRackPortLink,
      ],
    )

    return (
      <div className={`editor-rack ${className ?? ''}`}>
        <div className="editor-hint">
          <span>
            Rack elevation — drag gear vertically for RU placement. RJ45 (left) and SFP (right): drag
            from one port to a peer of the same kind to add a link (drag past a few pixels so it is
            not treated as a click). Click release on a port that already has a link removes that
            link. SFP ports always use two rows. Each gear block is exactly its configured U height;
            RJ45 uses one row up to 24 ports, then two rows.
          </span>
        </div>
        <div className="tool-row" style={{ marginBottom: 8 }}>
          <label className="field">
            <span>Add from catalog</span>
            <select
              aria-label="Add rack gear from catalog"
              value={catalogSelect}
              onChange={(e) => {
                const id = e.target.value
                setCatalogSelect('')
                if (id) addRackGearFromPalette(id)
              }}
            >
              <option value="">Choose preset…</option>
              {rackGearPalette.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.productName} ({t.heightRU}U)
                </option>
              ))}
            </select>
          </label>
        </div>
        <Stage ref={setStageRef} width={width} height={height}>
          <Layer>
            <Rect
              listening={false}
              width={width}
              height={height}
              fill="#0f1419"
            />
            <Text
              listening={false}
              x={PAD}
              y={10}
              text={`${rack.widthLabel} · ${rack.totalRU} U`}
              fill="#98a7b8"
              fontSize={14}
              fontFamily="system-ui, sans-serif"
            />
            <Rect
              listening={false}
              x={cabinetRect.x}
              y={cabinetRect.y}
              width={cabinetRect.w}
              height={cabinetRect.h}
              fill="#0a0e14"
              stroke="#3d4d62"
              strokeWidth={2}
              cornerRadius={12}
            />
            <Rect
              listening={false}
              x={cabinetRect.x + 6}
              y={cabinetRect.y + 6}
              width={cabinetRect.w - 12}
              height={cabinetRect.h - 12}
              fill="#0d1218"
              stroke="#1e2a38"
              strokeWidth={1}
              cornerRadius={8}
            />
            <Rect
              listening={false}
              x={railX}
              y={topY}
              width={RAIL_W}
              height={rack.totalRU * RU_PX}
              stroke="#5c6b7a"
              fill="#151b24"
              cornerRadius={4}
            />
            {Array.from({ length: rack.totalRU + 1 }, (_, i) => {
              const y = topY + i * RU_PX
              return (
                <Line
                  listening={false}
                  key={`ru-h-${i}`}
                  points={[railX, y, railX + RAIL_W, y]}
                  stroke="#2a3544"
                  strokeWidth={1}
                />
              )
            })}
            {Array.from({ length: rack.totalRU }, (_, i) => {
              const ru = rack.totalRU - i
              const y = topY + i * RU_PX + RU_PX * 0.14
              return (
                <Text
                  listening={false}
                  key={`ru-l-${ru}`}
                  x={railX - 52}
                  y={y}
                  text={String(ru)}
                  fill="#7a8a9c"
                  fontSize={13}
                  fontFamily="system-ui, sans-serif"
                />
              )
            })}
            <Line
              listening={false}
              points={[railX + RAIL_W + 8, topY, railX + RAIL_W + 8, bottomY]}
              stroke="#3d5a80"
              strokeWidth={2}
            />
            {rack.gear.map((g) => {
              const yTop = gearYTopFromStartRu(bottomY, RU_PX, g.startRU, g.heightRU)
              const rj = normalizeRackPortCount(g.rj45PortCount)
              const sfp = normalizeRackPortCount(g.sfpPortCount)
              const layout = computeGearPortLayout(g, LABEL_W)
              const displayH = layout.blockH
              const hitR = layout.hitRadius
              const rjVisR = layout.rj45VisRadius
              const sfpHalf = layout.sfpVisHalf
              const selected = g.id === selectedRackGearId
              const faceCols = columnXBounds(LABEL_W)
              return (
                <Group
                  key={g.id}
                  x={gearX}
                  y={yTop}
                  draggable={!wireDrag}
                  dragBoundFunc={(pos) => {
                    const nextStart = startRuFromYTop(
                      bottomY,
                      RU_PX,
                      pos.y,
                      g.heightRU,
                      rack.totalRU,
                    )
                    const snappedY = gearYTopFromStartRu(
                      bottomY,
                      RU_PX,
                      nextStart,
                      g.heightRU,
                    )
                    return { x: gearX, y: snappedY }
                  }}
                  onTap={() => setSelectedRackGearId(g.id)}
                  onClick={() => setSelectedRackGearId(g.id)}
                  onDblClick={() => setSelectedRackGearId(g.id)}
                  onDblTap={() => setSelectedRackGearId(g.id)}
                  onDragEnd={(e) => {
                    const node = e.target
                    const startRU = startRuFromYTop(
                      bottomY,
                      RU_PX,
                      node.y(),
                      g.heightRU,
                      rack.totalRU,
                    )
                    updateRackGear(g.id, { startRU })
                    node.position({
                      x: gearX,
                      y: gearYTopFromStartRu(bottomY, RU_PX, startRU, g.heightRU),
                    })
                  }}
                >
                  <Rect
                    width={LABEL_W}
                    height={displayH}
                    fill="#152535"
                    stroke={selected ? '#7ec8ff' : '#3d5a78'}
                    strokeWidth={selected ? 2.5 : 1.25}
                    cornerRadius={8}
                    shadowColor="#000"
                    shadowBlur={selected ? 10 : 4}
                    shadowOpacity={0.35}
                  />
                  <Text
                    x={14}
                    y={6}
                    width={LABEL_W - 28}
                    text={g.productName}
                    fill="#e8eef4"
                    fontSize={displayH <= RU_PX ? 13 : 15}
                    fontFamily="system-ui, sans-serif"
                    ellipsis
                  />
                  <Text
                    x={14}
                    y={displayH <= RU_PX ? 22 : 28}
                    width={LABEL_W - 28}
                    text={`${g.heightRU}U · bottom RU ${g.startRU}`}
                    fill="#98a7b8"
                    fontSize={displayH <= RU_PX ? 10 : 12}
                    fontFamily="system-ui, sans-serif"
                    ellipsis
                  />
                  <Text
                    x={faceCols.rj.xL}
                    y={GEAR_TITLE_OVERLAY_H - 16}
                    width={faceCols.rj.xR - faceCols.rj.xL}
                    align="left"
                    text="RJ45"
                    fill="#7ecf9a"
                    fontSize={11}
                    fontFamily="system-ui, sans-serif"
                  />
                  <Text
                    x={faceCols.sfp.xL}
                    y={GEAR_TITLE_OVERLAY_H - 16}
                    width={faceCols.sfp.xR - faceCols.sfp.xL}
                    align="center"
                    text="SFP"
                    fill="#f0a030"
                    fontSize={11}
                    fontFamily="system-ui, sans-serif"
                  />
                  {Array.from({ length: rj }, (_, i) => {
                    const { x, y } = layout.rj45[i]!
                    const ep: RackPortEndpoint = {
                      gearId: g.id,
                      portKind: 'rj45',
                      portIndex: i,
                    }
                    const jackW = Math.max(22, rjVisR * 2.65)
                    const jackH = Math.max(16, rjVisR * 1.75)
                    const pinCount = 8
                    return (
                      <Group key={`rj-${g.id}-${i}`}>
                        <Group listening={false} x={x} y={y}>
                          {/* Outer housing */}
                          <Rect
                            x={-jackW / 2}
                            y={-jackH / 2}
                            width={jackW}
                            height={jackH}
                            fill={RJ45_HOUSING_FILL}
                            stroke={RJ45_HOUSING_STROKE}
                            strokeWidth={1.25}
                            cornerRadius={3.5}
                          />
                          {/* Inner bezel */}
                          <Rect
                            x={-jackW * 0.44}
                            y={-jackH * 0.4}
                            width={jackW * 0.88}
                            height={jackH * 0.72}
                            fill={RJ45_CAVITY_FILL}
                            stroke={RJ45_SLOT_STROKE}
                            strokeWidth={0.75}
                            cornerRadius={2}
                          />
                          {/* Plug slot (contrast opening) */}
                          <Rect
                            x={-jackW * 0.34}
                            y={-jackH * 0.32}
                            width={jackW * 0.68}
                            height={jackH * 0.38}
                            fill="#0a0e12"
                            stroke={RJ45_SLOT_STROKE}
                            strokeWidth={0.5}
                            cornerRadius={1.5}
                          />
                          {/* Latch tab hint (bottom of jack) */}
                          <Rect
                            x={-jackW * 0.12}
                            y={jackH * 0.22}
                            width={jackW * 0.24}
                            height={jackH * 0.22}
                            fill={RJ45_LATCH_FILL}
                            stroke="#3d4d62"
                            strokeWidth={0.5}
                            cornerRadius={1}
                          />
                          {/* Eight gold contacts, even spacing */}
                          {Array.from({ length: pinCount }, (_, pi) => {
                            const span = jackW * 0.58
                            const pinW = Math.max(1.1, span / (pinCount * 1.85))
                            const gap = (span - pinW * pinCount) / (pinCount + 1)
                            const x0 = -span / 2 + gap
                            return (
                              <Rect
                                key={`rj-pin-${g.id}-${i}-${pi}`}
                                x={x0 + pi * (pinW + gap)}
                                y={-jackH * 0.08}
                                width={pinW}
                                height={jackH * 0.14}
                                fill={RJ45_CONTACT_GOLD}
                                stroke="#8a7018"
                                strokeWidth={0.35}
                                cornerRadius={0.5}
                              />
                            )
                          })}
                        </Group>
                        <Rect
                          x={x - jackW / 2}
                          y={y - jackH / 2}
                          width={jackW}
                          height={jackH}
                          fill="rgba(0,0,0,0.001)"
                          listening
                          perfectDrawEnabled={false}
                          onMouseDown={(ev) => {
                            setSelectedRackGearId(g.id)
                            beginPortWireDrag(ev, ep)
                          }}
                          onMouseUp={(ev) => handlePortMouseUp(ev, ep)}
                        />
                        <Text
                          listening={false}
                          x={x - 10}
                          y={y + jackH / 2 + 4}
                          width={20}
                          align="center"
                          text={String(i + 1)}
                          fill="#6a8a78"
                          fontSize={10}
                          fontFamily="system-ui, sans-serif"
                        />
                      </Group>
                    )
                  })}
                  {Array.from({ length: sfp }, (_, i) => {
                    const { x, y } = layout.sfp[i]!
                    const ep: RackPortEndpoint = {
                      gearId: g.id,
                      portKind: 'sfp',
                      portIndex: i,
                    }
                    return (
                      <Group key={`sfp-${g.id}-${i}`}>
                        <Circle
                          x={x}
                          y={y}
                          radius={hitR}
                          fill="rgba(0,0,0,0.02)"
                          perfectDrawEnabled={false}
                          onMouseDown={(ev) => {
                            setSelectedRackGearId(g.id)
                            beginPortWireDrag(ev, ep)
                          }}
                          onMouseUp={(ev) => handlePortMouseUp(ev, ep)}
                        />
                        <Rect
                          listening={false}
                          x={x - sfpHalf}
                          y={y - sfpHalf}
                          width={sfpHalf * 2}
                          height={sfpHalf * 2}
                          fill={SFP_PORT_FILL}
                          stroke={SFP_PORT_STROKE}
                          strokeWidth={1.5}
                          cornerRadius={3}
                        />
                        <Text
                          listening={false}
                          x={x - 10}
                          y={y + sfpHalf + 4}
                          width={20}
                          align="center"
                          text={String(i + 1)}
                          fill="#b8925a"
                          fontSize={10}
                          fontFamily="system-ui, sans-serif"
                        />
                      </Group>
                    )
                  })}
                </Group>
              )
            })}
            {portLinkSegments.map(
              (seg) =>
                seg && (
                  <Line
                    key={seg.id}
                    listening={false}
                    points={seg.points}
                    stroke={seg.portKind === 'sfp' ? LINK_SFP_STROKE : LINK_RJ45_STROKE}
                    strokeWidth={seg.portKind === 'sfp' ? 1.5 : 2}
                    dash={seg.portKind === 'sfp' ? [6, 4] : undefined}
                    lineCap="round"
                    lineJoin="round"
                    opacity={0.95}
                  />
                ),
            )}
            {cableGraphics.lines.map((pts, idx) => (
              <Line
                listening={false}
                key={`patch-line-${idx}`}
                points={pts}
                stroke={idx === 0 ? '#4a6fa5' : '#6a9bd8'}
                strokeWidth={idx === 0 ? 2 : 1.25}
                lineCap="round"
                lineJoin="round"
                opacity={0.92}
              />
            ))}
            {cableGraphics.labels.map((lb, idx) => (
              <Text
                listening={false}
                key={`patch-lbl-${idx}`}
                x={lb.x}
                y={lb.y}
                width={width - lb.x - PAD}
                text={lb.text}
                fill="#b8c9d9"
                fontSize={11}
                fontFamily="system-ui, sans-serif"
                ellipsis
              />
            ))}
            {wireDrag ? (
              <Line
                listening={false}
                points={[wireDrag.ax, wireDrag.ay, wireDrag.bx, wireDrag.by]}
                stroke={
                  wireDrag.from.portKind === 'sfp' ? LINK_SFP_STROKE : LINK_RJ45_STROKE
                }
                strokeWidth={2}
                dash={wireDrag.from.portKind === 'sfp' ? [7, 5] : [6, 5]}
                opacity={0.9}
                lineCap="round"
              />
            ) : null}
          </Layer>
        </Stage>
      </div>
    )
  },
)
