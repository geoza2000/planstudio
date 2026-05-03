import type { Node as KonvaNode } from 'konva/lib/Node'

/** Screen (fixed) position for an HTML overlay just below a Konva node's origin (stage px → CSS px). */
export function getKonvaGroupScreenAnchorBelow(
  grp: KonvaNode,
  offsetY = 14,
): { left: number; top: number } | null {
  const stage = grp.getStage()
  if (!stage) return null
  const abs = grp.getAbsolutePosition()
  const cr = stage.container().getBoundingClientRect()
  const sx = cr.width / stage.width()
  const sy = cr.height / stage.height()
  return {
    left: cr.left + abs.x * sx,
    top: cr.top + abs.y * sy + offsetY * sy,
  }
}
