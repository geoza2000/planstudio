import {
  deviceTypeRollupLabel,
  regionIsExternal,
  type FloorDevice,
  type FloorLevel,
  type FurnitureItem,
  type PlanRegion,
  type PlanstudioProject,
  type WallMaterial,
  type WallOpening,
} from '../types/project'
import { pointInPolygon } from './geometry'
import { effectiveWallFaceMaterial } from './wallConstruction'
import { furnitureDisplayLabel, furnitureSpec } from './furnitureCatalog'
import { DEFAULT_CEILING_HEIGHT_M } from './floorDeviceCluster'
import {
  describeAlongWall,
  describePlacementInRoom,
  polygonAreaM2,
  polygonBbox,
  roomWallsBySide,
  type RoomWallInfo,
} from './roomGeometry'

/** Which consumer the text is written for — the two need very different shapes. */
export type RenderPromptTarget = 'brief' | 'image'

export const RENDER_PROMPT_TARGETS: {
  id: RenderPromptTarget
  label: string
  hint: string
}[] = [
  {
    id: 'brief',
    label: 'Multimodal model (Claude, GPT, Gemini)',
    hint: 'Structured brief written to accompany the plan image. Best when the model can reason over the drawing.',
  },
  {
    id: 'image',
    label: 'Image model (Midjourney, Flux, Imagen…)',
    hint: 'One dense descriptive paragraph, no markdown. Front-loaded subject, constraints last.',
  },
]

export type RenderPromptStyle = 'photoreal' | 'archviz' | 'cozy' | 'clay'

export const RENDER_PROMPT_STYLES: { id: RenderPromptStyle; label: string }[] = [
  { id: 'photoreal', label: 'Photorealistic interior photo' },
  { id: 'archviz', label: 'Architectural visualisation' },
  { id: 'cozy', label: 'Warm / lifestyle magazine' },
  { id: 'clay', label: 'Clay / white massing model' },
]

export type RenderPromptLighting = 'daylight' | 'golden_hour' | 'evening'

export const RENDER_PROMPT_LIGHTING: { id: RenderPromptLighting; label: string }[] = [
  { id: 'daylight', label: 'Bright daylight' },
  { id: 'golden_hour', label: 'Golden hour' },
  { id: 'evening', label: 'Evening / artificial light' },
]

export type RenderPromptView = 'dollhouse' | 'eye_level' | 'per_room'

export const RENDER_PROMPT_VIEWS: { id: RenderPromptView; label: string }[] = [
  { id: 'dollhouse', label: 'Cutaway dollhouse view of the whole floor' },
  { id: 'eye_level', label: 'Eye-level view of the main room' },
  { id: 'per_room', label: 'One image per room' },
]

export type RenderPromptOptions = {
  target: RenderPromptTarget
  style: RenderPromptStyle
  lighting: RenderPromptLighting
  view: RenderPromptView
  includeElectrical: boolean
  extraNotes: string
}

export const DEFAULT_RENDER_PROMPT_OPTIONS: RenderPromptOptions = {
  target: 'brief',
  style: 'photoreal',
  lighting: 'daylight',
  view: 'dollhouse',
  includeElectrical: false,
  extraNotes: '',
}

/* ------------------------------------------------------------------ text utils */

function num(x: number, digits = 2): string {
  const r = Math.round(x * 10 ** digits) / 10 ** digits
  return String(r)
}

