import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('tournament public builder calculates fixture dates with Home snapshots disabled', () => {
  // Match Next's server-only alias and React server condition, but execute the
  // actual loader/helper. All Supabase requests are intercepted, never live.
  const output = execFileSync(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        if (specifier === 'next/cache') return {url: 'data:text/javascript,' + encodeURIComponent('const entries=new Map(); export const revalidateTag=()=>entries.clear(); export const unstable_cache=(read,keys)=>async()=>{const key=JSON.stringify(keys);if(entries.has(key))return entries.get(key);const value=await read();const size=JSON.stringify(value).length;if(size>1048576)throw new Error("Partition too large");entries.set(key,value);return value;};'), shortCircuit:true};
        return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      } });
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tournament-test.invalid';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test';
      process.env.PUBLIC_HOME_SNAPSHOT_ENABLED = 'false';
      const requests = [];
      let matchesStarted;
      const matchesReady = new Promise(resolve => { matchesStarted = resolve; });
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        const table = url.pathname.split('/').at(-1);
        let data = [];
        if (table === 'tournaments') data = { id: 'cup', season: 1, scoring_mode: '120min', organizer_id: 0 };
        if (table === 'rounds') data = [{ id: 'round', created_at: '2026-10-01T00:00:00Z', round_number: 1 }, { id: 'extra', created_at: '2026-10-02T00:00:00Z', round_number: 2, is_unscored: true }, { id: 'third', created_at: '2026-10-03T00:00:00Z', round_number: 3, is_unscored: true }];
        if (table === 'teams') data = [{ id: 'a', name: 'A', active: true, ht_team_id: 1 }, { id: 'b', name: 'B', active: true, ht_team_id: 2 }];
        if (table === 'tournament_seasons') data = [{ id: 'season', season_number: 1 }];
        if (table === 'tournament_season_slots') {
          // A slow optional slot read must not delay the independent fixture read.
          let timer;
          await Promise.race([matchesReady, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Fixtures blocked behind slots')), 1000); })]).finally(() => clearTimeout(timer));
        }
        if (table === 'matches') {
          matchesStarted();
          data = [{ id: 'match', round_id: 'round', scheduled_for: '2026-10-03T12:00:00Z', completed: true, home_team_id: 'a', away_team_id: 'b', home_goals: 1, away_goals: 0, went_120: true, home_team: null, away_team: null }, { id: 'extra-match', round_id: 'extra', scheduled_for: '2026-10-04T12:00:00Z', completed: true, home_team_id: 'a', away_team_id: 'b', home_goals: 2, away_goals: 0, went_120: true, home_team: null, away_team: null }];
        }
        if (table === 'matches') { data.push({ ...data[1], id: 'third-match', round_id: 'third' }); data = data.map(match => ({ ...match, syntheticRequiredPayload: 'x'.repeat(750000) })); }
        if (table === 'matches') data = data.filter(match => 'eq.' + match.round_id === url.searchParams.get('round_id'));
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      };
      const { buildTournamentInitialData } = await import('./src/app/_data/public-data.ts');
      const result = await buildTournamentInitialData({ id: 'cup', season: 1, scoring_mode: '120min', organizer_id: 0 });
      assert.ok(JSON.stringify(result).length > 2097152);
      assert.equal(result.rounds[0].matches[0].match_date, '2026-10-03T12:00:00.000Z');
      assert.equal(result.rounds[1].is_unscored, true);
      assert.equal(result.standings.find(team => team.teamId === 'a').played, 1);
      await buildTournamentInitialData({ id: 'cup', season: 1, scoring_mode: '120min', organizer_id: 0 }, false);
      const warmReads = requests.length;
      const reads = requests.filter(path => path.endsWith('/matches')).length;
      await buildTournamentInitialData({ id: 'cup', season: 1, scoring_mode: '120min', organizer_id: 0 }, false);
      assert.equal(requests.filter(path => path.endsWith('/matches')).length, reads);
      assert.equal(requests.length, warmReads);
      assert.ok(!requests.some((path) => path.includes('public_snapshots') || path.includes('/rpc/')));
      console.log('PASS');
    `,
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 });
  assert.match(output, /PASS/);
});
