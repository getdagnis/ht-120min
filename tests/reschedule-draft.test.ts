import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRescheduleDraft, serializeRescheduleDraftForRpc } from '../src/utils/reschedule-draft';

const fourTeams = [
  { id: 'team-a', name: 'Alpha', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-b', name: 'Beta', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-c', name: 'Gamma', countryName: 'Sweden', leagueLevel: 6 },
  { id: 'team-d', name: 'Delta', countryName: 'Sweden', leagueLevel: 6 },
];

const threeTeams = fourTeams.slice(0, 3);

function match(
  id: string,
  homeTeamId: string | null,
  awayTeamId: string | null,
  overrides: Partial<{
    status: 'not_arranged' | 'arranged' | 'ongoing' | 'misarranged' | 'finished' | null;
    completed: boolean;
    htMatchId: number | null;
    scheduledFor: string | null;
    matchDate: Date | null;
    scheduleSlotType: 'midweek_friendly' | 'week15_weekend_friendly' | 'weekend_friendly' | null;
  }> = {},
) {
  return {
    id,
    homeTeamId,
    awayTeamId,
    status: Object.hasOwn(overrides, 'status') ? overrides.status! : 'not_arranged',
    completed: overrides.completed ?? false,
    htMatchId: overrides.htMatchId ?? null,
    scheduledFor: Object.hasOwn(overrides, 'scheduledFor') ? overrides.scheduledFor! : '2026-07-08T12:00:00.000Z',
    matchDate: Object.hasOwn(overrides, 'matchDate') ? overrides.matchDate! : null,
    scheduleSlotType: overrides.scheduleSlotType,
    venueType: 'home_away' as const,
  };
}

const baseRounds = [
  {
    id: 'round-1',
    roundNumber: 1,
    matches: [
      match('match-1', 'team-a', 'team-b', {
        status: 'finished',
        completed: true,
        htMatchId: 101,
        scheduledFor: '2026-06-24T12:00:00.000Z',
      }),
      match('match-2', 'team-c', 'team-d', {
        status: 'finished',
        completed: true,
        htMatchId: 102,
        scheduledFor: '2026-06-24T12:00:00.000Z',
      }),
    ],
  },
  {
    id: 'round-2',
    roundNumber: 2,
    matches: [match('match-3', 'team-a', 'team-c'), match('match-4', 'team-b', 'team-d')],
  },
  {
    id: 'round-3',
    roundNumber: 3,
    matches: [match('match-5', 'team-a', 'team-d'), match('match-6', 'team-b', 'team-c')],
  },
];

test('reschedule draft waits for an explicit round before showing a preview', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds,
    fromRoundNumber: null,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, false);
  assert.equal(draft.reason, 'Select a round to regenerate from.');
  assert.equal(draft.selectedFromRoundNumber, null);
  assert.equal(draft.selectedStartSlotId, null);
  assert.equal(draft.rounds.length, 0);
  assert.equal(draft.roundChoices[0]?.available, false);
  assert.equal(draft.roundChoices[1]?.available, true);
});

test('reschedule draft preserves pairings after explicit round selection', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds,
    fromRoundNumber: 2,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedFromRoundNumber, 2);
  assert.equal(draft.roundChoices[0]?.available, false);
  assert.equal(draft.roundChoices[1]?.available, true);
  assert.deepEqual(
    draft.rounds.map((round) => round.roundNumber),
    [2, 3],
  );
  assert.deepEqual(
    draft.rounds[0]?.matches.map((match) => [match.homeTeamId, match.awayTeamId]),
    [
      ['team-a', 'team-c'],
      ['team-b', 'team-d'],
    ],
  );
});