/** "a", "a and b", "a, b and c" */
function joinList(items: string[]): string {
  const xs = items.filter(Boolean)
  if (xs.length === 0) return ''
  if (xs.length === 1) return xs[0]!
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]!}`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1)
}

function materialPhrase(m: WallMaterial, short = false): string {
  if (m === 'rock') {
    return short ? 'rough exposed stone masonry' : 'rough exposed stone masonry with visible irregular courses'
  }
  return short ? 'smooth off-white painted plaster' : 'smooth plaster with a matte off-white painted finish'
}

/* --------------------------------------------------------------- descriptions */

/** What the model is being asked to hand back, as a noun phrase for the opening line. */
function deliverableNoun(style: RenderPromptStyle): string {
  switch (style) {
    case 'archviz':
      return 'an architectural visualisation'
    case 'cozy':
      return 'a warm, lifestyle-magazine interior render'
    case 'clay':
      return 'a white clay massing render'
    case 'photoreal':
    default:
      return 'a photorealistic 3D render'
  }
}

function styleClause(style: RenderPromptStyle): string {
  switch (style) {
    case 'archviz':
      return 'architectural visualisation, clean physically based materials, accurate perspective, subtle ambient occlusion, neutral colour grading'
    case 'cozy':
      return 'warm lifestyle-magazine interior photography, layered soft textiles, styled but uncluttered, inviting and lived-in'
    case 'clay':
      return 'untextured white clay massing model, matte surfaces, soft studio light, geometry and proportion reading clearly, no decorative materials'
    case 'photoreal':
    default:
      return 'photorealistic interior photography, physically based materials, realistic global illumination, 24 mm lens on a full-frame camera, level horizon, no fisheye distortion'
  }
}

function lightingClause(l: RenderPromptLighting): string {
  switch (l) {
    case 'golden_hour':
      return 'late-afternoon golden-hour sun raking through the glazing, long soft shadows, warm highlights against cool shadow'
    case 'evening':
      return 'evening after sunset, the interior lit by warm 2700 K fittings, deep blue sky beyond the glazing'
    case 'daylight':
    default:
      return 'bright natural daylight through the windows, soft realistic shadows, neutral white balance'
  }
}

function viewClause(v: RenderPromptView): string {
  switch (v) {
    case 'eye_level':
      return 'an eye-level interior view with the camera about 1.6 m above the floor, framed so the main furniture and at least one window are in shot'
    case 'per_room':
      return 'one eye-level interior view per room, camera about 1.6 m above the floor, each framed to show that room’s furniture and openings'
    case 'dollhouse':
    default:
      return 'a cutaway "dollhouse" view of the whole floor with the roof and near walls removed, camera high and angled down about 45°, every space visible at once'
  }
}

type RoomModel = {
  region: PlanRegion
  external: boolean
  areaM2: number
  bbox: ReturnType<typeof polygonBbox>
  ceilingM: number
  walls: RoomWallInfo[]
  furniture: FurnitureItem[]
  devices: FloorDevice[]
}

function buildRoomModels(
  fl: FloorLevel,
  devices: FloorDevice[],
): { rooms: RoomModel[]; usedFurniture: Set<string>; usedDevices: Set<string> } {
  const plan = fl.plan
  const furniture = plan.furniture ?? []
  const usedFurniture = new Set<string>()
  const usedDevices = new Set<string>()

  const rooms: RoomModel[] = [...(plan.regions ?? [])]
    .filter((r) => r.vertices.length >= 3)
    .sort((a, b) => polygonAreaM2(b.vertices) - polygonAreaM2(a.vertices))
    .map((region) => {
      const sheets = fl.wallSheets.filter((w) => w.roomRegionId === region.id)
      const walls = roomWallsBySide(region, sheets, plan.wallSegments ?? [])
      const inRoom = furniture.filter(
        (f) =>
          f.roomRegionId === region.id ||
          (!f.roomRegionId && pointInPolygon({ x: f.x, y: f.y }, region.vertices)),
      )
      for (const f of inRoom) usedFurniture.add(f.id)
      const inRoomDevices = devices.filter((d) =>
        pointInPolygon({ x: d.x, y: d.y }, region.vertices),
      )
      for (const d of inRoomDevices) usedDevices.add(d.id)
      return {
        region,
        external: regionIsExternal(region),
        areaM2: polygonAreaM2(region.vertices),
        bbox: polygonBbox(region.vertices),
        ceilingM:
          sheets.length > 0
            ? Math.max(...sheets.map((w) => w.heightM))
            : DEFAULT_CEILING_HEIGHT_M,
        walls,
        furniture: inRoom,
        devices: inRoomDevices,
      }
    })

  return { rooms, usedFurniture, usedDevices }
}

/** "the north wall is rough exposed stone; the other three are smooth painted plaster" */
function describeEnclosure(
  room: RoomModel,
  settings: PlanstudioProject['editorSettings'],
): string {
  if (room.walls.length === 0) return ''
  const byMaterial = new Map<WallMaterial, RoomWallInfo[]>()
  for (const w of room.walls) {
    const m = effectiveWallFaceMaterial(w.sheet, w.segment, settings)
    if (!byMaterial.has(m)) byMaterial.set(m, [])
    byMaterial.get(m)!.push(w)
  }

  const total = room.walls.length
  const parts: string[] = []
  for (const [material, walls] of byMaterial) {
    const thickest = Math.max(
      ...walls.map((w) => w.segment?.thicknessM ?? settings.defaultWallThicknessM),
    )
    const mm = Math.round(thickest * 1000)
    if (walls.length === total) {
      parts.push(`all ${total} walls are ${mm} mm ${materialPhrase(material)}`)
    } else if (walls.length === 1) {
      const w = walls[0]!
      parts.push(
        `the ${w.side} wall (${num(w.sheet.lengthM)} m) is ${mm} mm ${materialPhrase(material)}`,
      )
    } else {
      const sides = joinList([...new Set(walls.map((w) => w.side))].map((s) => `${s}`))
      parts.push(`the ${sides} walls are ${mm} mm ${materialPhrase(material)}`)
    }
  }
  return joinList(parts)
}

function openingSentence(o: WallOpening, w: RoomWallInfo): string {
  const where = describeAlongWall(o.xM, w.sheet.lengthM)
  const sill = o.zM - o.heightM / 2
  const name = o.label?.trim() ? ` ("${o.label.trim()}")` : ''
  if (o.kind === 'window') {
    return `a ${num(o.widthM)} × ${num(o.heightM)} m window${name} ${where} in the ${w.side} wall, sill ${num(sill)} m above the floor`
  }
  return `a ${num(o.widthM)} × ${num(o.heightM)} m door${name} ${where} in the ${w.side} wall`
}

/** One furnishing bullet: what it is, how big, and where it sits relative to the walls. */
function furnitureBullet(f: FurnitureItem, room: RoomModel): string {
  const spec = furnitureSpec(f.kind)
  const custom = f.label.trim()
  const notes = f.notes?.trim()
  /* Name first, then the user's own material notes — reads better than gluing them together. */
  const what = notes
    ? `${custom || spec.label} — ${notes}`
    : custom
      ? `${custom} — ${spec.renderHint}`
      : spec.renderHint
  const placement = describePlacementInRoom(
    { x: f.x, y: f.y },
    Math.min(f.widthM, f.depthM) / 2,
    room.region,
    room.walls,
    room.external ? 'space' : 'room',
  )
  return `- ${capitalize(what)} (${num(f.widthM)} × ${num(f.depthM)} m, ${num(f.heightM)} m high), ${placement}.`
}

function deviceSummary(devices: FloorDevice[]): string {
  const counts = new Map<string, number>()
  for (const d of devices) {
    const key = deviceTypeRollupLabel(d.type, d.connectorSubtype)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return joinList(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k, v]) => `${v} × ${k}`),
  )
}

/** Fittings a render would actually show; the rest is documentation-only infrastructure. */
function isVisibleFitting(d: FloorDevice): boolean {
  return (
    d.type === 'light' ||
    d.type === 'switch' ||
    d.type === 'outlet' ||
    d.type === 'motion_sensor' ||
    d.type === 'camera'
  )
}

function roomHeading(room: RoomModel): string {
  const name = room.region.label.trim() || 'Unnamed space'
  const dims = `${num(room.areaM2)} m² (about ${num(room.bbox.w)} × ${num(room.bbox.d)} m)`
  return room.external
    ? `${name} — outdoor space, ${dims}`
    : `${name} — ${dims}, ${num(room.ceilingM)} m ceiling`
}

/* ------------------------------------------------------------------- builders */

function buildBrief(
  project: PlanstudioProject,
  fl: FloorLevel,
  options: RenderPromptOptions,
  rooms: RoomModel[],
  looseFurniture: FurnitureItem[],
  looseDevices: FloorDevice[],
  hasImage: boolean,
): string {
  const settings = project.editorSettings
  const out: string[] = []
  const push = (s = '') => out.push(s)

  const indoor = rooms.filter((r) => !r.external)
  const outdoor = rooms.filter((r) => r.external)
  const totalArea = rooms.reduce((s, r) => s + r.areaM2, 0)

  push(
    `Produce ${deliverableNoun(options.style)} of the floor plan ${
      hasImage ? 'in the attached drawing' : 'described below'
    }.`,
  )
  push()
  if (hasImage) {
    push(
      'The attached plan is measured and authoritative — reproduce its room shapes, wall positions and door/window locations exactly. North is up. The notes below add what a plan cannot show: heights, surface finishes and furnishing.',
    )
  } else {
    push(
      'Every dimension below is in metres. Plan directions are given as compass points with north up.',
    )
  }
  push()

  push('## The floor')
  push(
    `${fl.label} of ${project.name.trim() || 'this project'}: ${rooms.length} space${
      rooms.length === 1 ? '' : 's'
    }, ${num(totalArea)} m² in total${
      indoor.length > 0 ? `, ceilings ${num(Math.max(...indoor.map((r) => r.ceilingM)))} m` : ''
    }${outdoor.length > 0 ? `, including ${outdoor.length} outdoor space${outdoor.length === 1 ? '' : 's'}` : ''}.`,
  )
  push()

  for (const room of rooms) {
    push(`## ${roomHeading(room)}`)

    const enclosure = describeEnclosure(room, settings)
    if (room.external) {
      push(
        `Open to the sky — no ceiling. ${
          enclosure ? `Enclosed on ${room.walls.length} side${room.walls.length === 1 ? '' : 's'}: ${enclosure}.` : 'Largely open on all sides.'
        } Treat the ground as an exterior finish (stone paving, tile or timber decking).`,
      )
    } else if (enclosure) {
      push(`Enclosure: ${enclosure}.`)
    }

    const windows: string[] = []
    const doors: string[] = []
    for (const w of room.walls) {
      for (const o of w.sheet.openings ?? []) {
        ;(o.kind === 'window' ? windows : doors).push(openingSentence(o, w))
      }
    }
    if (windows.length > 0) push(`Daylight: ${joinList(windows)}.`)
    if (doors.length > 0) push(`Access: ${joinList(doors)}.`)
    if (windows.length === 0 && doors.length === 0 && !room.external) {
      push('No windows or doors are recorded on this space.')
    }

    if (room.furniture.length > 0) {
      push('Furnishing:')
      for (const f of room.furniture) push(furnitureBullet(f, room))
    } else {
      push('Furnishing: leave this space empty.')
    }

    if (options.includeElectrical && room.devices.length > 0) {
      push(`Fittings visible: ${deviceSummary(room.devices)} — keep them discreet and true to scale.`)
    }
    push()
  }

  if (looseFurniture.length > 0) {
    push('## Elsewhere on the floor')
    push(
      `Not inside any detected room: ${joinList(
        looseFurniture.map((f) => {
          const spec = furnitureSpec(f.kind)
          return `${furnitureDisplayLabel(f)} (${spec.renderHint}), ${num(f.widthM)} × ${num(f.depthM)} m`
        }),
      )}. Place these using the attached plan.`,
    )
    push()
  }

  if (options.includeElectrical && looseDevices.length > 0) {
    push(`Fittings outside the detected rooms: ${deviceSummary(looseDevices)}.`)
    push()
  }

  push('## Camera, light and finish')
  push(`- Camera: ${viewClause(options.view)}.`)
  push(`- Light: ${lightingClause(options.lighting)}.`)
  push(`- Look: ${styleClause(options.style)}.`)
  push(
    '- Floors: one coherent finish per space, appropriate to its use — timber or large-format tile indoors, stone paving or decking outdoors.',
  )
  push('- Ceilings: flat and matte white at the stated height, except outdoor spaces, which are open to the sky.')
  push('- Glazing: clear glass in slim frames, at the stated sill heights.')

  const extra = options.extraNotes.trim()
  if (extra) {
    push(`- Also: ${extra}`)
  }
  push()

  push('## Do not')
  push('- Do not add, remove or move rooms, walls, doors or windows.')
  push('- Do not add furniture that is not listed above, and do not omit any that is.')
  push('- Do not change the stated proportions — a 5 m wall must not read as 8 m.')
  push('- Do not put a ceiling or roof over a space described as outdoor.')
  push('- No text, labels, dimension lines or watermarks in the image.')

  return out.join('\n')
}

