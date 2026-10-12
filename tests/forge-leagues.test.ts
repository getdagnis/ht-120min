import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  formatForgeLeagueOutreachMessage,
  getForgeOutreachStatus,
  managerMessageHref,
  type ForgeLeagueTeam,
  type ForgeOutreachCampaign,
  type ForgeOutreachContact,
} from '../src/utils/forge-leagues';
import { parseLeagueTeam } from '../src/server/api/testing/_lib/league-xml';
import { snapshotInput } from '../src/server/api/testing/leagues';
import { getCountryFlagEmoji, getCountryTooltip } from '../src/utils/ht-data';

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
    "Hello mANAGER NAME, we'd love to see [b]Team name 🇱🇻[/b]!",
  );
});

test('team details include manager supporter tier and last login', () => {
  const xml = readFileSync('docs/teamdetails.example.xml', 'utf8');
  const parsed = parseLeagueTeam(xml, 3000, 3220518);
  assert.equal(parsed?.supporterTier, 'gold');
  assert.equal(parsed?.managerCountryId, 48);
  assert.equal(parsed?.lastLoginDate, '2026-06-01 13:11:21');
});

test('saved league snapshots retain manager details and accept older snapshots', () => {
  const snapshot = {
    teams: [{
      ...team,
      managerCountryId: 48,
      supporterTier: 'platinum',
      lastLoginDate: '2026-10-11 16:12:20',
    }],
    populatedAt: '2026-10-12T20:00:00.000Z',
    availabilityAt: '2026-10-12T20:01:00.000Z',
    populationComplete: true,
    job: null,
  };
  const saved = snapshotInput(snapshot);
  assert.equal(saved?.teams[0].managerCountryId, 48);
  assert.equal(saved?.teams[0].supporterTier, 'platinum');
  assert.equal(saved?.teams[0].lastLoginDate, '2026-10-11 16:12:20');

  const legacy = snapshotInput({
    ...snapshot,
    teams: [{ ...team }],
  });
  assert.equal(legacy?.teams[0].managerCountryId, null);
  assert.equal(legacy?.teams[0].supporterTier, null);
  assert.equal(legacy?.teams[0].lastLoginDate, null);
});

test('country tooltip resolves CountryID separately from the world-details LeagueID', () => {
  assert.equal(getCountryTooltip(48), '🇱🇻 Latvija / Latvia');
  assert.equal(getCountryTooltip(48, 1147), '🇱🇻 Latvija / Latvia (1147 active teams)');
  assert.equal(getCountryTooltip(null, null, 'Latvija'), '🇱🇻 Latvija / Latvia');
  assert.equal(getCountryFlagEmoji(null), '');
  assert.equal(getCountryFlagEmoji(135), '🇮🇶');
});

test('outreach status disables a same-campaign manager across multiple listed teams and names prior campaigns', () => {
  const campaigns: ForgeOutreachCampaign[] = [
    { id: 'current', name: 'Around the World in One Twenty', campaignDate: '2026-10-12' },
    { id: 'previous', name: 'exotic hfi tahiti', campaignDate: '2026-09-28' },
  ];
  const contacts: ForgeOutreachContact[] = [
    { campaignId: 'current', managerId: 123456 },
    { campaignId: 'previous', managerId: 987654 },
    { campaignId: 'previous', managerId: 123456 },
  ];

  // Both team rows for one manager resolve through manager ID, not team ID.
  const sameManagerTeams = [{ teamId: 1, managerId: 123456 }, { teamId: 2, managerId: 123456 }];
  assert.deepEqual(sameManagerTeams.map(({ managerId }) => getForgeOutreachStatus('current', managerId, campaigns, contacts).contacted), [true, true]);
  assert.deepEqual(getForgeOutreachStatus('current', 123456, campaigns, contacts).previousCampaignNames, ['exotic hfi tahiti']);
  assert.deepEqual(getForgeOutreachStatus('current', 987654, campaigns, contacts).previousCampaignNames, ['exotic hfi tahiti']);
  assert.equal(getForgeOutreachStatus('current', 456789, campaigns, contacts).contacted, false);
});
