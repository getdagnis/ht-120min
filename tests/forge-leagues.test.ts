import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  formatForgeLeagueOutreachMessage,
  managerMessageHref,
  type ForgeLeagueTeam,
} from '../src/utils/forge-leagues';
import { parseLeagueTeam } from '../src/server/api/testing/_lib/league-xml';

const team: ForgeLeagueTeam = {
  teamId: 1,
  teamName: 'Team name',
  managerId: 123456,
  managerName: 'Manager name',
  countryId: 48,
  booked: null,
  inCup: null,
  checkedAt: null,
  error: null,
};

test('manager message link opens a new Hattrick message for the selected manager', () => {
  assert.equal(
    managerMessageHref(123456),
    'https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=123456',
  );
});

test('outreach template substitutes team name, manager name, and country flag', () => {
  assert.equal(
    formatForgeLeagueOutreachMessage(
      "Hello {managerName}, we'd love to see [b]{teamName} {teamFlag}[/b]!",
      { ...team, managerName: 'mANAGER NAME' },
      '🇱🇻',
    ),
    "Hello Manager name, we'd love to see [b]Team name 🇱🇻[/b]!",
  );
});

test('team details include manager supporter tier and last login', () => {
  const xml = readFileSync('docs/teamdetails.example.xml', 'utf8');
  const parsed = parseLeagueTeam(xml, 3000, 3220518);
  assert.equal(parsed?.supporterTier, 'gold');
  assert.equal(parsed?.managerCountryId, 48);
  assert.equal(parsed?.lastLoginDate, '2026-06-01 13:11:21');
});