test('reschedule draft consumes the optional W15 weekend slot when requested', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds,
    fromRoundNumber: 2,
    startSlotId: 'S94-W15-midweek',
    includeWeek15WeekendFriendly: true,
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.currentStartSlotId, 'S94-W15-midweek');
  assert.equal(
    draft.rounds.map((round) => round.slot.kind).join(','),
    'weekend_friendly,midweek_friendly',
  );
  assert.equal(draft.rounds[0]?.slot.htWeek, 15);
  assert.equal(draft.consumesWeek15WeekendFriendly, true);

  const payload = serializeRescheduleDraftForRpc(draft);
  assert.equal(payload.from_round_number, 2);
  assert.equal(payload.rounds[0]?.matches[0]?.schedule_slot_type, 'weekend_friendly');
  assert.equal(payload.rounds[1]?.matches[0]?.match_id, 'match-5');
});

test('reschedule draft skips W15 weekend by default and still includes W16 weekend', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds,
    fromRoundNumber: 2,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(
    draft.rounds.map((round) => `${round.slot.htWeek}:${round.slot.kind}`).join(','),
    '16:midweek_friendly,16:weekend_friendly',
  );
  assert.equal(draft.canIncludeWeek15WeekendFriendly, true);
  assert.equal(draft.consumesWeek15WeekendFriendly, false);
});

test('custom reschedule start can skip the W15 weekend when only one round remains', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: [baseRounds[0]!, baseRounds[1]!, baseRounds[2]!],
    fromRoundNumber: 3,
    startSlotId: 'S94-W16-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedFromRoundNumber, 3);
  assert.equal(draft.selectedStartSlotId, 'S94-W16-midweek');
  assert.equal(draft.rounds.length, 1);
  assert.equal(draft.rounds[0]?.slot.kind, 'midweek_friendly');
  assert.equal(draft.rounds[0]?.slot.htWeek, 16);
  assert.equal(draft.consumesWeek15WeekendFriendly, false);
});

test('arranged matches lock their round and any earlier suffix start', () => {
  const rounds = [
    baseRounds[0]!,
    {
      ...baseRounds[1]!,
      matches: [match('match-3', 'team-a', 'team-c', { status: 'arranged', htMatchId: 999 }), match('match-4', 'team-b', 'team-d')],
    },
    baseRounds[2]!,
  ];

  const blockedDraft = buildRescheduleDraft({
    teams: fourTeams,
    rounds,
    fromRoundNumber: 2,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(blockedDraft.valid, false);
  assert.equal(blockedDraft.reason, 'Select a round to regenerate from.');
  assert.equal(blockedDraft.selectedFromRoundNumber, null);
  assert.equal(blockedDraft.roundChoices[1]?.available, false);
  assert.equal(blockedDraft.roundChoices[2]?.available, true);

  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds,
    fromRoundNumber: 3,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedFromRoundNumber, 3);
});

test('legacy null match status is treated as not arranged for rescheduling', () => {
  const rounds = [
    {
      ...baseRounds[1]!,
      matches: [
        match('match-3', 'team-a', 'team-c', { status: null }),
        match('match-4', 'team-b', 'team-d', { status: null }),
      ],
    },
    {
      ...baseRounds[2]!,
      matches: [
        match('match-5', 'team-a', 'team-d', { status: null }),
        match('match-6', 'team-b', 'team-c', { status: null }),
      ],
    },
  ];

  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds,
    fromRoundNumber: 2,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedFromRoundNumber, 2);
  assert.equal(draft.roundChoices[0]?.available, true);
});

