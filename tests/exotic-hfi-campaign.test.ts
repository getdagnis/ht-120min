import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXOTIC_HFI_CAMPAIGN_SLUGS,
  EXOTIC_HFI_QUEENS_SLUG,
  EXOTIC_HFI_TOURNAMENTS,
  orderExoticHfiTournaments,
} from '../src/constants/exotic-hfi-campaign';
import { TOURNAMENT_DEFAULT_120MIN_DEFAULTS } from '../src/constants/descriptions';
import { normalizeTournamentSlug } from '../src/utils/tournament-names';

test('the Exotic HFI campaign has Queens followed by the requested country order', () => {
  assert.equal(EXOTIC_HFI_CAMPAIGN_SLUGS[0], EXOTIC_HFI_QUEENS_SLUG);
  assert.deepEqual(
    EXOTIC_HFI_TOURNAMENTS.map((target) => target.displayName),
    [
      'Saint Kitts and Nevis',
      'Gibraltar',
      'Liechtenstein',
      'San Marino',
      'Andorra',
      'Faroe Islands',
      'Saint Vincent and the Grenadines',
      'Tahiti',
      'Curaçao',
      'São Tomé e Príncipe',
      'Barbados',
      'Bahamas',
      'Maldives',
      'Bhutan',
      'Cabo Verde',
      'Malta',
      'Suriname',
      'Brunei',
      'Comoros',
      'Trinidad & Tobago',
    ],
  );
});

test('the Exotic HFI campaign uses current CountryIDs, stable names, and unique normalized slugs', () => {
  assert.equal(EXOTIC_HFI_TOURNAMENTS.length, 20);
  assert.equal(new Set(EXOTIC_HFI_CAMPAIGN_SLUGS).size, 21);
  assert.equal(TOURNAMENT_DEFAULT_120MIN_DEFAULTS.length, 6);

  for (const target of EXOTIC_HFI_TOURNAMENTS) {
    assert.equal(target.countryLimit, String(target.country.countryId));
    assert.equal(target.slug, normalizeTournamentSlug(`exotic-hfi-${target.displayName}`));
    assert.equal(target.name, `Exotic HFI — ${target.displayName} ${target.country.emoji}`);
    assert.ok(TOURNAMENT_DEFAULT_120MIN_DEFAULTS.includes(target.description));
  }

  assert.equal(EXOTIC_HFI_TOURNAMENTS[0].slug, 'exotic-hfi-saint-kitts-and-nevis');
  assert.equal(EXOTIC_HFI_TOURNAMENTS[8].slug, 'exotic-hfi-curacao');
  assert.equal(EXOTIC_HFI_TOURNAMENTS[9].slug, 'exotic-hfi-sao-tome-e-principe');
  assert.equal(EXOTIC_HFI_TOURNAMENTS[14].slug, 'exotic-hfi-cabo-verde');
});

test('the Exotic HFI campaign order is preserved independently of source order', () => {
  const ordered = orderExoticHfiTournaments([
    { slug: EXOTIC_HFI_TOURNAMENTS[2].slug },
    { slug: EXOTIC_HFI_QUEENS_SLUG },
    { slug: EXOTIC_HFI_TOURNAMENTS[0].slug },
  ]);

  assert.deepEqual(ordered.map((tournament) => tournament.slug), [
    EXOTIC_HFI_QUEENS_SLUG,
    EXOTIC_HFI_TOURNAMENTS[0].slug,
    EXOTIC_HFI_TOURNAMENTS[2].slug,
  ]);
});
