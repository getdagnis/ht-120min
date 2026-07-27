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

test('missing country metadata still allows default week 16 weekend fallback starts', () => {
  const teamsWithMissingCountry = [
    { id: 'team-a', name: 'SocClasQua', countryName: null, leagueLevel: null },
    { id: 'team-b', name: 'AC Sua', countryName: null, leagueLevel: null },
    { id: 'team-c', name: 'AtleticoSimoPN', countryName: null, leagueLevel: null },
    { id: 'team-d', name: 'TikiBoom', countryName: null, leagueLevel: null },
  ];

  const draft = buildScheduleDraft({
    teams: teamsWithMissingCountry,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedStartSlotId, 'S94-W15-midweek');
  assert.equal(
    draft.rounds.map((round) => round.slot.kind).join(','),
    'midweek_friendly,midweek_friendly,weekend_friendly',
  );
  assert.ok(draft.availableModes.every((mode) => mode.available));
  assert.equal(draft.rounds[2]?.matches[0]?.scheduledFor.toISOString(), '2026-07-19T08:00:00.000Z');
});

test('week 15 weekend is skipped by default and week 16 weekend is consumed in order', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.mode, 'single');
  assert.equal(draft.selectedStartSlotId, 'S94-W15-midweek');
  assert.equal(draft.rounds.map((round) => round.slot.kind).join(','), 'midweek_friendly,midweek_friendly,weekend_friendly');
  assert.equal(draft.canIncludeWeek15WeekendFriendly, true);
  assert.equal(draft.consumesWeek15WeekendFriendly, false);
  assert.equal(draft.rounds[2]?.matches[0]?.scheduledFor.toISOString(), '2026-07-19T08:00:00.000Z');
  assert.equal(draft.rounds[2]?.matches[0]?.scheduledFor.getUTCDay(), 0);

  const payload = serializeScheduleDraftForRpc(draft);
  assert.equal(payload.rounds.length, 3);
  assert.equal(payload.include_week15_weekend_friendly, false);
  assert.equal(payload.rounds[2]?.matches[0]?.venue_type, 'home_away');
  assert.equal(payload.rounds[2]?.matches[0]?.schedule_slot_type, 'weekend_friendly');
});

test('week 15 weekend can be included before the default week 16 weekend', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'recurring',
    startSlotId: 'S94-W15-midweek',
    includeWeek15WeekendFriendly: true,
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(
    draft.rounds.map((round) => `${round.slot.htWeek}:${round.slot.kind}`).join(','),
    '15:midweek_friendly,15:weekend_friendly,16:midweek_friendly,16:weekend_friendly',
  );
  assert.equal(draft.consumesWeek15WeekendFriendly, true);

  const payload = serializeScheduleDraftForRpc(draft);
  assert.equal(payload.include_week15_weekend_friendly, true);
  assert.equal(payload.rounds[1]?.matches[0]?.schedule_slot_type, 'weekend_friendly');
});

test('odd-team drafts preserve bye rows in the serialized payload', () => {
  const draft = buildScheduleDraft({
    teams: threeTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.rounds.length, 3);
  assert.ok(draft.rounds.every((round) => round.matches.some((match) => match.isBye)));
  assert.ok(draft.rounds.every((round) => round.matches.length === 2));

  const payload = serializeScheduleDraftForRpc(draft);
  assert.ok(payload.rounds.every((round) => round.matches.length === 2));
  assert.ok(payload.rounds.every((round) => round.matches.some((match) => match.is_bye)));
  assert.ok(
    payload.rounds.every((round) =>
      round.matches
        .filter((match) => match.is_bye)
        .every((match) => (match.home_team_id === null) !== (match.away_team_id === null)),
    ),
  );
  assert.ok(payload.rounds.every((round) => round.matches.every((match) => match.venue_type === 'home_away')));
});

test('start slots require at least three days of lead time', () => {
  const twoDaysAway = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W14-midweek',
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.equal(twoDaysAway.valid, true);
  assert.equal(twoDaysAway.selectedStartSlotId, 'S94-W15-midweek');
  assert.ok(twoDaysAway.startSlotOptions.every((slot) => slot.id !== 'S94-W14-midweek'));

  const threeDaysAway = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-07-03T00:00:00Z'),
  });

  assert.equal(threeDaysAway.valid, true);
  assert.equal(threeDaysAway.selectedStartSlotId, 'S94-W15-midweek');
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
  assert.equal(replaced.selectedStartSlotId, 'S95-W4-midweek');
  assert.ok(replaced.startSlotOptions.some((slot) => slot.htSeason === 95 && slot.htWeek === 4));
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
  assert.equal(draft.selectedStartSlotId, 'S94-W15-midweek');
});

test('W4-W6 cup weeks stay selectable while W1-W3 remain disabled display slots', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: 'S95-W4-midweek',
    now: new Date('2026-07-17T00:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedStartSlotId, 'S95-W4-midweek');
  assert.ok(draft.startSlotOptions.some((slot) => slot.id === 'S95-W4-midweek'));
  assert.ok(draft.startSlotOptions.some((slot) => slot.id === 'S95-W5-midweek'));
  assert.ok(draft.startSlotOptions.some((slot) => slot.id === 'S95-W6-midweek'));

  const week1 = draft.allSlotOptions.find((slot) => slot.id === 'S95-W1-blocked');
  const week2 = draft.allSlotOptions.find((slot) => slot.id === 'S95-W2-blocked');
  const week3 = draft.allSlotOptions.find((slot) => slot.id === 'S95-W3-blocked');
  assert.equal(week1?.selectable, false);
  assert.equal(week2?.selectable, false);
  assert.equal(week3?.selectable, false);
});

test('start options are capped at eight weeks ahead', () => {
  const draft = buildScheduleDraft({
    teams: fourTeams,
    mode: 'single',
    startSlotId: null,
    now: new Date('2026-06-29T00:00:00Z'),
  });

  assert.ok(
    draft.allSlotOptions.every((slot) => {
      const daysAhead = Math.round((slot.nominalDate.getTime() - new Date('2026-06-29T00:00:00Z').getTime()) / 86_400_000);
      return daysAhead <= 56;
    }),
  );
  assert.equal(draft.allSlotOptions.some((slot) => slot.id === 'S95-W6-midweek'), false);
});

test('calendar slot generation exposes a Week 16 weekend slot by default', () => {
  const slots = buildCalendarSlots(new Date('2026-07-13T00:00:00Z'), 2);
  assert.equal(slots.some((slot) => slot.htWeek === 16 && slot.kind === 'weekend_friendly'), true);
});
