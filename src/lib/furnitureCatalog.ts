import type { FurnitureCategory, FurnitureItem, FurnitureKind } from '../types/project'

/** DataTransfer type used when dragging a palette row onto the furnish canvas. */
export const DND_FURNITURE_KIND = 'application/x-planstudio-furniture-kind'

/** How the plan glyph is drawn inside the footprint rectangle. */
export type FurnitureGlyph =
  | 'plain'
  /** L-shaped block: the notch is cut out of the +X / +Y corner before rotation. */
  | 'l_shape'
  /** Seat block with a back rail along the -Y edge. */
  | 'seat'
  /** Mattress with a pillow band along the -Y edge. */
  | 'bed'
  /** Rounded footprint (tables, loungers). */
  | 'round'
  /** Glazed enclosure: outline only, with a diagonal. */
  | 'glass'
  /** Sanitary block with a bowl ellipse. */
  | 'bowl'

export type FurnitureSpec = {
  kind: FurnitureKind
  label: string
  category: FurnitureCategory
  widthM: number
  depthM: number
  heightM: number
  glyph: FurnitureGlyph
  fill: string
  stroke: string
  /** Free-text massing hint used verbatim by the 3D render prompt. */
  renderHint: string
}

/**
 * Default footprints in meters (width × depth, before rotation) with a plan colour per
 * category. Sizes are typical residential values — every one is editable per item.
 */