/** Image models want the subject first and the camera as a short trailing clause. */
function viewImageParts(v: RenderPromptView): { subject: string; camera: string } {
  switch (v) {
    case 'eye_level':
      return {
        subject: 'Eye-level interior photograph',
        camera: 'camera 1.6 m above the floor, a window in frame',
      }
    case 'per_room':
      return {
        subject: 'Eye-level interior photograph',
        camera: 'camera 1.6 m above the floor',
      }
    case 'dollhouse':
    default:
      return {
        subject: 'Cutaway dollhouse 3D render',
        camera:
          'roof and near walls removed, camera high and angled down 45°, every space visible at once',
      }
  }
}

const COUNT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n)
}

function buildImageParagraph(
  project: PlanstudioProject,
  options: RenderPromptOptions,
  rooms: RoomModel[],
  hasImage: boolean,
): string {
  const settings = project.editorSettings
  const totalArea = rooms.reduce((s, r) => s + r.areaM2, 0)
  const indoor = rooms.filter((r) => !r.external)
  const view = viewImageParts(options.view)

  const sentences: string[] = []
  sentences.push(
    `${view.subject} of a ${num(totalArea)} m² ${
      rooms.length === 1 ? 'single-space' : `${countWord(rooms.length)}-space`
    } home, ${view.camera}`,
  )

  const roomClauses: string[] = []
  for (const room of rooms) {
    const name = (room.region.label.trim() || 'space').toLowerCase()
    const bits: string[] = []

    const materials = new Set(
      room.walls.map((w) => effectiveWallFaceMaterial(w.sheet, w.segment, settings)),
    )
    if (materials.has('rock') && materials.size > 1) {
      bits.push('one wall in rough exposed stone masonry, the rest smooth off-white plaster')
    } else if (materials.has('rock')) {
      bits.push('walls in rough exposed stone masonry')
    } else if (materials.size > 0) {
      bits.push('smooth off-white plastered walls')
    }

    const glazing = room.walls.flatMap((w) =>
      (w.sheet.openings ?? []).filter((o) => o.kind === 'window'),
    )
    if (glazing.length > 0) {
      const widest = Math.max(...glazing.map((o) => o.widthM))
      bits.push(
        `${glazing.length === 1 ? 'a' : `${glazing.length}`} window${
          glazing.length === 1 ? '' : 's'
        } up to ${num(widest)} m wide bringing in daylight`,
      )
    }

    const furn = room.furniture.map((f) => {
      const spec = furnitureSpec(f.kind)
      const notes = f.notes?.trim()
      return notes ? `${spec.renderHint} (${notes})` : spec.renderHint
    })
    if (furn.length > 0) bits.push(joinList(furn))

    if (room.external) {
      roomClauses.push(
        `an adjoining ${num(room.areaM2)} m² outdoor ${name} open to the sky${
          bits.length ? `, ${joinList(bits)}` : ''
        }`,
      )
    } else {
      roomClauses.push(
        `a ${num(room.areaM2)} m² ${name} with ${num(room.ceilingM)} m ceilings${
          bits.length ? `, ${joinList(bits)}` : ''
        }`,
      )
    }
  }

  /* Semicolons between rooms: each clause already carries its own commas. */
  if (roomClauses.length > 0) sentences.push(`Interior: ${roomClauses.join('; ')}`)
  if (indoor.length > 0) {
    sentences.push(
      rooms.some((r) => r.external)
        ? 'Warm timber floors indoors, stone paving outdoors'
        : 'Warm timber floors',
    )
  }
  sentences.push(capitalize(lightingClause(options.lighting)))
  sentences.push(capitalize(styleClause(options.style)))
  sentences.push('High detail, 8k')

  const extra = options.extraNotes.trim()
  if (extra) sentences.push(capitalize(extra))

  sentences.push(
    hasImage
      ? 'Follow the attached floor plan exactly for room shapes, wall positions and window and door placement'
      : 'Match the stated proportions exactly',
  )
  sentences.push(
    'Do not add rooms, doors, windows or furniture beyond those described, and no text or labels in the image',
  )

  return `${sentences.join('. ')}.`
}

