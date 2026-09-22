import assert from 'node:assert/strict';
import test from 'node:test';

import appHandler from '../src/server/api/app.js';
import { buildRoundPressInput, type RoundPressMatchSource, type RoundPressRoundSource, type RoundPressTeamSource } from '../src/server/api/_lib/round-press-input.js';
import { parseAndValidateRoundPressDraft, validateRoundPressDraft } from '../src/server/api/_lib/round-press-validator.js';

const home: RoundPressTeamSource = { id: 'home', name: 'Home FC', ht_team_id: 1 };
const away: RoundPressTeamSource = { id: 'away', name: 'Away FC', ht_team_id: 2 };

function match(id: string, roundId: string, roundCompleted = true): RoundPressMatchSource {
  return {
    id,
    round_id: roundId,
    home_team_id: home.id,
    away_team_id: away.id,
    home_goals: 1,
    away_goals: 0,
    completed: roundCompleted,
    status: roundCompleted ? 'finished' : 'not_arranged',
    went_120: true,
    total_minutes: 120,
    penalty_shootout_home_goals: null,
    penalty_shootout_away_goals: null,
    home_yellow_cards: 1,
    home_red_cards: 0,
    home_injuries: 1,
    away_yellow_cards: 0,
    away_red_cards: 0,
    away_injuries: 0,
    match_event_details: null,
    scheduled_for: null,
    home_team: home,
    away_team: away,
  };
}

function rounds(): RoundPressRoundSource[] {
  return [
    { id: 'round-1', round_number: 1, matches: [match('match-1', 'round-1')] },
    { id: 'round-2', round_number: 2, matches: [match('match-2', 'round-2')] },
    { id: 'round-3', round_number: 3, matches: [match('future-match', 'round-3')] },
  ];
}

test('round input includes next fixtures and only pre-round standings context', () => {
  const input = buildRoundPressInput({
    tournament: { id: 'tournament', name: 'Cup', scoringMode: '120min' },
    seasonNumber: 1,
    roundNumber: 2,
    rounds: rounds(),
    teams: [home, away],
  });

  assert.deepEqual(input.matches.map((item) => item.matchId), ['match-2']);
  assert.deepEqual(input.nextRound?.fixtures, [{ homeTeamName: 'Home FC', awayTeamName: 'Away FC' }]);
  assert.equal(input.previousContext?.standingsBeforeRound?.[0]?.played, 1);
  assert.equal(JSON.stringify(input).includes('future-match'), false);
});

test('structured card and injury facts are converted without localized event text', () => {
  const source = match('match-2', 'round-2');
  source.match_event_details = {
    version: 1,
    source: 'matchdetails-3.1',
    actualHomeTeamId: 1,
    actualAwayTeamId: 2,
    home: {
      teamId: 1,
      cards: [{ eventTypeId: 510, playerId: 44, minute: 33, matchPart: 1, type: 'yellow', reason: 'nasty_play' }],
      injuries: [{ playerId: 45, minute: 55, matchPart: 2, injuryType: 2, severity: 'injury', locationEventTypeId: 401, weeks: 3, causedByFoul: false, causedByTeamId: null }],
      goals: [{ eventTypeId: 101, playerId: 46, minute: 22, matchPart: 1, category: 'regular' }],
      penaltyShootoutGoals: 0,
    },
    away: { teamId: 2, cards: [], injuries: [], goals: [], penaltyShootoutGoals: 0 },
  };
  const input = buildRoundPressInput({
    tournament: { id: 'tournament', name: 'Cup', scoringMode: '120min' },
    seasonNumber: 1,
    roundNumber: 2,
    rounds: [{ id: 'round-2', round_number: 2, matches: [source] }],
    teams: [home, away],
  });
  assert.equal(input.matches[0].homeFacts.yellowCards, 1);
  assert.equal(input.matches[0].homeFacts.injuries[0].weeks, 3);
  assert.equal(input.matches[0].homeFacts.goals[0].minute, 22);
});

test('validator accepts a complete draft and rejects duplicate, missing, and foreign matches', () => {
  const valid = {
    title: 'Round 2 — Extra time arrives',
    intro: 'Two sentences. The round had a point.',
    matches: [{ matchId: 'a', paragraph: 'Three sentences. It reached 120. That matters.' }, { matchId: 'b', paragraph: 'A paragraph.' }],
    outro: 'Two sentences. Next round should tell us more.',
  };
  assert.deepEqual(validateRoundPressDraft(valid, ['a', 'b']).errors, []);
  assert.equal(parseAndValidateRoundPressDraft(JSON.stringify(valid), ['a', 'b']).draft?.title, valid.title);
  const invalid = validateRoundPressDraft({ ...valid, matches: [{ matchId: 'a', paragraph: 'One.' }, { matchId: 'a', paragraph: 'Two.' }, { matchId: 'foreign', paragraph: 'Three.' }] }, ['a', 'b']);
  assert.ok(invalid.errors.some((error) => error.includes('Duplicate')));
  assert.ok(invalid.errors.some((error) => error.includes('Foreign')));
  assert.ok(invalid.errors.some((error) => error.includes('Missing')));
});

test('validator rejects empty article fields but does not enforce exact sentence counts', () => {
  const result = validateRoundPressDraft({ title: 'Title', intro: 'Short', matches: [{ matchId: 'a', paragraph: 'Short' }], outro: 'Short' }, ['a']);
  assert.deepEqual(result.errors, []);
  assert.equal(validateRoundPressDraft({ ...result.draft, intro: '' }, ['a']).draft, null);
});

test('round summary route rejects unauthenticated callers before loading tournament data', async () => {
  let statusCode = 200;
  let payload: unknown;
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      payload = value;
      return response;
    },
  };
  await appHandler(
    {
      method: 'POST',
      query: { route: 'generate-round-summary' },
      body: { tournamentId: 'tournament', seasonNumber: 1, roundNumber: 2 },
      headers: {},
    } as never,
    response as never,
  );
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: 'Please sign in with Hattrick first.' });
});
