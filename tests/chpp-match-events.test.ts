import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPenaltyShootoutScore,
  mapMatchEventDetailsToFixture,
  parseMatchEventDetails,
  summarizeMatchEventDetails,
} from '../api/_lib/chpp-match-events';

function matchDetailsXml({ injuries = '', events = '' }: { injuries?: string; events?: string }) {
  return `
    <HattrickData>
      <Match>
        <HomeTeam><HomeTeamID>100</HomeTeamID></HomeTeam>
        <AwayTeam><AwayTeamID>200</AwayTeamID></AwayTeam>
        <Injuries>${injuries}</Injuries>
        <EventList>${events}</EventList>
      </Match>
    </HattrickData>
  `;
}

function event(
  typeId: number,
  teamId: number,
  playerId: number,
  minute: number,
  objectPlayerId = 0,
  matchPart = 2,
) {
  return `
    <Event>
      <Minute>${minute}</Minute>
      <SubjectPlayerID>${playerId}</SubjectPlayerID>
      <SubjectTeamID>${teamId}</SubjectTeamID>
      <ObjectPlayerID>${objectPlayerId}</ObjectPlayerID>
      <MatchPart>${matchPart}</MatchPart>
      <EventTypeID>${typeId}</EventTypeID>
    </Event>
  `;
}

function injury(teamId: number, playerId: number, type: number, minute: number) {
  return `
    <Injury>
      <InjuryPlayerID>${playerId}</InjuryPlayerID>
      <InjuryTeamID>${teamId}</InjuryTeamID>
      <InjuryType>${type}</InjuryType>
      <InjuryMinute>${minute}</InjuryMinute>
      <MatchPart>2</MatchPart>
    </Injury>
  `;
}

test('retains all yellow cards and their nasty-play or cheating subtype', () => {
  const xml = matchDetailsXml({ events: `
    ${event(511, 200, 1, 37)}
    ${event(510, 200, 2, 42)}
    ${event(511, 200, 3, 48)}
  ` });

  const parsed = parseMatchEventDetails(xml);
  const summary = summarizeMatchEventDetails(parsed);

  assert.equal(summary.away_yellow_cards, 3);
  assert.equal(summary.away_red_cards, 0);
  assert.equal(summary.away_injuries, 0);
  assert.deepEqual(parsed.away.cards.map((card) => card.reason), ['cheating', 'nasty_play', 'cheating']);
  assert.deepEqual(parsed.away.cards.map((card) => card.type), ['yellow', 'yellow', 'yellow']);
});

test('retains InjuryType 1 as a plaster and records its body location', () => {
  const xml = matchDetailsXml({
    injuries: injury(200, 7, 1, 34),
    events: `
    ${event(415, 200, 7, 34)}
    `,
  });

  const parsed = parseMatchEventDetails(xml);
  const matchInjury = parsed.away.injuries[0];

  assert.equal(matchInjury.severity, 'plaster');
  assert.equal(matchInjury.minute, 34);
  assert.equal(matchInjury.locationEventTypeId, 415);
  assert.equal(matchInjury.weeks, null);
});

test('retains an injury duration from the location event and prefers the doctor report', () => {
  const xml = matchDetailsXml({
    injuries: injury(100, 9, 2, 78),
    events: `
      ${event(406, 100, 9, 78, 4)}
      ${event(454, 100, 6, 78)}
    `,
  });

  const parsed = parseMatchEventDetails(xml);
  const matchInjury = parsed.home.injuries[0];

  assert.equal(matchInjury.severity, 'injury');
  assert.equal(matchInjury.locationEventTypeId, 406);
  assert.equal(matchInjury.weeks, 6);
});

test('records a foul-related injury without interpreting localized event text', () => {
  const xml = matchDetailsXml({
    injuries: injury(200, 12, 2, 63),
    events: `
      ${event(406, 200, 12, 63, 4)}
      ${event(423, 200, 12, 63)}
    `,
  });

  const parsed = parseMatchEventDetails(xml);
  const matchInjury = parsed.away.injuries[0];

  assert.equal(matchInjury.causedByFoul, true);
  assert.equal(matchInjury.causedByTeamId, 100);
});

test('captures second-yellow and straight-red distinctions without removing first yellows', () => {
  const xml = matchDetailsXml({ events: `
    ${event(510, 100, 1, 10)}
    ${event(512, 100, 1, 44)}
    ${event(514, 200, 2, 55)}
  ` });
  const parsed = parseMatchEventDetails(xml);
  const summary = summarizeMatchEventDetails(parsed);

  assert.deepEqual(parsed.home.cards.map((card) => card.type), ['yellow', 'second_yellow_red']);
  assert.equal(parsed.home.cards[1]?.reason, 'nasty_play');
  assert.equal(parsed.away.cards[0]?.type, 'straight_red');
  assert.equal(summary.home_yellow_cards, 1);
  assert.equal(summary.home_red_cards, 1);
  assert.equal(summary.away_red_cards, 1);
});

test('maps event details to scheduled fixture sides and leaves an unmatched BYE side empty', () => {
  const xml = matchDetailsXml({ events: event(510, 100, 1, 42) });
  const parsed = parseMatchEventDetails(xml);

  const reversed = mapMatchEventDetailsToFixture(parsed, 200, 100);
  assert.equal(reversed.home.cards.length, 0);
  assert.equal(reversed.away.cards.length, 1);

  const bye = mapMatchEventDetailsToFixture(parsed, null, 100);
  assert.equal(bye.home.cards.length, 0);
  assert.equal(bye.away.cards.length, 1);
});

test('retains regular, other, and penalty-shootout scoring evidence', () => {
  const xml = matchDetailsXml({
    events: `
      ${event(121, 100, 1, 50)}
      ${event(140, 200, 2, 108, 0, 3)}
      ${event(55, 100, 3, 121, 0, 4)}
      ${event(56, 100, 4, 122, 0, 4)}
      ${event(57, 200, 5, 123, 0, 4)}
    `,
  });
  const parsed = parseMatchEventDetails(xml);
  const shootout = getPenaltyShootoutScore(parsed);

  assert.deepEqual(parsed.home.goals?.map((goal) => goal.category), ['regular']);
  assert.deepEqual(parsed.away.goals?.map((goal) => goal.category), ['other']);
  assert.equal(parsed.away.goals?.[0]?.matchPart, 3);
  assert.equal(parsed.hasPenaltyShootout, true);
  assert.deepEqual(shootout, { home: 2, away: 1 });
});
