import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMatchStatus,
  readLiveMatch,
  readMatchDetailsState,
} from '../src/server/api/_lib/chpp-live-state.ts';
import { mergeLiveMatchData } from '../src/hooks/useLiveMatches.ts';

const matchId = 771594762;
const details = (body: string) => `<HattrickData><FileName>matchdetails.xml</FileName><Match><MatchID>${matchId}</MatchID>${body}</Match></HattrickData>`;
const live = (body: string) => `<HattrickData><FileName>live.xml</FileName><MatchList><Match>${body}</Match></MatchList></HattrickData>`;

test('in-progress MatchDetails without status or result is unknown, not arranged', () => {
  assert.equal(readMatchDetailsState(details('<MatchDate>2026-09-23 04:15:00</MatchDate>'), matchId), 'unknown');
  assert.equal(readMatchDetailsState(details('<MatchStatus> 1 </MatchStatus>'), matchId), 'ongoing');
  assert.equal(readMatchDetailsState(details('<FinishedDate>2026-09-23 06:30:00</FinishedDate><HomeGoals>1</HomeGoals><AwayGoals>0</AwayGoals>'), matchId), 'finished');
  assert.equal(readMatchDetailsState(details('<MatchStatus>2</MatchStatus>'), matchId), 'unknown');
  assert.equal(readMatchDetailsState('<HattrickData><Error>Unavailable</Error></HattrickData>', matchId), 'unknown');
});

test('live feed selects the requested match and its current score', () => {
  const xml = `<HattrickData><FileName>live.xml</FileName><MatchList>
    <Match><MatchID>123</MatchID><HomeGoals>9</HomeGoals><AwayGoals>9</AwayGoals><MatchPart>1</MatchPart></Match>
    <Match><MatchID>${matchId}</MatchID><EventList><Event><MatchPart>2</MatchPart></Event></EventList><HomeGoals>0</HomeGoals><AwayGoals>1</AwayGoals></Match>
  </MatchList></HattrickData>`;
  assert.deepEqual(readLiveMatch(xml, matchId), {
    xml: `<MatchID>${matchId}</MatchID><EventList><Event><MatchPart>2</MatchPart></Event></EventList><HomeGoals>0</HomeGoals><AwayGoals>1</AwayGoals>`,
    homeGoals: 0,
    awayGoals: 1,
  });
  assert.equal(readLiveMatch(xml, 456), null);
  assert.equal(readLiveMatch(live(`<MatchID>${matchId}</MatchID><HomeGoals>0</HomeGoals><AwayGoals>0</AwayGoals>`), matchId), null);
});

test('unknown or stale observations never regress an ongoing or finished match', () => {
  assert.equal(advanceMatchStatus('ongoing', 'unknown'), 'ongoing');
  assert.equal(advanceMatchStatus('ongoing', 'arranged'), 'ongoing');
  assert.equal(advanceMatchStatus('finished', 'ongoing'), 'finished');
  assert.equal(advanceMatchStatus('arranged', 'ongoing'), 'ongoing');
  assert.equal(advanceMatchStatus('ongoing', 'finished'), 'finished');
});

test('same-score polls replace the full live snapshot, including cards', () => {
  const previous = { '123': { status: 'ongoing' as const, homeGoals: 0, awayGoals: 0, home_yellow_cards: 0 } };
  const current = { '123': { status: 'ongoing' as const, homeGoals: 0, awayGoals: 0, home_yellow_cards: 1 } };
  assert.deepEqual(mergeLiveMatchData(previous, current), current);
});
