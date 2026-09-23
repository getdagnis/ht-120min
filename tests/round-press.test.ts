import assert from 'node:assert/strict';
import test from 'node:test';

import appHandler from '../src/server/api/app.js';
import { buildRoundPressInput, type RoundPressMatchSource, type RoundPressRoundSource, type RoundPressTeamSource } from '../src/server/api/_lib/round-press-input.js';
import { parseAndValidateRoundPressDraft, validateRoundPressDraft } from '../src/server/api/_lib/round-press-validator.js';
import {
  CloudflareAiConfigurationError,
  CloudflareAiTemporarilyUnavailableError,
  CLOUDFLARE_ROUND_PRESS_MODEL,
  generateCloudflareRoundPressDraft,
} from '../src/server/api/_lib/round-press-cloudflare-writer.js';
import { generateConfiguredRoundPressDraft, resolveRoundPressProvider } from '../src/server/api/_lib/round-press-provider.js';
import { GeminiTemporarilyUnavailableError, generateRoundPressDraft } from '../src/server/api/_lib/round-press-writer.js';

const home: RoundPressTeamSource = { id: 'home', name: 'Home FC', ht_team_id: 1 };
const away: RoundPressTeamSource = { id: 'away', name: 'Away FC', ht_team_id: 2 };

function writerInput() {
  return buildRoundPressInput({
    tournament: { id: 'tournament', name: 'Cup', scoringMode: '120min' },
    seasonNumber: 1,
    roundNumber: 2,
    rounds: [{ id: 'round-2', round_number: 2, matches: [match('match-2', 'round-2')] }],
    teams: [home, away],
  });
}

function validDraft(matchId = 'match-2') {
  return JSON.stringify({
    title: 'Round 2 — Extra time arrives',
    intro: 'The round revealed something useful.',
    matches: [{ matchId, paragraph: 'The match reached 120 minutes and that shaped the story.' }],
    outro: 'The next round should show whether this was adaptation or coincidence.',
  });
}

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

test('round input places misarranged fixtures after played fixtures', () => {
  const played = match('played', 'round-2');
  const misarranged = { ...match('misarranged', 'round-2'), completed: false, status: 'misarranged' };
  const input = buildRoundPressInput({
    tournament: { id: 'tournament', name: 'Cup', scoringMode: '120min' },
    seasonNumber: 1,
    roundNumber: 2,
    rounds: [{ id: 'round-2', round_number: 2, matches: [misarranged, played] }],
    teams: [home, away],
  });
  assert.deepEqual(input.matches.map((item) => item.matchId), ['played', 'misarranged']);
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
      injuries: [{ playerId: 45, playerName: 'Injured Player', minute: 55, matchPart: 2, injuryType: 2, severity: 'injury', locationEventTypeId: 401, weeks: 3, causedByFoul: false, causedByTeamId: null }],
      goals: [{ eventTypeId: 101, playerId: 46, playerName: 'Scoring Player', minute: 22, matchPart: 1, category: 'regular' }],
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
  assert.equal(input.matches[0].homeFacts.injuries[0].playerName, 'Injured Player');
  assert.equal(input.matches[0].homeFacts.goals[0].minute, 22);
  assert.equal(input.matches[0].homeFacts.goals[0].playerName, 'Scoring Player');
});

