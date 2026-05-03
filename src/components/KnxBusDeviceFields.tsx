import type { DeviceRequirements, Id, KnxChannelRole, KnxLine } from '../types/project'
import { KNX_CHANNEL_ROLES, knxChannelRoleLabel } from '../types/project'

type KnxBusDeviceFieldsProps = {
  knxLines: KnxLine[]
  /** When false, only the bus channel role is shown (e.g. device catalog templates). */
  showKnxLineSelect?: boolean
  requirements: DeviceRequirements | undefined
  knxLineId: Id | undefined
  onPatchRequirements: (p: Partial<DeviceRequirements>) => void
  onKnxLineId: (id: Id | undefined) => void
}

export function KnxBusDeviceFields({
  knxLines,
  showKnxLineSelect = true,
  requirements,
  knxLineId,
  onPatchRequirements,
  onKnxLineId,
}: KnxBusDeviceFieldsProps) {
  const req = requirements ?? {}
  const role = req.knxChannelRole

  return (
    <>
      {showKnxLineSelect ? (
        <label className="field">
          <span>KNX / bus line</span>
          <select
            value={knxLineId ?? ''}
            onChange={(e) => onKnxLineId(e.target.value ? e.target.value : undefined)}
          >
            <option value="">(unassigned)</option>
            {[...knxLines]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>Bus channel role</span>
        <select
          value={role ?? ''}
          onChange={(e) => {
            const v = e.target.value as KnxChannelRole | ''
            onPatchRequirements({
              knxChannelRole: v ? v : undefined,
            })
          }}
        >
          <option value="">(not on bus / manual)</option>
          {KNX_CHANNEL_ROLES.map((r) => (
            <option key={r} value={r}>
              {knxChannelRoleLabel(r)}
            </option>
          ))}
        </select>
      </label>
    </>
  )
}
