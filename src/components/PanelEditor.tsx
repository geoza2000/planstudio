import { forwardRef, useCallback, useRef, type DragEventHandler } from 'react'
import type { Stage as KonvaStage } from 'konva/lib/Stage'
import { Group, Layer, Rect, Stage, Text } from 'react-konva'
import { DIN_SCALE_TOOLTIP, MM_PER_DIN_ROW, MM_PER_TE } from '../lib/dinScale'
import {
  clientToPanelDinCell,
  PANEL_HEADER,
  PANEL_PAD,
  PANEL_PX_PER_MM,
  PANEL_GRID_GAP,
  panelStageSize,
} from '../lib/panelGridLayout'
import { anchorSlotForCell, slotPixelBounds } from '../lib/panelSpans'
import { useProjectStore } from '../store/projectStore'
import type { PanelModuleType } from '../types/project'

const MODULE_CYCLE: PanelModuleType[] = [
  'blank',
  'mcb',
  'rcd',
  'surge',
  'spare',
]

const LABELS: Record<PanelModuleType, string> = {
  blank: '—',
  mcb: 'MCB',
  rcd: 'RCD',
  surge: 'SPD',
  spare: '···',
}

const DND = 'application/x-planstudio-panel-palette'

type PanelEditorProps = {
  className?: string
}

export const PanelEditor = forwardRef<KonvaStage, PanelEditorProps>(
  function PanelEditor({ className }, ref) {
    const panel = useProjectStore((s) => s.project.panel)
    const setPanelSlot = useProjectStore((s) => s.setPanelSlot)
    const setSelectedPanelSlot = useProjectStore((s) => s.setSelectedPanelSlot)
    const placeFromPanelPalette = useProjectStore((s) => s.placeFromPanelPalette)
    const dropRef = useRef<HTMLDivElement | null>(null)

    const { width, height } = panelStageSize(panel.widthTe, panel.rows)

    const slotAt = useCallback(
      (row: number, col: number) =>
        panel.slots.find((s) => s.row === row && s.col === col),
      [panel.slots],
    )

    const cycleType = (row: number, col: number) => {
      const raw = slotAt(row, col)
      if (!raw) return
      const anchor = anchorSlotForCell(panel.slots, row, col)
      if (!anchor) return
      setSelectedPanelSlot(anchor.row, anchor.col)
      const idx = MODULE_CYCLE.indexOf(anchor.moduleType)
      const next = MODULE_CYCLE[(idx + 1) % MODULE_CYCLE.length]
      setPanelSlot(anchor.row, anchor.col, { moduleType: next })
    }

    const onDragOver: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }

    const onDrop: DragEventHandler<HTMLDivElement> = (e) => {
      e.preventDefault()
      const el = dropRef.current
      if (!el) return
      const id = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData(DND)
      if (!id) return
      const pos = clientToPanelDinCell(
        e.clientX,
        e.clientY,
        el,
        panel.widthTe,
        panel.rows,
      )
      if (!pos) return
      placeFromPanelPalette(id, pos.row, pos.col)
    }

    const railMm = panel.widthTe * MM_PER_TE

    return (
      <div
        ref={dropRef}
        className={`editor-panel ${className ?? ''}`}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="editor-hint">
          <span>
            DIN true-scale · {panel.widthTe} TE × {panel.rows} rows (
            {(railMm / 10).toFixed(1)} cm rail) —{' '}
            <abbr title={DIN_SCALE_TOOLTIP}>17.5 mm/TE</abbr>
            {' — '}
            <span>
              Wider units cannot overlap any cell already used by another module. Drag a palette
              item here to place (or click cells to cycle type for 1+ TE free blanks only).
            </span>
          </span>
        </div>
        <Stage ref={ref} width={width} height={height}>
          <Layer>
            <Rect width={width} height={height} fill="#0f1419" />
            <Text
              x={PANEL_PAD}
              y={10}
              text={`DIN enclosure · ${panel.widthTe} TE × ${panel.rows} row${
                panel.rows === 1 ? '' : 's'
              }`}
              fill="#98a7b8"
              fontSize={14}
              fontFamily="system-ui, sans-serif"
            />
            {panel.slots.map((slot) => {
              if (slot.spanAnchorId) return null
              const { row: r, col: c } = slot
              const span = Math.max(1, slot.spanWidthTe ?? 1)
              const { x, y, width: rw, height: rh } = slotPixelBounds({
                row: r,
                col: c,
                spanWidthTe: span,
                cellW: MM_PER_TE * PANEL_PX_PER_MM,
                cellH: MM_PER_DIN_ROW * PANEL_PX_PER_MM,
                gap: PANEL_GRID_GAP,
                pad: PANEL_PAD,
                header: PANEL_HEADER,
              })
              const fill =
                slot.moduleType === 'blank'
                  ? '#1c2430'
                  : slot.moduleType === 'mcb'
                    ? '#2d6cdf'
                    : slot.moduleType === 'rcd'
                      ? '#e67e22'
                      : slot.moduleType === 'surge'
                        ? '#9b59b6'
                        : '#34495e'
              return (
                <Group key={slot.id}>
                  <Rect
                    x={x}
                    y={y}
                    width={rw}
                    height={rh}
                    fill={fill}
                    stroke="#5c6b7a"
                    cornerRadius={4}
                    onMouseDown={() => cycleType(r, c)}
                  />
                  <Text
                    x={x}
                    y={y + 6}
                    width={rw}
                    text={LABELS[slot.moduleType]}
                    align="center"
                    fill="#e8eef4"
                    fontSize={11}
                    fontFamily="system-ui, sans-serif"
                  />
                  {slot.label ? (
                    <Text
                      x={x}
                      y={y + rh - 14}
                      width={rw}
                      text={slot.label}
                      align="center"
                      fill="#cfd8e3"
                      fontSize={9}
                      fontFamily="system-ui, sans-serif"
                    />
                  ) : null}
                </Group>
              )
            })}
          </Layer>
        </Stage>
      </div>
    )
  },
)
