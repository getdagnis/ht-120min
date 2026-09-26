import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXOTIC_HFI_CAMPAIGN_SLUGS,
  EXOTIC_HFI_TOURNAMENTS,
  orderExoticHfiTournaments,
} from '../src/constants/exotic-hfi-campaign';
import { TOURNAMENT_DEFAULT_120MIN_DEFAULTS } from '../src/constants/descriptions';
import { normalizeTournamentSlug } from '../src/utils/tournament-names';

test('the Exotic HFI campaign uses current CountryIDs, stable names, and unique normalized slugs', () => {
  assert.ok(EXOTIC_HFI_TOURNAMENTS.length >= 20);
  assert.equal(new Set(EXOTIC_HFI_CAMPAIGN_SLUGS).size, EXOTIC_HFI_CAMPAIGN_SLUGS.length);
  assert.equal(TOURNAMENT_DEFAULT_120MIN_DEFAULTS.length, 6);

  for (const target of EXOTIC_HFI_TOURNAMENTS) {
    assert.equal(target.countryLimit, String(target.country.countryId));
    assert.equal(target.slug, normalizeTournamentSlug(`exotic-hfi-${target.displayName}`));
    assert.equal(target.name, `Exotic HFI — ${target.displayName} ${target.country.emoji}`);
    assert.ok(TOURNAMENT_DEFAULT_120MIN_DEFAULTS.includes(target.description));
  }

});

test('Exotic HFI home ordering prioritizes active and played cups before the campaign order', () => {
  const noMatches = [];
  const completedRound = (matchCount: number) => ({
    round_number: 1,
    matches: Array.from({ length: matchCount }, () => ({ completed: true, status: 'finished' })),
  });
  const futureRound = (matchCount: number) => ({
    round_number: 2,
    matches: Array.from({ length: matchCount }, () => ({ completed: false, status: 'arranged' })),
  });
  const campaigns = [
    { slug: 'queens-of-the-pacific-cup', rounds: noMatches },
    { slug: 'exotic-hfi-san-marino', rounds: noMatches },
    { slug: 'exotic-hfi-saint-kitts-and-nevis', rounds: [completedRound(1)] },
    { slug: 'exotic-hfi-gibraltar', rounds: [completedRound(2), futureRound(1)] },
    { slug: 'exotic-hfi-liechtenstein', rounds: [completedRound(3), futureRound(1)] },
  ];

  assert.deepEqual(
    orderExoticHfiTournaments(campaigns).map((tournament) => tournament.slug),
    [
      'exotic-hfi-liechtenstein',
      'exotic-hfi-gibraltar',
      'exotic-hfi-saint-kitts-and-nevis',
      'queens-of-the-pacific-cup',
      'exotic-hfi-san-marino',
    ],
  );
});
