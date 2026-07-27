export type TournamentRegistrationType = 'validated' | 'manual' | 'sandbox';

export function normalizeTournamentRegistrationType(value: unknown): TournamentRegistrationType {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (normalized === 'sandbox' || normalized.includes('sandbox')) return 'sandbox';
  if (normalized === 'validated' || normalized.includes('hattrick validated')) return 'validated';

  return 'manual';
}

export function getTournamentRegistrationTypeLabel(value: unknown) {
  switch (normalizeTournamentRegistrationType(value)) {
    case 'validated':
      return 'Hattrick Validated (CHPP)';
    case 'sandbox':
      return 'Sandbox Playground';
    case 'manual':
    default:
      return 'Organizer-Managed';
  }
}

export function isSandboxTournament(registrationType: unknown) {
  return normalizeTournamentRegistrationType(registrationType) === 'sandbox';
}