test('round input retains version 2 result semantics and performance facts', () => {
  const source = match('match-2', 'round-2');
  source.match_event_details = {
    version: 2,
    source: 'matchdetails-3.1',
    actualHomeTeamId: 1,
    actualAwayTeamId: 2,
    hasPenaltyShootout: true,
    result: {
      scoreAfterRegulation: { home: 0, away: 0 },
      scoreAfterExtraTime: { home: 0, away: 0 },
      penaltyShootout: { home: 3, away: 2 },
      decisionType: 'penalty_shootout',
      winnerTeamId: 1,
      reached120: true,
    },
    home: {
      teamId: 1,
      cards: [], injuries: [], goals: [], penaltyShootoutGoals: 3,
      performance: {
        formation: '5-5-0', tacticType: 1, tacticName: 'Pressing', tacticSkill: 7,
        possessionFirstHalf: 50, possessionSecondHalf: 51,
        ratings: { midfield: 10, rightDefence: 20, centralDefence: 21, leftDefence: 20, rightAttack: 3, centralAttack: 2, leftAttack: 3 },
        chances: { left: 1, centre: 2, right: 3, specialEvents: 0, other: 1 },
      },
    },
    away: { teamId: 2, cards: [], injuries: [], goals: [], penaltyShootoutGoals: 2 },
  };
  const input = buildRoundPressInput({
    tournament: { id: 'tournament', name: 'Cup', scoringMode: '120min' },
    seasonNumber: 1,
    roundNumber: 2,
    rounds: [{ id: 'round-2', round_number: 2, matches: [source] }],
    teams: [home, away],
  });
  assert.deepEqual(input.matches[0].result.scoreAfterExtraTime, { home: 0, away: 0 });
  assert.equal(input.matches[0].result.decisionType, 'penalty_shootout');
  assert.equal(input.matches[0].homeFacts.performance?.tacticName, 'Pressing');
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

test('Gemini 503 retries with backoff and succeeds', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let attempts = 0;
  const delays: number[] = [];
  try {
    const result = await generateRoundPressDraft(writerInput(), {
      generateContent: async () => {
        attempts += 1;
        if (attempts < 3) throw Object.assign(new Error('high demand'), { status: 503 });
        return { text: validDraft() };
      },
      sleep: async (milliseconds) => delays.push(milliseconds),
    });
    assert.equal(result.repaired, false);
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [1000, 2000]);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('repeated Gemini 503 failures become a typed temporary-unavailability error', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let attempts = 0;
  try {
    await assert.rejects(
      generateRoundPressDraft(writerInput(), {
        generateContent: async () => {
          attempts += 1;
          throw Object.assign(new Error('high demand'), { status: 503 });
        },
        sleep: async () => undefined,
      }),
      (error: unknown) => error instanceof GeminiTemporarilyUnavailableError,
    );
    assert.equal(attempts, 3);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('Gemini 401 is not retried', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let attempts = 0;
  const failure = Object.assign(new Error('unauthorized'), { status: 401 });
  try {
    await assert.rejects(
      generateRoundPressDraft(writerInput(), {
        generateContent: async () => {
          attempts += 1;
          throw failure;
        },
        sleep: async () => undefined,
      }),
      (error: unknown) => error === failure,
    );
    assert.equal(attempts, 1);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('structured-output repair remains one additional generation after a valid transport response', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  let attempts = 0;
  try {
    const result = await generateRoundPressDraft(writerInput(), {
      generateContent: async () => {
        attempts += 1;
        return { text: attempts === 1 ? '{"title":"missing fields"}' : validDraft() };
      },
      sleep: async () => undefined,
    });
    assert.equal(result.repaired, true);
    assert.equal(attempts, 2);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('Cloudflare writer sends the shared prompt and exact deterministic input, then validates its response', async () => {
  const input = writerInput();
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const result = await generateCloudflareRoundPressDraft(input, {
    accountId: 'account-id',
    apiToken: 'token',
    fetch: async (url, init) => {
      requestUrl = url;
      requestInit = init;
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { response: JSON.parse(validDraft()) } }),
      };
    },
  });
  assert.equal(requestUrl, `https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/${CLOUDFLARE_ROUND_PRESS_MODEL}`);
  assert.equal(requestInit?.method, 'POST');
  assert.equal((requestInit?.headers as Record<string, string>).Authorization, 'Bearer token');
  const body = JSON.parse(String(requestInit?.body)) as { messages: Array<{ content: string }>; reasoning_effort: string; response_format: { type: string } };
  assert.equal(body.messages[1]?.content, JSON.stringify(input));
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(result.draft.title, 'Round 2 — Extra time arrives');
  assert.equal(result.repaired, false);
});

test('Cloudflare 429 and 5xx become typed temporary-unavailability errors', async () => {
  for (const status of [429, 500]) {
    await assert.rejects(
      generateCloudflareRoundPressDraft(writerInput(), {
        accountId: 'account-id',
        apiToken: 'token',
        fetch: async () => ({ ok: false, status, json: async () => ({ success: false, errors: [{ message: 'capacity' }] }) }),
      }),
      (error: unknown) => error instanceof CloudflareAiTemporarilyUnavailableError,
    );
  }
});

test('Cloudflare writer fails clearly when server configuration is missing', async () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_AI_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_AI_API_TOKEN;
  try {
    await assert.rejects(
      generateCloudflareRoundPressDraft(writerInput()),
      (error: unknown) => error instanceof CloudflareAiConfigurationError,
    );
  } finally {
    if (accountId === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = accountId;
    if (token === undefined) delete process.env.CLOUDFLARE_AI_API_TOKEN;
    else process.env.CLOUDFLARE_AI_API_TOKEN = token;
  }
});

test('Cloudflare 401 is treated as a server configuration failure', async () => {
  await assert.rejects(
    generateCloudflareRoundPressDraft(writerInput(), {
      accountId: 'account-id',
      apiToken: 'token',
      fetch: async () => ({ ok: false, status: 401, json: async () => ({ success: false, errors: [{ message: 'unauthorized' }] }) }),
    }),
    (error: unknown) => error instanceof CloudflareAiConfigurationError,
  );
});

test('configured writer selects Cloudflare and defaults to Gemini when provider is absent', async () => {
  const cloudflare = await generateConfiguredRoundPressDraft(writerInput(), {
    providerValue: 'cloudflare',
    generateCloudflare: async () => ({ draft: JSON.parse(validDraft()), repaired: false }),
  });
  assert.equal(cloudflare.provider, 'cloudflare');
  assert.equal(cloudflare.model, CLOUDFLARE_ROUND_PRESS_MODEL);

  const defaultProvider = resolveRoundPressProvider('');
  assert.equal(defaultProvider, 'gemini');
  const gemini = await generateConfiguredRoundPressDraft(writerInput(), {
    providerValue: '',
    generateGemini: async () => ({ draft: JSON.parse(validDraft()), repaired: false }),
  });
  assert.equal(gemini.provider, 'gemini');
});
