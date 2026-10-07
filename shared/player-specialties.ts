export interface SpecialtyPositionGroup {
  specialtyId: number;
  roleIds: number[];
}

export interface PlayerLineupRole {
  playerId: number;
  roleId: number;
}

const DISPLAY_ORDER = [2, 1, 3, 5, 4, 6, 8];

export function summarizeSpecialtyPositions(
  lineup: PlayerLineupRole[],
  specialties: ReadonlyMap<number, number>,
): SpecialtyPositionGroup[] {
  const bySpecialty = new Map<number, number[]>();
  for (const player of lineup) {
    const specialtyId = specialties.get(player.playerId);
    if (!specialtyId || (specialtyId > 6 && specialtyId !== 8) || player.roleId < 100 || player.roleId > 113) continue;
    const roles = bySpecialty.get(specialtyId) ?? [];
    roles.push(player.roleId);
    bySpecialty.set(specialtyId, roles);
  }
  return DISPLAY_ORDER.flatMap((specialtyId) => {
    const roleIds = bySpecialty.get(specialtyId);
    return roleIds ? [{ specialtyId, roleIds: roleIds.sort((a, b) => a - b) }] : [];
  });
}
