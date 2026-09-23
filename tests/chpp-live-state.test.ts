import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceMatchStatus,
  readLiveMatch,
  readMatchDetailsState,
} from '../src/server/api/_lib/chpp-live-state.ts';
import { mergeLiveMatchData } from '../src/hooks/useLiveMatches.ts';
import { formatLiveMatchStatus, getLiveClockDisplay, getLivePollDelay } from '../shared/live-match.ts';

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
    phase: 'second_half',
    matchPart: 2,
    lastEventMinute: null,
    nextEventMinute: null,
    nextEventMatchPart: null,
    announcedAddedMinutes: null,
    fetchedAt: null,
  });
  assert.equal(readLiveMatch(xml, 456), null);
  assert.equal(readLiveMatch(live(`<MatchID>${matchId}</MatchID><HomeGoals>0</HomeGoals><AwayGoals>0</AwayGoals>`), matchId), null);
});

test('live clock uses the latest reported event, not the next-event hint as the current minute', () => {
  const xml = `<HattrickData><FileName>live.xml</FileName><FetchedDate>2026-09-23 05:36:57</FetchedDate>
    <MatchList><Match><MatchID>${matchId}</MatchID><EventList>
      <Event Index="0"><Minute>0</Minute><MatchPart>0</MatchPart></Event>
      <Event Index="1"><Minute>45</Minute><MatchPart>1</MatchPart></Event>
      <Event Index="2"><Minute>64</Minute><MatchPart>2</MatchPart></Event>
    </EventList><HomeGoals>0</HomeGoals><AwayGoals>0</AwayGoals>
    <NextEventMinute>72</NextEventMinute><NextEventMatchPart>2</NextEventMatchPart>
    </Match></MatchList></HattrickData>`;
  const result = readLiveMatch(xml, matchId);
  assert.equal(result?.phase, 'second_half');
  assert.equal(result?.lastEventMinute, 64);
  assert.equal(result?.nextEventMinute, 72);
  assert.equal(result?.nextEventMatchPart, 2);
  assert.equal(result?.fetchedAt, '2026-09-23 05:36:57');
});

test('live feed extracts added time only from EventKey 75 in the second half', () => {
  const xml = live(`<MatchID>${matchId}</MatchID><EventList>
    <Event><Minute>89</Minute><MatchPart>2</MatchPart><EventKey>75_4</EventKey><EventText>circa 4 minuti</EventText></Event>
  </EventList><HomeGoals>0</HomeGoals><AwayGoals>0</AwayGoals>`);
  assert.equal(readLiveMatch(xml, matchId)?.announcedAddedMinutes, 4);
});

test('local live clock accounts for the halftime pause and announced added time', () => {
  const kickoffMs = Date.UTC(2026, 8, 23, 4, 15);
  assert.equal(getLiveClockDisplay({ kickoffMs, nowMs: kickoffMs + 36 * 60000, phase: 'first_half' }), 'FIRST HALF · 37′');
  assert.equal(getLiveClockDisplay({ kickoffMs, nowMs: kickoffMs + 45 * 60000, phase: 'first_half' }), 'HALF-TIME');
  assert.equal(getLiveClockDisplay({ kickoffMs, nowMs: kickoffMs + 55 * 60000, phase: 'second_half' }), 'SECOND HALF · 46′');
  assert.equal(getLiveClockDisplay({ kickoffMs, nowMs: kickoffMs + 99 * 60000, phase: 'second_half', announcedAddedMinutes: 4 }), 'SECOND HALF · 90′ (+4)');
  assert.equal(getLiveClockDisplay({ kickoffMs, nowMs: kickoffMs + 102 * 60000, phase: 'second_half', announcedAddedMinutes: 4 }), 'SECOND HALF · 90+3′');
});

test('live polling accelerates for late regulation, extra time and penalties', () => {
  assert.equal(getLivePollDelay([{ phase: 'first_half', lastEventMinute: 20 }]), 30000);
  assert.equal(getLivePollDelay([{ phase: 'second_half', lastEventMinute: 86 }]), 5000);
  assert.equal(getLivePollDelay([{ phase: 'extra_time', lastEventMinute: 100 }]), 15000);
  assert.equal(getLivePollDelay([{ phase: 'extra_time', lastEventMinute: 115 }]), 5000);
  assert.equal(getLivePollDelay([{ phase: 'penalties', lastEventMinute: 120 }]), 4000);
});

test('live clock distinguishes first half, half-time, extra time, and penalties', () => {
  const feed = (minute: number, part: number, nextPart?: number) => live(
    `<MatchID>${matchId}</MatchID><EventList><Event><Minute>${minute}</Minute><MatchPart>${part}</MatchPart></Event></EventList>` +
    `<HomeGoals>0</HomeGoals><AwayGoals>0</AwayGoals>` +
    (nextPart ? `<NextEventMatchPart>${nextPart}</NextEventMatchPart>` : ''),
  );
  assert.equal(readLiveMatch(feed(37, 1), matchId)?.phase, 'first_half');
  assert.equal(readLiveMatch(feed(45, 1), matchId)?.phase, 'first_half');
  assert.equal(readLiveMatch(feed(45, 1, 2), matchId)?.phase, 'half_time');
  assert.equal(readLiveMatch(feed(103, 3), matchId)?.phase, 'extra_time');
  assert.equal(readLiveMatch(feed(120, 4), matchId)?.phase, 'penalties');
});

test('fixture badge shows a feed-backed phase and minute, with a safe ongoing fallback', () => {
  assert.equal(formatLiveMatchStatus(), 'ONGOING');
  assert.equal(formatLiveMatchStatus({ phase: 'first_half', lastEventMinute: 37 }), 'FIRST HALF');
  assert.equal(formatLiveMatchStatus({ phase: 'half_time', lastEventMinute: 45 }), 'HALF-TIME');
  assert.equal(formatLiveMatchStatus({ phase: 'second_half', lastEventMinute: 64 }), 'SECOND HALF');
  assert.equal(formatLiveMatchStatus({ phase: 'extra_time', lastEventMinute: 103 }), 'EXTRA TIME');
  assert.equal(formatLiveMatchStatus({ phase: 'penalties', lastEventMinute: 120 }), 'PENALTIES');
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
