import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  buildFloorScene3d,
  buildGround,
  type FloorScene3d,
  type Scene3dRoom,
} from '../lib/floorScene3d'
import { downloadDataUrl, slug } from '../lib/exporters'
import { usePreview3dStore, type Preview3dCameraPreset } from '../store/preview3dStore'
import { useProjectStore } from '../store/projectStore'

type Preview3DProps = {
  /** Render loop only runs while the tab is showing. */
  active: boolean
}

type Rig = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  sun: THREE.DirectionalLight
  model: FloorScene3d | null
  ground: ReturnType<typeof buildGround> | null
  clipPlane: THREE.Plane
}

const EYE_HEIGHT_M = 1.6

/**
 * Section cut via per-material clipping so labels (sprites) and the ground stay whole.
 * Materials are shared across meshes, so each unique one is touched once.
 */
function applySectionCut(rig: Rig, enabled: boolean) {
  if (!rig.model) return
  const seen = new Set<THREE.Material>()
  rig.model.group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return
    const list = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of list) {
      if (seen.has(m)) continue
      seen.add(m)
      m.clippingPlanes = enabled ? [rig.clipPlane] : null
      m.clipShadows = enabled
    }
  })
}

function fitOverview(rig: Rig, bounds: THREE.Box3, preset: Preview3dCameraPreset) {
  const { camera, controls } = rig
  const centre = new THREE.Vector3()
  const size = new THREE.Vector3()
  bounds.getCenter(centre)
  bounds.getSize(size)
  const radius = Math.max(Math.hypot(size.x, size.z) / 2, 2.5)
  const fov = (camera.fov * Math.PI) / 180
  const aspect = Math.max(camera.aspect, 0.6)
  const dist = Math.max((radius / Math.sin(fov / 2)) * (aspect < 1 ? 1.2 : 0.85), 5)
  controls.target.set(centre.x, 0.4, centre.z)
  if (preset === 'top') {
    camera.position.set(centre.x, dist, centre.z + 0.01)
  } else {
    const dir = new THREE.Vector3(-0.55, 0.78, 0.7).normalize()
    camera.position.copy(controls.target).add(dir.multiplyScalar(dist))
  }
  camera.near = 0.05
  camera.far = Math.max(200, dist * 6)
  camera.updateProjectionMatrix()
  controls.update()
}

function walkInto(rig: Rig, room: Scene3dRoom) {
  const { camera, controls } = rig
  const c = room.centre
  // Look toward the most distant corner so the view crosses the room.
  let far = c
  let farD = -1
  for (const v of room.vertices) {
    const d = Math.hypot(v.x - c.x, v.y - c.y)
    if (d > farD) {
      farD = d
      far = new THREE.Vector3(v.x, 0, v.y)
    }
  }
  const dir = new THREE.Vector3(far.x - c.x, 0, far.z - c.z)
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1)
  dir.normalize()
  // Stand near the wall opposite that corner so most of the room is in frame.
  const back = Math.max(0.4, farD * 0.55)
  camera.position.set(c.x - dir.x * back, EYE_HEIGHT_M, c.z - dir.z * back)
  controls.target.set(c.x + dir.x * 1.5, EYE_HEIGHT_M - 0.3, c.z + dir.z * 1.5)
  camera.near = 0.05
  camera.updateProjectionMatrix()
  controls.update()
}

function largestIndoorRoom(rooms: Scene3dRoom[]): Scene3dRoom | undefined {
  const indoor = rooms.filter((r) => !r.external)
  const pool = indoor.length > 0 ? indoor : rooms
  return [...pool].sort((a, b) => b.areaM2 - a.areaM2)[0]
}

/**
 * Real-time Three.js model of the active floor. Geometry is rebuilt from the store whenever
 * the floor, wall construction or view options change; the camera keeps its place unless the
 * floor itself changes.
 */
