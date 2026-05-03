import type { ConnectorSubtype, DeviceType } from '../types/project'

const COLORS: Record<DeviceType, string> = {
  light: '#f4b400',
  outlet: '#2d6cdf',
  switch: '#6f42c1',
  motion_sensor: '#1abc9c',
  connector: '#17a2b8',
  camera: '#e85d75',
  access_reader: '#9b59b6',
  access_point: '#00a896',
  generic_eth_device: '#5c7cfa',
  generic_power_device: '#e67e22',
}

const GLYPHS: Record<DeviceType, string> = {
  light: 'L',
  outlet: '○',
  switch: 'S',
  motion_sensor: 'M',
  connector: '◇',
  camera: 'C',
  access_reader: 'R',
  access_point: 'W',
  generic_eth_device: 'E',
  generic_power_device: 'P',
}

export function deviceFill(type: DeviceType) {
  return COLORS[type]
}

export function deviceGlyph(type: DeviceType, connectorSubtype?: ConnectorSubtype) {
  if (type === 'connector') {
    return connectorSubtype === 'fiber' ? 'F' : 'E'
  }
  return GLYPHS[type]
}