test('odd-team BYE rows are preserved and serialized without fake opponents', () => {
  const rounds = [
    {
      id: 'round-1',
      roundNumber: 1,
      matches: [match('match-1', 'team-a', 'team-b'), match('match-2', 'team-c', null)],
    },
    {
      id: 'round-2',
      roundNumber: 2,
      matches: [match('match-3', 'team-a', 'team-c'), match('match-4', 'team-b', null)],
    },
  ];
  const draft = buildRescheduleDraft({
    teams: threeTeams,
    rounds,
    fromRoundNumber: 1,
    startSlotId: 'S94-W15-midweek',
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.ok(draft.rounds.every((round) => round.matches.some((item) => item.isBye)));

  const payload = serializeRescheduleDraftForRpc(draft);
  assert.ok(payload.rounds.every((round) => round.matches.some((item) => item.is_bye)));
  assert.ok(
    payload.rounds.every((round) =>
      round.matches
        .filter((item) => item.is_bye)
        .every((item) => (item.home_team_id === null) !== (item.away_team_id === null)),
    ),
  );
});

test('blocked W1-W3 slots are displayed but never valid reschedule starts', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: [
      {
        ...baseRounds[1]!,
        matches: [
          match('match-3', 'team-a', 'team-c', { scheduledFor: '2026-08-05T12:00:00.000Z' }),
          match('match-4', 'team-b', 'team-d', { scheduledFor: '2026-08-05T12:00:00.000Z' }),
        ],
      },
      {
        ...baseRounds[2]!,
        matches: [
          match('match-5', 'team-a', 'team-d', { scheduledFor: '2026-08-12T12:00:00.000Z' }),
          match('match-6', 'team-b', 'team-c', { scheduledFor: '2026-08-12T12:00:00.000Z' }),
        ],
      },
    ],
    fromRoundNumber: 2,
    startSlotId: 'S95-W1-blocked',
    now: new Date('2026-07-17T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.notEqual(draft.selectedStartSlotId, 'S95-W1-blocked');
  assert.ok(draft.allSlotOptions.some((slot) => slot.id === 'S95-W1-blocked' && !slot.selectable));
  assert.ok(draft.allSlotOptions.some((slot) => slot.id === 'S95-W3-blocked' && !slot.selectable));
  assert.ok(draft.startSlotOptions.every((slot) => slot.htWeek !== 1 && slot.htWeek !== 2 && slot.htWeek !== 3));
});

test('W4 can be selected as a reschedule start', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: [
      {
        ...baseRounds[1]!,
        matches: [
          match('match-3', 'team-a', 'team-c', { scheduledFor: '2026-08-05T12:00:00.000Z' }),
          match('match-4', 'team-b', 'team-d', { scheduledFor: '2026-08-05T12:00:00.000Z' }),
        ],
      },
      {
        ...baseRounds[2]!,
        matches: [
          match('match-5', 'team-a', 'team-d', { scheduledFor: '2026-08-12T12:00:00.000Z' }),
          match('match-6', 'team-b', 'team-c', { scheduledFor: '2026-08-12T12:00:00.000Z' }),
        ],
      },
    ],
    fromRoundNumber: 2,
    startSlotId: 'S95-W4-midweek',
    now: new Date('2026-07-17T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedStartSlotId, 'S95-W4-midweek');
  assert.deepEqual(
    draft.rounds.map((round) => round.slot.htWeek),
    [4, 5],
  );
});

test('reschedule starts only after untouched rounds and keeps the current slot as a disabled marker', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds.map((round) => ({
      ...round,
      matches:
        round.roundNumber === 2
          ? round.matches.map((item) => ({
              ...item,
              scheduledFor: '2026-07-08T12:00:00.000Z',
              scheduleSlotType: 'midweek_friendly' as const,
            }))
          : round.roundNumber === 3
            ? round.matches.map((item) => ({
                ...item,
                scheduledFor: '2026-07-14T12:00:00.000Z',
                scheduleSlotType: 'midweek_friendly' as const,
              }))
            : round.matches,
    })),
    fromRoundNumber: 3,
    startSlotId: null,
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, false);
  assert.equal(draft.reason, 'Select a new start date.');
  assert.equal(draft.currentStartSlotId, 'S94-W16-midweek');
  assert.deepEqual(
    draft.previousRounds.map((round) => round.roundNumber),
    [1, 2],
  );
  assert.ok(draft.allSlotOptions.every((slot) => slot.htWeek !== 15));
  assert.ok(draft.allSlotOptions.some((slot) => slot.id === 'S94-W16-midweek'));
  assert.ok(draft.startSlotOptions.every((slot) => slot.id !== 'S94-W16-midweek'));
  assert.ok(draft.startSlotOptions.some((slot) => slot.id === 'S94-W16-weekend'));
  assert.equal(draft.selectedStartSlotId, null);
});

