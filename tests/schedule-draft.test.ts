import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCalendarSlots } from '../src/utils/hattrick-calendar';
import { buildScheduleDraft, getScheduleRoundCount, serializeScheduleDraftForRpc } from '../src/utils/schedule-draft';

const fourTeams = [
  { id: 'team-a', name: 'Alpha', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-b', name: 'Beta', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-c', name: 'Gamma', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-d', name: 'Delta', countryName: 'Sweden', leagueLevel: 6 },
];

const threeTeams = fourTeams.slice(0, 3);
const fiveTeams = [
  ...fourTeams,
  { id: 'team-e', name: 'Epsilon', countryName: 'Sweden', leagueLevel: 6 },
];

test('round counts match the selected mode', () => {
  assert.equal(getScheduleRoundCount('single', 4), 3);
  assert.equal(getScheduleRoundCount('double', 4), 6);
  assert.equal(getScheduleRoundCount('recurring', 4), 4);
  assert.equal(getScheduleRoundCount('single', 3), 3);
  assert.equal(getScheduleRoundCount('single', 5), 5);
  assert.equal(getScheduleRoundCount('double', 5), 10);
  assert.equal(getScheduleRoundCount('recurring', 5), 4);
});

test('placeholder teams are ignored by the frontend draft team count', () => {
  const draft = buildScheduleDraft({
    teams: [
      ...fourTeams,
      { id: 'placeholder', name: 'Placeholder', active: true, isPlaceholder: true, countryName: 'Sweden', leagueLevel: 6 },
    ],
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.teamCount, 4);
  assert.equal(draft.rounds.length, 3);
});

test('missing country metadata still allows midweek-only fallback starts', () => {
  const teamsWithMissingCountry = [
    { id: 'team-a', name: 'SocClasQua', countryName: null, leagueLevel: null },
    { id: 'team-b', name: 'Beta', countryName: 'Sweden', leagueLevel: 6 },
    { id: 'team-c', name: 'Gamma', countryName: 'Sweden', leagueLevel: 6 },
    { id: 'team-d', name: 'Delta', countryName: 'Sweden', leagueLevel: 6 },
  ];

  const draft = buildScheduleDraft({
    teams: teamsWithMissingCountry,
    mode: 'single',
    startSlotId: null,
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.ok(draft.selectedStartSlotId);
  assert.ok(draft.availableModes.every((mode) => mode.available));
  assert.ok(draft.startSlotOptions.length > 0);
  assert.ok(
    draft.rounds.some((round) =>
      round.matches.some((match) => match.homeTeamName === 'SocClasQua' && match.scheduledFor instanceof Date),
    ),
  );
});

test('week 15 scheduling consumes the weekend slot in order and preserves venue_type', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.mode, 'single');
  assert.equal(draft.selectedStartSlotId, 'S94-W15-midweek');
  assert.equal(draft.rounds.map((round) => round.slot.kind).join(','), 'midweek_friendly,week15_weekend_friendly,midweek_friendly');
  assert.equal(draft.rounds[1]?.matches[0]?.scheduledFor.toISOString(), '2026-07-12T08:00:00.000Z');
  assert.equal(draft.rounds[1]?.matches[0]?.scheduledFor.getUTCDay(), 0);

  const payload = serializeScheduleDraftForRpc(draft);
  assert.equal(payload.rounds.length, 3);
  assert.equal(payload.rounds[1]?.matches[0]?.venue_type, 'home_away');
  assert.equal(payload.rounds[1]?.matches[0]?.schedule_slot_type, 'week15_weekend_friendly');
});

test('odd-team drafts omit bye matches from the serialized payload', () => {
  const draft = buildScheduleDraft({
    teams: threeTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.rounds.length, 3);
  assert.ok(draft.rounds.every((round) => round.matches.every((match) => match.homeTeamId && match.awayTeamId)));
  assert.ok(draft.rounds.every((round) => round.matches.length === 1));

  const payload = serializeScheduleDraftForRpc(draft);
  assert.ok(payload.rounds.every((round) => round.matches.length === 1));
  assert.ok(payload.rounds.every((round) => round.matches.every((match) => match.venue_type === 'home_away')));
});

test('same-day start is valid before kickoff and omitted after kickoff', () => {
  const beforeKickoff = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-07-01T16:00:00Z'),
  });

  assert.equal(beforeKickoff.valid, true);
  assert.equal(beforeKickoff.selectedStartSlotId, 'S94-W14-midweek');
  assert.ok(beforeKickoff.rounds.every((round) => round.matches.every((match) => match.scheduledFor.getTime() > new Date('2026-07-01T16:00:00Z').getTime())));

  const afterKickoff = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-07-01T18:00:00Z'),
  });

  assert.equal(afterKickoff.valid, true);
  assert.notEqual(afterKickoff.selectedStartSlotId, 'S94-W14-midweek');
  assert.ok(afterKickoff.rounds.every((round) => round.matches.every((match) => match.scheduledFor.getTime() > new Date('2026-07-01T18:00:00Z').getTime())));
});

test('yesterday start slots are omitted from valid starts', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-07-02T10:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.notEqual(draft.selectedStartSlotId, 'S94-W14-midweek');
  assert.ok(draft.startSlotOptions.every((slot) => slot.id !== 'S94-W14-midweek'));
});

test('fixed now produces deterministic draft serialization', () => {
  const now = new Date('2026-06-29T00:00:00Z');
  const first = serializeScheduleDraftForRpc(
    buildScheduleDraft({
      teams: fourTeams,
      mode: 'single',
      startSlotId: 'S94-W15-midweek',
      now,
    }),
  );
  const second = serializeScheduleDraftForRpc(
    buildScheduleDraft({
      teams: fourTeams,
      mode: 'single',
      startSlotId: 'S94-W15-midweek',
      now,
    }),
  );

  assert.deepEqual(second, first);
});

test('selected starts move forward when the chosen window no longer fits the active team count', () => {
  const preserved = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });
  assert.equal(preserved.valid, true);
  assert.equal(preserved.selectedStartSlotId, 'S94-W15-midweek');

  const replaced = buildScheduleDraft({
    teams: fiveTeams,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(replaced.valid, true);
  assert.equal(replaced.mode, 'single');
  assert.equal(replaced.selectedStartSlotId, 'S95-W5-midweek');
  assert.ok(replaced.startSlotOptions.some((slot) => slot.htSeason === 95 && slot.htWeek === 5));
});

test('format availability disables impossible schedules and explains why', () => {
  const unavailable = buildScheduleDraft({
    teams: [{ id: 'solo', name: 'Solo', countryName: 'Sweden', leagueLevel: 6 }],
    mode: 'double',
    startSlotId: null,
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(unavailable.valid, false);
  assert.equal(unavailable.mode, 'single');
  assert.ok(unavailable.availableModes.every((mode) => mode.available === false));
  assert.equal(unavailable.availableModes[0]?.reason, 'At least 2 active teams are required.');
});

test('next-season W5 is discovered in the valid start list', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: null,
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.ok(draft.startSlotOptions.some((slot) => slot.htSeason === 95 && slot.htWeek === 5));
  assert.equal(draft.selectedStartSlotId, 'S94-W14-midweek');
});

test('calendar slot generation never exposes a Week 16 weekend slot', () => {
  const slots = buildCalendarSlots(new Date('2026-07-13T00:00:00Z'), 2);
  assert.equal(slots.some((slot) => slot.htWeek === 16 && slot.kind === 'week15_weekend_friendly'), false);
});