/**
 * Compose the render prompt for one floor.
 *
 * The prompt is written to accompany the exported plan image (see
 * `renderFloorPlanImagePngDataUrl`): geometry the drawing already carries is not repeated
 * as coordinate soup, and what remains is descriptive prose — relative placement
 * ("against the north wall"), finishes, and explicit constraints — which is what
 * generative models actually follow.
 */
export function buildFloorRenderPrompt(
  project: PlanstudioProject,
  fl: FloorLevel,
  options: RenderPromptOptions = DEFAULT_RENDER_PROMPT_OPTIONS,
  hasImage = true,
): string {
  const devices = options.includeElectrical
    ? fl.plan.devices.filter(isVisibleFitting)
    : []
  const { rooms, usedFurniture, usedDevices } = buildRoomModels(fl, devices)
  const looseFurniture = (fl.plan.furniture ?? []).filter((f) => !usedFurniture.has(f.id))
  const looseDevices = devices.filter((d) => !usedDevices.has(d.id))

  if (rooms.length === 0) {
    return [
      'This floor has no detected rooms yet.',
      '',
      'Draw closed loops of wall segments on the Floor tab so Planstudio can detect rooms, then generate the prompt again — room shapes, wall finishes and openings all hang off that topology.',
    ].join('\n')
  }

  if (options.target === 'image') {
    return buildImageParagraph(project, options, rooms, hasImage)
  }
  return buildBrief(project, fl, options, rooms, looseFurniture, looseDevices, hasImage)
}

/** Filename stem for downloading a floor's brief or plan image. */
export function renderPromptBaseName(project: PlanstudioProject, fl: FloorLevel): string {
  return `${project.name.trim() || 'project'}-${fl.label}-render`
}
