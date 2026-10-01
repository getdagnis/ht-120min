import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChallengeableResponse, parseChppChallengeOffers } from '../src/server/api/_lib/chpp-challenges.js';

function challengeableXml(value: 'True' | 'False') {
  return `<?xml version="1.0" encoding="utf-8"?>
<HattrickData>
  <FileName>challenges.xml</FileName>
  <Version>1.6</Version>
  <Team>
    <TeamID>681813</TeamID>
    <TeamName>This bot team is a bot</TeamName>
    <ChallengeableResult>
      <Opponent>
        <IsChallengeable>${value}</IsChallengeable>
        <UserId>1587569</UserId>
        <TeamId>3220504</TeamId>
        <TeamName>'Nduje Amaranto</TeamName>
        <LogoURL>https://example.test/logo.png</LogoURL>
      </Opponent>
    </ChallengeableResult>
  </Team>
</HattrickData>`;
}

test('parses the CHPP 1.6 ChallengeableResult opponent as not challengeable', () => {
  assert.deepEqual(parseChallengeableResponse(challengeableXml('False')).teams, [
    { teamId: 3220504, challengeable: false, reason: undefined },
  ]);
});

test('parses a positive CHPP 1.6 ChallengeableResult opponent', () => {
  assert.deepEqual(parseChallengeableResponse(challengeableXml('True')).teams, [
    { teamId: 3220504, challengeable: true, reason: undefined },
  ]);
});

test('parses incoming challenge offers with challenger, rules, and acceptance state', () => {
  const xml = `<HattrickData>
    <OffersByOthers>
      <Offer>
        <TrainingMatchID>123456</TrainingMatchID>
        <FriendlyType>1</FriendlyType>
        <Opponent><TeamID>2153211</TeamID></Opponent>
        <IsAgreed>False</IsAgreed>
      </Offer>
      <Offer>
        <TrainingMatchID>123457</TrainingMatchID>
        <FriendlyType>0</FriendlyType>
        <Opponent><TeamID>2153212</TeamID></Opponent>
        <IsAgreed>True</IsAgreed>
      </Offer>
    </OffersByOthers>
  </HattrickData>`;

  assert.deepEqual(parseChppChallengeOffers(xml), [
    { opponentTeamId: 2153211, trainingMatchId: 123456, friendlyType: 1, isAgreed: false },
    { opponentTeamId: 2153212, trainingMatchId: 123457, friendlyType: 0, isAgreed: true },
  ]);
});
