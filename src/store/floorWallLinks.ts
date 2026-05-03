import type { FloorDevice, FloorLevel, WallMountDevice } from '../types/project'

function stripFd(d: FloorDevice): FloorDevice {
  const o = { ...d }
  delete o.linkedWallDeviceId
  return o
}

function stripWm(d: WallMountDevice): WallMountDevice {
  const o = { ...d }
  delete o.linkedFloorDeviceId
  return o
}

export function linkFloorToWallOnLevel(
  fl: FloorLevel,
  floorDeviceId: string,
  wallSheetId: string,
  wallDeviceId: string | null,
): FloorLevel {
  const targetFd = fl.plan.devices.find((d) => d.id === floorDeviceId)
  const oldWallDevId = targetFd?.linkedWallDeviceId

  let devices: FloorDevice[] = fl.plan.devices.map((d) => {
    if (d.id === floorDeviceId) return d
    if (wallDeviceId && d.linkedWallDeviceId === wallDeviceId) {
      return stripFd(d)
    }
    return d
  })

  let wallSheets: FloorLevel['wallSheets'] = fl.wallSheets.map((ws) => ({
    ...ws,
    devices: ws.devices.map((w) => {
      if (oldWallDevId && w.id === oldWallDevId) {
        return stripWm(w)
      }
      if (w.linkedFloorDeviceId === floorDeviceId && w.id !== wallDeviceId) {
        return stripWm(w)
      }
      return w
    }),
  }))

  if (wallDeviceId) {
    const prevWall = wallSheets
      .flatMap((w) => w.devices)
      .find((w) => w.id === wallDeviceId)
    if (prevWall?.linkedFloorDeviceId && prevWall.linkedFloorDeviceId !== floorDeviceId) {
      const of = prevWall.linkedFloorDeviceId
      devices = devices.map((d) => (d.id === of ? stripFd(d) : d))
    }
  }

  const nextDevices = devices.map((d) => {
    if (d.id === floorDeviceId) {
      if (wallDeviceId) return { ...d, linkedWallDeviceId: wallDeviceId }
      return stripFd(d)
    }
    return d
  })

  if (wallDeviceId) {
    wallSheets = wallSheets.map((ws) => {
      if (ws.id !== wallSheetId) return ws
      return {
        ...ws,
        devices: ws.devices.map((w) => {
          if (w.id !== wallDeviceId) return w
          return { ...w, linkedFloorDeviceId: floorDeviceId }
        }),
      }
    })
  } else if (oldWallDevId) {
    wallSheets = wallSheets.map((ws) => ({
      ...ws,
      devices: ws.devices.map((w) =>
        w.id === oldWallDevId ? stripWm(w) : w,
      ),
    }))
  }

  return {
    ...fl,
    plan: { ...fl.plan, devices: nextDevices },
    wallSheets,
  }
}
