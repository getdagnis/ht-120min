export type WorkerFixture = {
  id: string;
  status: string | null;
  completed: boolean | null;
  htMatchId: number | null;
  home: { autoArrangeEnabled: boolean; canChallenge: boolean; canAccept: boolean; canWithdraw: boolean };
  away: { autoArrangeEnabled: boolean; canChallenge: boolean; canAccept: boolean; canWithdraw: boolean };
};

export const REAL_BOOKING_CONFIRMATION = 'BOOK ONE STABURAGA KAUSS FIXTURE';

export function isWorkerTournamentId(input: unknown): input is string {
  return typeof input === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input);
}

export function bookingWorkerMode(input: unknown): 'dry_run' | 'real' {
  return input === 'real' ? 'real' : 'dry_run';
}

export function hasRealBookingConfirmation(input: unknown) {
  return input === REAL_BOOKING_CONFIRMATION;
}

export function chooseWorkerFixture(fixtures: WorkerFixture[]) {
  for (const fixture of fixtures) {
    if (fixture.completed || fixture.htMatchId || ['arranged', 'ongoing', 'finished'].includes(fixture.status || '')) continue;
    if (fixture.status === 'misarranged') continue;
    if (fixture.home.autoArrangeEnabled !== true || fixture.away.autoArrangeEnabled !== true) continue;
    return fixture;
  }
  return null;
}

export function workerInitialAction(fixture: WorkerFixture): { action: 'accept' | 'challenge'; side: 'home' | 'away' } | null {
  if (fixture.home.canAccept) return { action: 'accept', side: 'home' };
  if (fixture.away.canAccept) return { action: 'accept', side: 'away' };
  if (fixture.home.canWithdraw || fixture.away.canWithdraw) return null;
  if (fixture.home.canChallenge) return { action: 'challenge', side: 'home' };
  if (fixture.away.canChallenge) return { action: 'challenge', side: 'away' };
  return null;
}

export function isAmbiguousChallengeFailure(errorCode: unknown) {
  return Number(errorCode) === 70;
}
