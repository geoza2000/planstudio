import { create } from 'zustand'

export type Preview3dCameraPreset = 'overview' | 'top' | 'walk'

/** Ephemeral view options for the 3D preview tab; nothing here is persisted. */
export type Preview3dState = {
  showCeilings: boolean
  showFurniture: boolean
  showDevices: boolean
  showRoomLabels: boolean
  /** Clip everything above `sectionCutM` for a clean dollhouse look. */
  sectionCut: boolean
  sectionCutM: number
  /** Bumped by the controls; the viewer applies the preset and ignores repeats. */
  cameraRequest: { preset: Preview3dCameraPreset; roomId?: string; nonce: number } | null
  snapshotNonce: number
  set: (patch: Partial<Omit<Preview3dState, 'set' | 'requestCamera' | 'requestSnapshot'>>) => void
  requestCamera: (preset: Preview3dCameraPreset, roomId?: string) => void
  requestSnapshot: () => void
}

export const usePreview3dStore = create<Preview3dState>((set) => ({
  showCeilings: false,
  showFurniture: true,
  showDevices: true,
  showRoomLabels: true,
  sectionCut: false,
  sectionCutM: 1.4,
  cameraRequest: null,
  snapshotNonce: 0,
  set: (patch) => set(patch),
  requestCamera: (preset, roomId) =>
    set((s) => ({
      cameraRequest: { preset, roomId, nonce: (s.cameraRequest?.nonce ?? 0) + 1 },
    })),
  requestSnapshot: () => set((s) => ({ snapshotNonce: s.snapshotNonce + 1 })),
}))