test('reschedule cutoff uses calendar slot order instead of previous kickoff timestamp', () => {
  const draft = buildRescheduleDraft({
    teams: fourTeams,
    rounds: baseRounds.map((round) => ({
      ...round,
      matches:
        round.roundNumber === 2
          ? round.matches.map((item) =>
              match(item.id, item.homeTeamId, item.awayTeamId, {
                scheduledFor: '2026-07-12T18:00:00.000Z',
                scheduleSlotType: 'midweek_friendly',
              }),
            )
          : round.roundNumber === 3
            ? round.matches.map((item) =>
                match(item.id, item.homeTeamId, item.awayTeamId, {
                  scheduledFor: '2026-07-14T12:00:00.000Z',
                  scheduleSlotType: 'midweek_friendly',
                }),
              )
            : round.matches,
    })),
    fromRoundNumber: 3,
    startSlotId: 'S94-W15-weekend',
    includeWeek15WeekendFriendly: true,
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.selectedStartSlotId, 'S94-W15-weekend');
  assert.equal(draft.rounds[0]?.slot.kind, 'weekend_friendly');
  assert.equal(draft.rounds[0]?.slot.htWeek, 15);
});

test('legacy schedules without persisted slot metadata can move W16 midweek back to W15 weekend', () => {
  const legacyTeams = [
    { id: 'germany', name: 'Konig Erl', countryName: 'Germany', leagueLevel: null },
    { id: 'south-africa', name: 'Long Beach FC', countryName: 'South Africa', leagueLevel: null },
    { id: 'chile', name: 'Combinado Nacional', countryName: 'Chile', leagueLevel: null },
    { id: 'latvia', name: 'This bot team is a bot', countryName: 'Latvia', leagueLevel: null },
  ];
  const legacyRounds = [
    {
      id: 'round-1',
      roundNumber: 1,
      matches: [
        match('match-1', 'germany', 'latvia', {
          status: 'finished',
          completed: true,
          htMatchId: 766805125,
          scheduledFor: null,
          matchDate: new Date('2026-07-01T16:15:00.000Z'),
          scheduleSlotType: null,
        }),
        match('match-2', 'south-africa', 'chile', {
          status: 'arranged',
          htMatchId: 766809198,
          scheduledFor: null,
          matchDate: new Date('2026-07-01T19:30:00.000Z'),
          scheduleSlotType: null,
        }),
      ],
    },
    {
      id: 'round-2',
      roundNumber: 2,
      matches: [
        match('match-3', 'latvia', 'south-africa', {
          scheduledFor: null,
          matchDate: new Date('2026-07-08T11:45:00.000Z'),
          scheduleSlotType: null,
        }),
        match('match-4', 'chile', 'germany', {
          scheduledFor: null,
          matchDate: new Date('2026-07-08T20:50:00.000Z'),
          scheduleSlotType: null,
        }),
      ],
    },
    {
      id: 'round-3',
      roundNumber: 3,
      matches: [
        match('match-5', 'germany', 'south-africa', {
          scheduledFor: null,
          matchDate: new Date('2026-07-14T16:15:00.000Z'),
          scheduleSlotType: null,
        }),
        match('match-6', 'chile', 'latvia', {
          scheduledFor: null,
          matchDate: new Date('2026-07-15T20:50:00.000Z'),
          scheduleSlotType: null,
        }),
      ],
    },
  ];

  const draft = buildRescheduleDraft({
    teams: legacyTeams,
    rounds: legacyRounds,
    fromRoundNumber: 3,
    startSlotId: 'S94-W15-weekend',
    includeWeek15WeekendFriendly: true,
    now: new Date('2026-06-30T08:00:00Z'),
  });

  assert.equal(draft.valid, true);
  assert.equal(draft.currentStartSlotId, 'S94-W16-midweek');
  assert.equal(draft.selectedStartSlotId, 'S94-W15-weekend');
  assert.ok(draft.startSlotOptions.some((slot) => slot.id === 'S94-W15-weekend'));
  assert.equal(draft.rounds[0]?.matches[0]?.scheduleSlotType, 'weekend_friendly');
});
