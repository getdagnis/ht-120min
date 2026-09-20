import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRealTournamentInsert } from '../src/utils/tournament-creation';

test('real tournament insert defaults remain public, open, CHPP-only, and non-test', () => {
  const row = buildRealTournamentInsert({
    name: 'Exotic HFI — Saint Kitts and Nevis 🇰🇳',
    slug: 'exotic-hfi-saint-kitts-and-nevis',
    scoringMode: '120min',
    leagueCategory: 'hfi',
    registrationType: 'validated',
    adminPassword: 'not-logged',
    isPrivate: false,
    countryLimit: '202',
    description: 'Pressing helps.',
    showDescription: true,
    adminEmail: null,
    maxTeams: null,
    organizerId: 123,
    organizerName: 'Organizer',
    thumbnailIndex: 7,
  });

  assert.deepEqual(row, {
    name: 'Exotic HFI — Saint Kitts and Nevis 🇰🇳',
    slug: 'exotic-hfi-saint-kitts-and-nevis',
    scoring_mode: '120min',
    league_category: 'hfi',
    registration_type: 'validated',
    admin_password: 'not-logged',
    is_private: false,
    country_limit: '202',
    description: 'Pressing helps.',
    show_description: true,
    admin_email: null,
    thumbnail_index: 7,
    max_teams: null,
    season: 1,
    status: 'open',
    is_test: false,
    chpp_only_join: true,
    organizer_id: 123,
    organizer_name: 'Organizer',
  });
});
