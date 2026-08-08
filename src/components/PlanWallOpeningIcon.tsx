import { Arc, Group, Line, Rect } from 'react-konva'

type PlanWallOpeningIconProps = {
  kind: 'door' | 'window'
  x: number
  y: number
  /** Degrees: wall direction a→b (elevation +X in plan). */
  alongDeg: number
  /** Opening width in stage pixels; the glyph spans this so resizes read on the plan. */
  widthPx?: number
}

/** Keep tiny openings clickable-sized and huge ones from swamping the plan. */
const MIN_ICON_PX = 14
const MAX_ICON_PX = 260

/**
 * Symbolic door/window marks for the plan. The span along the wall follows the real
 * opening width; the depth across the wall stays symbolic.
 */
export function PlanWallOpeningIcon({
  kind,
  x,
  y,
  alongDeg,
  widthPx,
}: PlanWallOpeningIconProps) {
  const span = Math.min(
    MAX_ICON_PX,
    Math.max(MIN_ICON_PX, widthPx ?? (kind === 'door' ? 22 : 18)),
  )
  const half = span / 2

  if (kind === 'door') {
    return (
      <Group x={x} y={y} rotation={alongDeg} listening={false}>
        <Line
          points={[-half, 0, half, 0]}
          stroke="#c4a574"
          strokeWidth={3}
          lineCap="round"
        />
        <Arc
          x={-half}
          y={0}
          innerRadius={0}
          outerRadius={span}
          angle={90}
          fill="rgba(196,165,116,0.2)"
          stroke="#c4a574"
          strokeWidth={1}
        />
      </Group>
    )
  }
  const depth = Math.max(8, Math.min(14, span * 0.35))
  return (
    <Group x={x} y={y} rotation={alongDeg} listening={false}>
      <Rect
        x={-half}
        y={-depth / 2}
        width={span}
        height={depth}
        fill="rgba(125,211,252,0.12)"
        stroke="#7dd3fc"
        strokeWidth={1.5}
        cornerRadius={1}
      />
      <Line points={[-half * 0.7, 0, half * 0.7, 0]} stroke="#7dd3fc" strokeWidth={1} />
      <Line points={[0, -depth / 3, 0, depth / 3]} stroke="#7dd3fc" strokeWidth={1} />
    </Group>
  )
}
