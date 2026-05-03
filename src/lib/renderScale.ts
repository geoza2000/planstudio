/** Pixels per meter for plan and elevation canvases */
export const PPM = 80

export const FLOOR_PADDING_PX = 40

export function floorStageSize(widthM: number, depthM: number) {
  const w = widthM * PPM + FLOOR_PADDING_PX * 2
  const h = depthM * PPM + FLOOR_PADDING_PX * 2
  return { width: w, height: h }
}

export function wallStageSize(lengthM: number, heightM: number) {
  const margin = 48
  const w = lengthM * PPM + margin * 2
  const h = heightM * PPM + margin * 2
  return { width: w, height: h }
}
