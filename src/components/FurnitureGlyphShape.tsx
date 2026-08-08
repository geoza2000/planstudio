import { Fragment } from 'react'
import { Ellipse, Line, Rect } from 'react-konva'
import type { FurnitureGlyph } from '../lib/furnitureCatalog'

type FurnitureGlyphShapeProps = {
  glyph: FurnitureGlyph
  /** Footprint in stage pixels, drawn centred on the parent group's origin. */
  widthPx: number
  depthPx: number
  fill: string
  stroke: string
  strokeWidth: number
}

/**
 * Plan symbol drawn inside a furniture footprint, centred on (0, 0) and already rotated
 * by the parent `Group`. All shapes stay within ±width/2, ±depth/2.
 */
export function FurnitureGlyphShape({
  glyph,
  widthPx,
  depthPx,
  fill,
  stroke,
  strokeWidth,
}: FurnitureGlyphShapeProps) {
  const hw = widthPx / 2
  const hd = depthPx / 2

  if (glyph === 'round') {
    return (
      <Ellipse
        radiusX={hw}
        radiusY={hd}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    )
  }

  if (glyph === 'l_shape') {
    /* Chaise return along -X; the notch is cut from the +X / +Y corner. */
    const notchW = widthPx * 0.55
    const notchD = depthPx * 0.5
    return (
      <Line
        closed
        points={[
          -hw,
          -hd,
          hw,
          -hd,
          hw,
          hd - notchD,
          hw - notchW,
          hd - notchD,
          hw - notchW,
          hd,
          -hw,
          hd,
        ]}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineJoin="round"
      />
    )
  }

  if (glyph === 'glass') {
    return (
      <Fragment>
        <Rect
          x={-hw}
          y={-hd}
          width={widthPx}
          height={depthPx}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={[6, 4]}
        />
        <Line points={[-hw, hd, hw, -hd]} stroke={stroke} strokeWidth={strokeWidth} />
      </Fragment>
    )
  }

  const base = (
    <Rect
      x={-hw}
      y={-hd}
      width={widthPx}
      height={depthPx}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      cornerRadius={Math.min(6, Math.min(hw, hd) * 0.3)}
    />
  )

  if (glyph === 'seat') {
    /* Back rail along the -Y edge marks which way the seat faces. */
    const railD = Math.max(3, depthPx * 0.22)
    return (
      <Fragment>
        {base}
        <Rect
          x={-hw}
          y={-hd}
          width={widthPx}
          height={railD}
          fill={stroke}
          opacity={0.45}
          cornerRadius={2}
        />
      </Fragment>
    )
  }

  if (glyph === 'bed') {
    const pillowD = Math.max(4, depthPx * 0.18)
    return (
      <Fragment>
        {base}
        <Rect
          x={-hw + widthPx * 0.08}
          y={-hd + Math.max(2, depthPx * 0.05)}
          width={widthPx * 0.84}
          height={pillowD}
          fill={stroke}
          opacity={0.5}
          cornerRadius={3}
        />
        <Line
          points={[-hw, -hd + pillowD * 1.6, hw, -hd + pillowD * 1.6]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          opacity={0.6}
        />
      </Fragment>
    )
  }

  if (glyph === 'bowl') {
    return (
      <Fragment>
        {base}
        <Ellipse
          radiusX={hw * 0.6}
          radiusY={hd * 0.55}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </Fragment>
    )
  }

  return base
}
