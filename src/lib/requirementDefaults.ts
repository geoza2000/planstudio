import type { ConnectorSubtype, DeviceRequirements, DeviceType } from '../types/project'

export function emptyDeviceRequirements(): DeviceRequirements {
  return {}
}

/** Suggested metrics when placing a device or refreshing from type (editable after). */
export function defaultRequirementsForDeviceType(
  type: DeviceType,
  connectorSubtype?: ConnectorSubtype,
): DeviceRequirements {
  switch (type) {
    case 'light':
      return {
        dinTe: 2,
        dinRailMm: 35,
        knxChannelRole: 'output_actuator',
        notes: 'Typical: KNX / DIN actuator or relay (adjust TE & rail)',
      }
    case 'camera':
      return {
        poeWatts: 12,
        ethernetPorts: 1,
        protectCamera: true,
        notes: 'PoE + Protect / NVR path',
      }
    case 'access_point':
      return {
        poeWatts: 15,
        ethernetPorts: 1,
        notes: 'PoE + uplink / controller',
      }
    case 'access_reader':
      return {
        ethernetPorts: 1,
        accessReader: true,
        notes: 'Access reader + cable homerun',
      }
    case 'outlet':
      return {
        ethernetPorts: 0,
        notes: 'Power outlet',
      }
    case 'switch':
      return {
        ethernetPorts: 0,
        knxChannelRole: 'binary_input',
        notes: 'Wall switch — bus binary input or rocker module',
      }
    case 'motion_sensor':
      return {
        dinTe: 2,
        dinRailMm: 35,
        knxChannelRole: 'bus_sensor',
        notes: 'Motion / presence on bus (same panel planning as loads)',
      }
    case 'connector':
      return {
        ethernetPorts: connectorSubtype === 'fiber' ? 0 : 1,
        notes:
          connectorSubtype === 'fiber'
            ? 'Fiber drop / splice path'
            : 'Structured cable / patch',
      }
    case 'generic_eth_device':
      return {
        ethernetPorts: 1,
        notes: 'Generic data / IP device',
      }
    case 'generic_power_device':
      return {
        notes: 'Generic powered / control load',
      }
    default:
      return {
        ethernetPorts: 1,
        notes: '',
      }
  }
}

/** User values win over defaults where both set; fills missing keys from type defaults. */
export function mergeRequirementsWithDeviceTypeDefaults(
  type: DeviceType,
  existing: DeviceRequirements | undefined,
  connectorSubtype?: ConnectorSubtype,
): DeviceRequirements {
  const base = defaultRequirementsForDeviceType(type, connectorSubtype)
  return { ...base, ...(existing ?? {}) }
}
