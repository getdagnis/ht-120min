import assert from 'node:assert/strict';
import test from 'node:test';

import { buildChppAppgUpdate, classifyChppAppgOutcome } from '../api/_lib/appg-chpp-classifier';
import type { MatchEventDetails, MatchGoalCategory } from '../shared/match-events';

function eventDetails(
  homeGoals: Array<{ category: MatchGoalCategory; matchPart?: number }>,
  awayGoals: Array<{ category: MatchGoalCategory; matchPart?: number }>,
  shootout?: { home: number; away: number },
): MatchEventDetails {
  const goals = (items: Array<{ category: MatchGoalCategory; matchPart?: number }>) =>
    items.map((item, index) => ({
      eventTypeId: item.category === 'regular' ? 121 : 120,
      playerId: index + 1,
      minute: item.matchPart && item.matchPart >= 3 ? 105 + index : 20 + index,
      matchPart: item.matchPart ?? 2,
      category: item.category,
    }));

  return {
    version: 1,
    source: 'matchdetails-3.1',
    actualHomeTeamId: 100,
    actualAwayTeamId: 200,
    hasPenaltyShootout: Boolean(shootout),
    home: {
      teamId: 100,
      cards: [],
      injuries: [],
      goals: goals(homeGoals),
      penaltyShootoutGoals: shootout?.home ?? 0,
    },
    away: {
      teamId: 200,
      cards: [],
      injuries: [],
      goals: goals(awayGoals),
      penaltyShootoutGoals: shootout?.away ?? 0,
    },
  };
}

test('classifies regulation results with event evidence', () => {
  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 2,
      awayGoals: 1,
      went120: false,
      eventDetails: eventDetails(
        [{ category: 'regular' }, { category: 'other' }],
        [{ category: 'regular' }],
      ),
    }),
    'OPW',
  );

  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 1,
      awayGoals: 0,
      went120: false,
      eventDetails: eventDetails([{ category: 'other' }], []),
    }),
    'RT0',
  );

  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 1,
      awayGoals: 1,
      went120: false,
      eventDetails: eventDetails([{ category: 'regular' }], [{ category: 'other' }]),
    }),
    'RT0',
  );
});

test('classifies extra-time regular and other goals separately', () => {
  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 2,
      awayGoals: 1,
      went120: true,
      eventDetails: eventDetails(
        [{ category: 'regular' }, { category: 'regular', matchPart: 3 }],
        [{ category: 'regular' }],
      ),
    }),
    'ET3',
  );

  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 1,
      awayGoals: 2,
      went120: true,
      eventDetails: eventDetails(
        [{ category: 'regular' }],
        [{ category: 'regular' }, { category: 'other', matchPart: 3 }],
      ),
    }),
    'ET2',
  );
});

test('classifies a known penalty-shootout winner and leaves incomplete evidence for review', () => {
  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 1,
      awayGoals: 1,
      went120: true,
      penaltyShootoutHomeGoals: 4,
      penaltyShootoutAwayGoals: 3,
      eventDetails: eventDetails([{ category: 'regular' }], [{ category: 'regular' }], { home: 4, away: 3 }),
    }),
    'PS1',
  );

  assert.equal(
    classifyChppAppgOutcome({
      completed: true,
      homeGoals: 2,
      awayGoals: 1,
      went120: false,
      eventDetails: eventDetails([{ category: 'regular' }], [{ category: 'regular' }]),
    }),
    'needs_review',
  );
});

test('only APPG mode is auto-classified and organizer or CSV decisions are preserved', () => {
  assert.deepEqual(
    buildChppAppgUpdate({
      scoringMode: 'points',
      completed: true,
      homeGoals: 1,
      awayGoals: 0,
      eventDetails: eventDetails([{ category: 'regular' }], []),
    }),
    {},
  );

  assert.deepEqual(
    buildChppAppgUpdate({
      scoringMode: 'appg',
      currentSource: 'organizer',
      completed: true,
      homeGoals: 1,
      awayGoals: 0,
      eventDetails: eventDetails([{ category: 'regular' }], []),
    }),
    {},
  );
});