export const FURNITURE_SPECS: FurnitureSpec[] = [
  {
    kind: 'sofa_l',
    label: 'L-shaped sofa',
    category: 'living',
    widthM: 2.8,
    depthM: 2.1,
    heightM: 0.8,
    glyph: 'l_shape',
    fill: 'rgba(129, 140, 248, 0.30)',
    stroke: '#a5b4fc',
    renderHint: 'L-shaped sectional sofa with a chaise return, fabric upholstery',
  },
  {
    kind: 'sofa',
    label: 'Sofa (3-seat)',
    category: 'living',
    widthM: 2.1,
    depthM: 0.9,
    heightM: 0.8,
    glyph: 'seat',
    fill: 'rgba(129, 140, 248, 0.30)',
    stroke: '#a5b4fc',
    renderHint: 'three-seat sofa, fabric upholstery',
  },
  {
    kind: 'armchair',
    label: 'Armchair',
    category: 'living',
    widthM: 0.85,
    depthM: 0.85,
    heightM: 0.8,
    glyph: 'seat',
    fill: 'rgba(129, 140, 248, 0.30)',
    stroke: '#a5b4fc',
    renderHint: 'lounge armchair',
  },
  {
    kind: 'coffee_table',
    label: 'Coffee table',
    category: 'living',
    widthM: 1.1,
    depthM: 0.6,
    heightM: 0.4,
    glyph: 'plain',
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: '#cbd5e1',
    renderHint: 'low coffee table',
  },
  {
    kind: 'tv_table',
    label: 'TV table / media unit',
    category: 'living',
    widthM: 1.8,
    depthM: 0.45,
    heightM: 0.5,
    glyph: 'plain',
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: '#cbd5e1',
    renderHint: 'low media console with a wall-mounted flat screen above it',
  },
  {
    kind: 'dining_table',
    label: 'Dining table',
    category: 'living',
    widthM: 1.8,
    depthM: 0.9,
    heightM: 0.75,
    glyph: 'plain',
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: '#cbd5e1',
    renderHint: 'dining table with chairs around it',
  },
  {
    kind: 'chair',
    label: 'Chair',
    category: 'living',
    widthM: 0.45,
    depthM: 0.45,
    heightM: 0.9,
    glyph: 'plain',
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: '#cbd5e1',
    renderHint: 'dining chair',
  },
  {
    kind: 'bookshelf',
    label: 'Bookshelf',
    category: 'living',
    widthM: 1.2,
    depthM: 0.35,
    heightM: 2,
    glyph: 'plain',
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: '#cbd5e1',
    renderHint: 'tall open bookshelf against the wall',
  },
  {
    kind: 'bed_double',
    label: 'Double bed',
    category: 'bedroom',
    widthM: 1.6,
    depthM: 2,
    heightM: 0.55,
    glyph: 'bed',
    fill: 'rgba(244, 114, 182, 0.24)',
    stroke: '#f9a8d4',
    renderHint: 'double bed with headboard, made with linens and pillows',
  },
  {
    kind: 'bed_single',
    label: 'Single bed',
    category: 'bedroom',
    widthM: 0.9,
    depthM: 2,
    heightM: 0.55,
    glyph: 'bed',
    fill: 'rgba(244, 114, 182, 0.24)',
    stroke: '#f9a8d4',
    renderHint: 'single bed with headboard',
  },
  {
    kind: 'nightstand',
    label: 'Nightstand',
    category: 'bedroom',
    widthM: 0.45,
    depthM: 0.4,
    heightM: 0.55,
    glyph: 'plain',
    fill: 'rgba(244, 114, 182, 0.24)',
    stroke: '#f9a8d4',
    renderHint: 'bedside nightstand with a lamp',
  },
  {
    kind: 'wardrobe',
    label: 'Wardrobe',
    category: 'bedroom',
    widthM: 2,
    depthM: 0.6,
    heightM: 2.4,
    glyph: 'plain',
    fill: 'rgba(244, 114, 182, 0.24)',
    stroke: '#f9a8d4',
    renderHint: 'full-height fitted wardrobe with sliding doors',
  },
  {
    kind: 'desk',
    label: 'Desk',
    category: 'bedroom',
    widthM: 1.4,
    depthM: 0.7,
    heightM: 0.75,
    glyph: 'plain',
    fill: 'rgba(244, 114, 182, 0.24)',
    stroke: '#f9a8d4',
    renderHint: 'work desk with a chair',
  },
  {
    kind: 'kitchen_counter',
    label: 'Kitchen counter run',
    category: 'kitchen',
    widthM: 3,
    depthM: 0.6,
    heightM: 0.9,
    glyph: 'plain',
    fill: 'rgba(251, 191, 36, 0.24)',
    stroke: '#fcd34d',
    renderHint: 'kitchen base-unit run with worktop, sink and hob, wall units above',
  },
  {
    kind: 'kitchen_island',
    label: 'Kitchen island',
    category: 'kitchen',
    widthM: 1.8,
    depthM: 0.9,
    heightM: 0.9,
    glyph: 'plain',
    fill: 'rgba(251, 191, 36, 0.24)',
    stroke: '#fcd34d',
    renderHint: 'free-standing kitchen island with a stone worktop',
  },
  {
    kind: 'fridge',
    label: 'Fridge',
    category: 'kitchen',
    widthM: 0.7,
    depthM: 0.7,
    heightM: 1.9,
    glyph: 'plain',
    fill: 'rgba(251, 191, 36, 0.24)',
    stroke: '#fcd34d',
    renderHint: 'tall fridge-freezer',
  },
  {
    kind: 'shower_glass',
    label: 'Shower (glass)',
    category: 'bathroom',
    widthM: 0.9,
    depthM: 0.9,
    heightM: 2,
    glyph: 'glass',
    fill: 'rgba(56, 189, 248, 0.18)',
    stroke: '#7dd3fc',
    renderHint:
      'walk-in shower enclosed by frameless clear glass panels, tiled tray and rain head',
  },
  {
    kind: 'toilet_inwall',
    label: 'In-wall toilet combo',
    category: 'bathroom',
    widthM: 0.4,
    depthM: 0.6,
    heightM: 0.45,
    glyph: 'bowl',
    fill: 'rgba(56, 189, 248, 0.18)',
    stroke: '#7dd3fc',
    renderHint:
      'wall-hung toilet on a concealed in-wall cistern with a flush plate, floor clear underneath',
  },
  {
    kind: 'sink_combo',
    label: 'Sink + vanity combo',
    category: 'bathroom',
    widthM: 0.9,
    depthM: 0.5,
    heightM: 0.85,
    glyph: 'bowl',
    fill: 'rgba(56, 189, 248, 0.18)',
    stroke: '#7dd3fc',
    renderHint: 'washbasin on a vanity unit with a mirror above',
  },
  {
    kind: 'bathtub',
    label: 'Bathtub',
    category: 'bathroom',
    widthM: 1.7,
    depthM: 0.75,
    heightM: 0.6,
    glyph: 'round',
    fill: 'rgba(56, 189, 248, 0.18)',
    stroke: '#7dd3fc',
    renderHint: 'built-in bathtub',
  },
  {
    kind: 'washing_machine',
    label: 'Washing machine',
    category: 'bathroom',
    widthM: 0.6,
    depthM: 0.6,
    heightM: 0.85,
    glyph: 'plain',
    fill: 'rgba(56, 189, 248, 0.18)',
    stroke: '#7dd3fc',
    renderHint: 'front-loading washing machine',
  },
  {
    kind: 'outdoor_sofa_l',
    label: 'Outdoor L-sofa',
    category: 'outdoor',
    widthM: 2.6,
    depthM: 1.9,
    heightM: 0.75,
    glyph: 'l_shape',
    fill: 'rgba(52, 211, 153, 0.24)',
    stroke: '#6ee7b7',
    renderHint: 'outdoor L-shaped lounge set with weatherproof cushions',
  },
  {
    kind: 'outdoor_dining',
    label: 'Outdoor dining set',
    category: 'outdoor',
    widthM: 2,
    depthM: 1,
    heightM: 0.75,
    glyph: 'plain',
    fill: 'rgba(52, 211, 153, 0.24)',
    stroke: '#6ee7b7',
    renderHint: 'outdoor dining table with chairs',
  },
  {
    kind: 'sun_lounger',
    label: 'Sun lounger',
    category: 'outdoor',
    widthM: 0.7,
    depthM: 2,
    heightM: 0.4,
    glyph: 'round',
    fill: 'rgba(52, 211, 153, 0.24)',
    stroke: '#6ee7b7',
    renderHint: 'reclining sun lounger',
  },
  {
    kind: 'bbq',
    label: 'BBQ / grill',
    category: 'outdoor',
    widthM: 1.2,
    depthM: 0.6,
    heightM: 1,
    glyph: 'plain',
    fill: 'rgba(52, 211, 153, 0.24)',
    stroke: '#6ee7b7',
    renderHint: 'built-in barbecue grill counter',
  },
  {
    kind: 'planter',
    label: 'Planter',
    category: 'outdoor',
    widthM: 0.6,
    depthM: 0.6,
    heightM: 0.8,
    glyph: 'round',
    fill: 'rgba(52, 211, 153, 0.24)',
    stroke: '#6ee7b7',
    renderHint: 'large planter with a shrub',
  },
]

