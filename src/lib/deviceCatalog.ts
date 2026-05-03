import { deviceTypeRollupLabel, type DeviceTemplate, type DeviceTemplateMounting, type FloorDevice, type WallMountDevice } from '../types/project'

export const DND_DEVICE_TEMPLATE = 'application/x-planstudio-device-template'

export function templateById(
  catalog: DeviceTemplate[],
  id: string | undefined,
): DeviceTemplate | undefined {
  if (!id) return undefined
  return catalog.find((t) => t.id === id)
}

export function templateAllowsPlanMounting(m: DeviceTemplateMounting): boolean {
  return m === 'ceiling' || m === 'both'
}

export function templateAllowsWallMounting(m: DeviceTemplateMounting): boolean {
  return m === 'wall' || m === 'both'
}

/**
 * Primary line for palette / compact lists: matches {@link deviceHoverLabel} priority on instances
 * (product name first, then display name, then type rollup).
 */
export function templatePalettePrimaryLine(t: DeviceTemplate): string {
  const p = t.productName?.trim() ?? ''
  if (p.length > 0) return p
  const d = t.displayName?.trim() ?? ''
  if (d.length > 0) return d
  return deviceTypeRollupLabel(t.type, t.connectorSubtype)
}

/** When `displayName` differs from the primary line, show it as a subtitle (e.g. range name vs SKU). */
export function templatePaletteSecondaryLine(t: DeviceTemplate): string | undefined {
  const primary = templatePalettePrimaryLine(t)
  const d = t.displayName?.trim() ?? ''
  if (!d || d === primary) return undefined
  return d
}

/** Plan view: ceiling/both templates, wall mirrors, legacy untemplated plan marks (not wall-only). */
export function floorDeviceVisibleOnPlan(
  d: FloorDevice,
  catalog: DeviceTemplate[],
): boolean {
  if (d.linkedWallDeviceId) return true
  if (d.mounting === 'wall') return false
  const t = templateById(catalog, d.templateId)
  if (t) return templateAllowsPlanMounting(t.mounting)
  const m = d.mounting ?? 'ceiling'
  return m === 'ceiling' || m === 'floor'
}

/** Elevation view: wall/both templates, or legacy devices without template. */
export function wallDeviceVisibleOnElevation(
  d: WallMountDevice,
  catalog: DeviceTemplate[],
): boolean {
  const t = templateById(catalog, d.templateId)
  if (t) return templateAllowsWallMounting(t.mounting)
  return true
}

export function filterFloorDevicesForPlanView(
  devices: FloorDevice[],
  catalog: DeviceTemplate[],
): FloorDevice[] {
  return devices.filter((d) => floorDeviceVisibleOnPlan(d, catalog))
}

export function filterWallDevicesForElevationView(
  devices: WallMountDevice[],
  catalog: DeviceTemplate[],
): WallMountDevice[] {
  return devices.filter((d) => wallDeviceVisibleOnElevation(d, catalog))
}
