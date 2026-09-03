import * as THREE from 'three'

/**
 * Procedural, seamlessly tiling textures for the 3D preview. Everything is generated once
 * on a canvas (no asset downloads) and shared across builds. UVs on the preview meshes are
 * in **metres**, so `repeat` is simply `1 / tileM`.
 */

type Rng = () => number

/** Small deterministic PRNG (mulberry32) so every rebuild looks identical. */
function seeded(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rng: Rng, n: number, alpha: number) {
  for (let i = 0; i < n; i++) {
    const l = 20 + rng() * 60
    ctx.fillStyle = `hsla(30 8% ${l}% / ${alpha})`
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1 + rng() * 2)
  }
}

function finish(c: HTMLCanvasElement, tileM: number): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(1 / tileM, 1 / tileM)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  tex.needsUpdate = true
  return tex
}

/** Irregular stone courses with dark mortar; wraps on both axes. */
function makeStoneTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, ctx] = canvas(S)
  const rng = seeded(11)
  ctx.fillStyle = '#5d564e'
  ctx.fillRect(0, 0, S, S)

  // Row heights normalised so the courses tile vertically.
  const rows: number[] = []
  let sum = 0
  while (sum < S) {
    const h = 44 + rng() * 40
    rows.push(h)
    sum += h
  }
  const k = S / sum
  let y = 0
  for (const rh0 of rows) {
    const rh = rh0 * k
    const widths: number[] = []
    let wsum = 0
    while (wsum < S) {
      const w = 60 + rng() * 120
      widths.push(w)
      wsum += w
    }
    const kw = S / wsum
    let x = -rng() * 100
    for (const w0 of widths) {
      const w = w0 * kw
      const g = 3 + rng() * 2.5
      const hue = 26 + rng() * 16
      const sat = 10 + rng() * 12
      const lum = 44 + rng() * 18
      ctx.fillStyle = `hsl(${hue} ${sat}% ${lum}%)`
      for (const dx of [-S, 0, S]) {
        for (const dy of [-S, 0, S]) {
          ctx.beginPath()
          ctx.roundRect(x + g + dx, y + g + dy, w - 2 * g, rh - 2 * g, 5)
          ctx.fill()
          // Bevel highlight along the top edge.
          ctx.fillStyle = `hsla(40 20% 85% / 0.14)`
          ctx.fillRect(x + g + dx, y + g + dy, w - 2 * g, 3)
          ctx.fillStyle = `hsl(${hue} ${sat}% ${lum}%)`
        }
      }
      x += w
    }
    y += rh
  }
  speckle(ctx, S, rng, 9000, 0.18)
  return finish(c, 1.6)
}

/** Fine plaster grain on an off-white base. */
function makePlasterTexture(): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S)
  const rng = seeded(3)
  ctx.fillStyle = '#ebe6dd'
  ctx.fillRect(0, 0, S, S)
  const img = ctx.getImageData(0, 0, S, S)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rng() - 0.5) * 14
    d[i] = Math.max(0, Math.min(255, d[i]! + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n))
  }
  ctx.putImageData(img, 0, 0)
  return finish(c, 1)
}

/** Oak planks with staggered end joints. */
function makeWoodFloorTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, ctx] = canvas(S)
  const rng = seeded(21)
  const plankW = 32 // 16 planks across a 2 m tile → 0.125 m boards
  ctx.fillStyle = '#7d5b3c'
  ctx.fillRect(0, 0, S, S)
  for (let px = 0; px < S; px += plankW) {
    let y = -rng() * 200
    while (y < S) {
      const len = 180 + rng() * 200
      const hue = 28 + rng() * 8
      const lum = 50 + rng() * 14
      ctx.fillStyle = `hsl(${hue} 38% ${lum}%)`
      for (const dy of [-S, 0, S]) ctx.fillRect(px + 1, y + 1 + dy, plankW - 2, len - 2)
      // Grain lines
      ctx.strokeStyle = `hsla(${hue} 40% ${lum - 14}% / 0.35)`
      ctx.lineWidth = 1
      for (let i = 0; i < 4; i++) {
        const gx = px + 4 + rng() * (plankW - 8)
        for (const dy of [-S, 0, S]) {
          ctx.beginPath()
          ctx.moveTo(gx, y + 4 + dy)
          ctx.lineTo(gx + (rng() - 0.5) * 6, y + len - 4 + dy)
          ctx.stroke()
        }
      }
      y += len
    }
  }
  return finish(c, 2)
}

/** Outdoor paving: 0.5 m stone tiles with sand grout. */
function makePavingTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, ctx] = canvas(S)
  const rng = seeded(5)
  ctx.fillStyle = '#8f8778'
  ctx.fillRect(0, 0, S, S)
  const n = 4
  const t = S / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lum = 58 + rng() * 12
      ctx.fillStyle = `hsl(${38 + rng() * 10} ${10 + rng() * 8}% ${lum}%)`
      ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6)
    }
  }
  speckle(ctx, S, rng, 6000, 0.14)
  return finish(c, 2)
}

/** Matte bathroom / kitchen tile, 0.3 m grid. */
function makeTileTexture(): THREE.CanvasTexture {
  const S = 512
  const [c, ctx] = canvas(S)
  const rng = seeded(9)
  ctx.fillStyle = '#b9bcc0'
  ctx.fillRect(0, 0, S, S)
  const n = 5 // 1.5 m tile → 0.3 m tiles
  const t = S / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const lum = 84 + rng() * 6
      ctx.fillStyle = `hsl(210 8% ${lum}%)`
      ctx.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
    }
  }
  return finish(c, 1.5)
}

export type SceneTextures = {
  stone: THREE.CanvasTexture
  plaster: THREE.CanvasTexture
  wood: THREE.CanvasTexture
  paving: THREE.CanvasTexture
  tile: THREE.CanvasTexture
}

let cache: SceneTextures | null = null

/** Lazily built once per page; browser only. */
export function sceneTextures(): SceneTextures {
  if (cache) return cache
  cache = {
    stone: makeStoneTexture(),
    plaster: makePlasterTexture(),
    wood: makeWoodFloorTexture(),
    paving: makePavingTexture(),
    tile: makeTileTexture(),
  }
  return cache
}

/**
 * Text label rendered to a canvas for a sprite. Returns the texture and the aspect ratio
 * (width / height) so the caller can scale the sprite without distortion.
 */
export function makeLabelTexture(
  title: string,
  subtitle?: string,
): { texture: THREE.CanvasTexture; aspect: number } {
  const W = 512
  const H = subtitle ? 176 : 120
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(12, 17, 24, 0.78)'
  ctx.beginPath()
  ctx.roundRect(6, 6, W - 12, H - 12, 26)
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'
  ctx.lineWidth = 3
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f3f6fa'
  ctx.font = '600 52px system-ui, -apple-system, "Segoe UI", sans-serif'
  let t = title
  while (ctx.measureText(t).width > W - 60 && t.length > 3) t = `${t.slice(0, -2)}…`
  ctx.fillText(t, W / 2, subtitle ? 62 : H / 2)
  if (subtitle) {
    ctx.fillStyle = '#a9b8c9'
    ctx.font = '400 36px system-ui, -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(subtitle, W / 2, 122)
  }
  const texture = new THREE.CanvasTexture(c)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return { texture, aspect: W / H }
}
