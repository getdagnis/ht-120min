import assert from 'node:assert/strict';
import test from 'node:test';
import { getTournamentForumShareCode, getTournamentShareUrl } from '../src/utils/tournament-share';

test('tournament sharing uses the public host and exact Hattrick forum markup', () => {
  const slug = 'last-5-rounds-of-120-minutes-cup';
  const name = 'Last 5 Rounds of 120 minutes Cup 🏆';
  const url = 'https://ht-120min.vercel.app/t/last-5-rounds-of-120-minutes-cup';

  assert.equal(getTournamentShareUrl(slug), url);
  assert.equal(
    getTournamentForumShareCode(name, slug),
    `[br][q][b]${name}[/b]\nJoin here: [b][link=${url}][/b][/q]`,
  );
});
