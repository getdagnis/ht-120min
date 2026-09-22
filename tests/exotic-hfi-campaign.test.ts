import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXOTIC_HFI_CAMPAIGN_SLUGS,
  EXOTIC_HFI_TOURNAMENTS,
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