export function Preview3D({ active }: Preview3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const rigRef = useRef<Rig | null>(null)
  const activeRef = useRef(active)
  const lastFloorIdRef = useRef<string | null>(null)

  const project = useProjectStore((s) => s.project)
  const activeFloorId = useProjectStore((s) => s.activeFloorId)
  const activeFloor = useMemo(
    () => project.floors.find((f) => f.id === activeFloorId) ?? project.floors[0]!,
    [project.floors, activeFloorId],
  )
  const settings = project.editorSettings

  const showCeilings = usePreview3dStore((s) => s.showCeilings)
  const showFurniture = usePreview3dStore((s) => s.showFurniture)
  const showDevices = usePreview3dStore((s) => s.showDevices)
  const showRoomLabels = usePreview3dStore((s) => s.showRoomLabels)
  const sectionCut = usePreview3dStore((s) => s.sectionCut)
  const sectionCutM = usePreview3dStore((s) => s.sectionCutM)
  const cameraRequest = usePreview3dStore((s) => s.cameraRequest)
  const snapshotNonce = usePreview3dStore((s) => s.snapshotNonce)

  // Renderer, camera, lights — once.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.localClippingEnabled = true
    host.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.outline = 'none'

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#151b23')
    scene.fog = new THREE.Fog('#151b23', 60, 140)

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300)
    camera.position.set(8, 8, 8)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = false
    controls.maxPolarAngle = Math.PI * 0.53
    controls.minDistance = 0.3
    controls.maxDistance = 150

    scene.add(new THREE.HemisphereLight('#dbe8ff', '#4a3f33', 0.85))
    scene.add(new THREE.AmbientLight('#ffffff', 0.18))
    const sun = new THREE.DirectionalLight('#fff3df', 1.7)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    sun.shadow.radius = 3
    scene.add(sun)
    scene.add(sun.target)

    const rig: Rig = {
      renderer,
      scene,
      camera,
      controls,
      sun,
      model: null,
      ground: null,
      clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.4),
    }
    rigRef.current = rig

    const resize = () => {
      const w = Math.max(1, host.clientWidth)
      const h = Math.max(1, host.clientHeight)
      renderer.setSize(w, h, false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    renderer.setAnimationLoop(() => {
      if (!activeRef.current) return
      controls.update()
      renderer.render(scene, camera)
    })

    return () => {
      ro.disconnect()
      renderer.setAnimationLoop(null)
      controls.dispose()
      rig.model?.dispose()
      rig.ground?.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
      rigRef.current = null
    }
  }, [])

  // Model rebuild on data / option changes.
  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    if (rig.model) {
      rig.scene.remove(rig.model.group)
      rig.model.dispose()
      rig.model = null
    }
    const model = buildFloorScene3d(activeFloor, settings, {
      showCeilings,
      showFurniture,
      showDevices,
      showRoomLabels,
    })
    rig.scene.add(model.group)
    rig.model = model

    if (rig.ground) {
      rig.scene.remove(rig.ground.group)
      rig.ground.dispose()
    }
    rig.ground = buildGround(model.bounds)
    rig.scene.add(rig.ground.group)

    // Sun follows the model so the shadow frustum stays tight.
    const centre = new THREE.Vector3()
    const size = new THREE.Vector3()
    model.bounds.getCenter(centre)
    model.bounds.getSize(size)
    const radius = Math.max(Math.hypot(size.x, size.z) / 2, 4)
    rig.sun.position.set(centre.x - radius * 0.9, radius * 1.6 + 6, centre.z + radius * 0.7)
    rig.sun.target.position.set(centre.x, 0, centre.z)
    const cam = rig.sun.shadow.camera
    cam.left = -radius * 1.3
    cam.right = radius * 1.3
    cam.top = radius * 1.3
    cam.bottom = -radius * 1.3
    cam.near = 1
    cam.far = radius * 5 + 20
    cam.updateProjectionMatrix()

    applySectionCut(rig, usePreview3dStore.getState().sectionCut)

    if (lastFloorIdRef.current !== activeFloor.id) {
      lastFloorIdRef.current = activeFloor.id
      fitOverview(rig, model.bounds, 'overview')
    }
  }, [activeFloor, settings, showCeilings, showFurniture, showDevices, showRoomLabels])

  // Section cut.
  useEffect(() => {
    const rig = rigRef.current
    if (!rig) return
    rig.clipPlane.constant = sectionCutM
    applySectionCut(rig, sectionCut)
  }, [sectionCut, sectionCutM])

  // Camera presets.
  useEffect(() => {
    const rig = rigRef.current
    if (!rig || !cameraRequest || !rig.model) return
    if (cameraRequest.preset === 'walk') {
      const room =
        rig.model.rooms.find((r) => r.id === cameraRequest.roomId) ??
        largestIndoorRoom(rig.model.rooms)
      if (room) walkInto(rig, room)
      else fitOverview(rig, rig.model.bounds, 'overview')
      return
    }
    fitOverview(rig, rig.model.bounds, cameraRequest.preset)
  }, [cameraRequest])

  // PNG snapshot: render synchronously, then read the buffer before the next frame.
  useEffect(() => {
    if (snapshotNonce === 0) return
    const rig = rigRef.current
    if (!rig) return
    rig.controls.update()
    rig.renderer.render(rig.scene, rig.camera)
    const dataUrl = rig.renderer.domElement.toDataURL('image/png')
    const name = `${slug(project.name)}-${slug(activeFloor.label)}-3d.png`
    downloadDataUrl(name, dataUrl)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotNonce])

  // Refresh sizing when the pane becomes visible (it may have been hidden at mount).
  useEffect(() => {
    activeRef.current = active
    if (!active) return
    const rig = rigRef.current
    const host = hostRef.current
    if (!rig || !host) return
    const w = Math.max(1, host.clientWidth)
    const h = Math.max(1, host.clientHeight)
    rig.renderer.setSize(w, h, false)
    rig.camera.aspect = w / h
    rig.camera.updateProjectionMatrix()
  }, [active])

  return (
    <div className="preview3d-root">
      <div ref={hostRef} className="preview3d-host" />
      <div className="preview3d-hud muted small">
        Drag to orbit · right-drag or two-finger drag to pan · scroll to zoom
      </div>
    </div>
  )
}