const SPEC_BY_KIND = new Map<FurnitureKind, FurnitureSpec>(
  FURNITURE_SPECS.map((s) => [s.kind, s]),
)

export const FURNITURE_KINDS: FurnitureKind[] = FURNITURE_SPECS.map((s) => s.kind)

export function isFurnitureKind(x: unknown): x is FurnitureKind {
  return typeof x === 'string' && SPEC_BY_KIND.has(x as FurnitureKind)
}

/** Spec for a kind; falls back to the first entry so unknown JSON never crashes the editor. */
export function furnitureSpec(kind: FurnitureKind): FurnitureSpec {
  return SPEC_BY_KIND.get(kind) ?? FURNITURE_SPECS[0]!
}

export const FURNITURE_CATEGORY_ORDER: FurnitureCategory[] = [
  'living',
  'bedroom',
  'kitchen',
  'bathroom',
  'outdoor',
]

export function furnitureCategoryLabel(c: FurnitureCategory): string {
  switch (c) {
    case 'living':
      return 'Living / dining'
    case 'bedroom':
      return 'Bedroom / study'
    case 'kitchen':
      return 'Kitchen'
    case 'bathroom':
      return 'Bathroom / toiletry'
    case 'outdoor':
      return 'Outdoor'
  }
}

/** Inspector / prompt label: custom text when set, else the catalog name. */
export function furnitureDisplayLabel(item: {
  label: string
  kind: FurnitureKind
}): string {
  const t = item.label.trim()
  return t.length > 0 ? t : furnitureSpec(item.kind).label
}

export const MIN_FURNITURE_SIZE_M = 0.2
export const MAX_FURNITURE_SIZE_M = 12

export function clampFurnitureSizeM(m: number, fallback: number): number {
  if (!Number.isFinite(m)) return fallback
  return Math.min(MAX_FURNITURE_SIZE_M, Math.max(MIN_FURNITURE_SIZE_M, m))
}

/** Wrap into [0, 360) so the inspector and stored value always agree. */
export function normalizeRotationDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const r = deg % 360
  return r < 0 ? r + 360 : r
}

/** A fresh item of `kind` centred on `x`,`y` with the catalog footprint. */
export function createFurnitureItem(
  id: string,
  kind: FurnitureKind,
  x: number,
  y: number,
): FurnitureItem {
  const spec = furnitureSpec(kind)
  return {
    id,
    kind,
    label: '',
    x,
    y,
    widthM: spec.widthM,
    depthM: spec.depthM,
    heightM: spec.heightM,
    rotationDeg: 0,
  }
}

/** Axis-aligned bounds of the rotated footprint — used to keep items inside the plan. */
export function furnitureAabbHalfExtentsM(item: {
  widthM: number
  depthM: number
  rotationDeg: number
}): { hx: number; hy: number } {
  const rad = (normalizeRotationDeg(item.rotationDeg) * Math.PI) / 180
  const c = Math.abs(Math.cos(rad))
  const s = Math.abs(Math.sin(rad))
  return {
    hx: (item.widthM * c + item.depthM * s) / 2,
    hy: (item.widthM * s + item.depthM * c) / 2,
  }
}
