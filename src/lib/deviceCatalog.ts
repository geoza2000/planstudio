import {
  deviceTypeRollupLabel,
  type DeviceTemplate,
  type DeviceTemplateMounting,
  type FloorDevice,
  type PlanstudioProject,
  type WallMountDevice,
} from '../types/project'

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

/** Drag/drop and catalog rows: user-facing title line (display name first). */
export function templateListDisplayTitle(t: DeviceTemplate): string {
  const d = t.displayName?.trim() ?? ''
  if (d.length > 0) return d
  const p = t.productName?.trim() ?? ''
  if (p.length > 0) return p
  return deviceTypeRollupLabel(t.type, t.connectorSubtype)
}

/** Second line: BOM product name only when non-empty and not already the title. */
export function templateListBomSubtitle(t: DeviceTemplate): string | undefined {
  const p = t.productName?.trim() ?? ''
  if (!p) return undefined
  const title = templateListDisplayTitle(t)
  if (p === title) return undefined
  return p
}

/** Third line of template palette rows: raw type, optional subtype, mounting, unit price. */
export function templateListMetaLine(
  t: Pick<DeviceTemplate, 'type' | 'connectorSubtype' | 'mounting' | 'unitPrice'>,
): string {
  const sub =
    t.type === 'connector' && t.connectorSubtype ? ` · ${t.connectorSubtype}` : ''
  return `${t.type}${sub} · ${t.mounting} · €${Number(t.unitPrice).toFixed(2)}`
}

/**
 * PDF / docs: same two-line idea as the device template list — display title, then BOM when
 * distinct. Uses the linked catalog row when present; otherwise instance fields only.
 */
export function pdfDeviceProductLines(
  p: PlanstudioProject,
  d: FloorDevice | WallMountDevice,
): { title: string; bom?: string } {
  const cat = p.deviceCatalog ?? []
  const t = d.templateId ? templateById(cat, d.templateId) : undefined
  if (!t) {
    const mounting: DeviceTemplateMounting = 'xM' in d ? 'wall' : (d as FloorDevice).mounting === 'wall' ? 'wall' : 'ceiling'
    const virtual = {
      id: '',
      displayName: '',
      productName: d.productName,
      type: d.type,
      connectorSubtype: d.connectorSubtype,
      mounting,
      unitPrice: d.unitPrice,
      billCategory: d.billCategory,
    } as DeviceTemplate
    return {
      title: templateListDisplayTitle(virtual),
      bom: templateListBomSubtitle(virtual),
    }
  }
  const title = templateListDisplayTitle(t)
  const inst = d.productName?.trim() ?? ''
  const tmplBom = t.productName?.trim() ?? ''
  const bomRaw = inst || tmplBom
  const second = bomRaw && bomRaw !== title ? bomRaw : undefined
  return { title, bom: second }
}

export function pdfDeviceProductCell(p: PlanstudioProject, d: FloorDevice | WallMountDevice): string {
  const { title, bom } = pdfDeviceProductLines(p, d)
  return bom ? `${title}\n${bom}` : title
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
