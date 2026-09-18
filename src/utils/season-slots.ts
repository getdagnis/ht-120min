export function getSeasonSlotBoxSize(teamCount: number): number {
  if (!Number.isInteger(teamCount) || teamCount < 2) {
    throw new Error('A season slot box requires at least two teams.');
  }

  return teamCount % 2 === 0 ? teamCount : teamCount + 1;
}

export function getSeasonSlotIndexes(teamCount: number): number[] {
  return Array.from({ length: getSeasonSlotBoxSize(teamCount) }, (_, index) => index + 1);
}