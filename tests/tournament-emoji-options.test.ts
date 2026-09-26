import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTournamentEmojiOptions,
  getTournamentSpecialEmojis,
  TOURNAMENT_EMOJI_OPTIONS,
} from '../src/utils/tournament-emoji-options.ts';

const currentOptions = ['0', '1', '2', '3', '4', '5', '6', '7', 'fallback-a', 'fallback-b'];

test('uses HFI and country emojis as the special tail when both restrictions apply', () => {
  const specials = getTournamentSpecialEmojis({
    leagueCategory: 'hfi',
    countryLimit: '42',
    countryLimitFormat: 'country_id',
  });
  assert.deepEqual(specials, ['💃🏻', '🇭🇷']);
  assert.deepEqual(
    buildTournamentEmojiOptions(currentOptions, {
      leagueCategory: 'hfi',
      countryLimit: '42',
      countryLimitFormat: 'country_id',
    }),
    ['0', '1', '2', '3', '4', '5', '6', '7', '💃🏻', '🇭🇷'],
  );
});

test('uses a country emoji for a country-limited regular tournament', () => {
  assert.deepEqual(
    buildTournamentEmojiOptions(currentOptions, {
      leagueCategory: 'male',
      countryLimit: '42',
      countryLimitFormat: 'country_id',
    }),
    ['0', '1', '2', '3', '4', '5', '6', '7', '🇭🇷', 'fallback-a'],
  );
});

test('keeps the current fallback order when no special restriction exists', () => {
  assert.deepEqual(buildTournamentEmojiOptions(currentOptions), currentOptions);
});

test('puts special emojis in the final two positions of the shared bar', () => {
  const options = buildTournamentEmojiOptions(TOURNAMENT_EMOJI_OPTIONS, {
    leagueCategory: 'hfi',
    countryLimit: '42',
    countryLimitFormat: 'country_id',
  });

  assert.equal(options.length, 10);
  assert.deepEqual(options.slice(0, 8), [...TOURNAMENT_EMOJI_OPTIONS.slice(0, 8)]);
  assert.deepEqual(options.slice(-2), ['💃🏻', '🇭🇷']);
});
