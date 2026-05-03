import { Arc, Group, Line, Rect } from 'react-konva'

type PlanWallOpeningIconProps = {
  kind: 'door' | 'window'
  x: number
  y: number
  /** Degrees: wall direction a→b (elevation +X in plan). */
  alongDeg: number
}

/**
 * Small symbolic door/window marks for the plan (not to scale; distinct silhouettes).
 */
export function PlanWallOpeningIcon({ kind, x, y, alongDeg }: PlanWallOpeningIconProps) {
  if (kind === 'door') {
    return (
      <Group x={x} y={y} rotation={alongDeg} listening={false}>
        <Line
          points={[-11, 0, 11, 0]}
          stroke="#c4a574"
          strokeWidth={3}
          lineCap="round"
        />
        <Arc
          x={-11}
          y={0}
          innerRadius={0}
          outerRadius={12}
          angle={90}
          fill="rgba(196,165,116,0.2)"
          stroke="#c4a574"
          strokeWidth={1}
        />
      </Group>
    )
  }
  return (
    <Group x={x} y={y} rotation={alongDeg} listening={false}>
      <Rect
        x={-9}
        y={-6}
        width={18}
        height={12}
        fill="rgba(125,211,252,0.12)"
        stroke="#7dd3fc"
        strokeWidth={1.5}
        cornerRadius={1}
      />
      <Line points={[-6, 0, 6, 0]} stroke="#7dd3fc" strokeWidth={1} />
      <Line points={[0, -4, 0, 4]} stroke="#7dd3fc" strokeWidth={1} />
    </Group>
  )
}
