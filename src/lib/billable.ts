import type { BillableProduct, DeviceType, PanelModuleType } from '../types/project'

export const DEFAULT_UNIT_PRICE = 0
export const DEFAULT_BILL_CATEGORY = 'standard' as const

export function defaultBillableFields(over: Partial<BillableProduct> = {}): BillableProduct {
  return {
    productName: over.productName ?? '',
    unitPrice: over.unitPrice ?? DEFAULT_UNIT_PRICE,
    billCategory: DEFAULT_BILL_CATEGORY,
  }
}

export function defaultDeviceProductName(label: string, type: DeviceType | string): string {
  const t = label.trim()
  return t || String(type)
}

export function defaultPanelProductName(
  row: number,
  col: number,
  moduleType: PanelModuleType,
  label: string,
): string {
  const t = label.trim()
  if (t) return t
  return `${moduleType.toUpperCase()} R${row + 1}C${col + 1}`
}

export function forBillable(p: Pick<BillableProduct, 'unitPrice'>): { lineTotal: number } {
  return { lineTotal: p.unitPrice }
}
