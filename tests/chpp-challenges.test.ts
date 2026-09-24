import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChallengeableResponse } from '../src/server/api/_lib/chpp-challenges.js';

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
