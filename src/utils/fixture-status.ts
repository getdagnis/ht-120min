/** Warning history must not override a subsequently confirmed fixture. */
export function isFixtureMisarranged(status: string, completed: boolean, hasWarnings: boolean): boolean {
  return status === 'misarranged' || (
    !completed && !['arranged', 'ongoing', 'finished'].includes(status) && hasWarnings
  );
}
