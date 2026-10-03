import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('tournament loader calculates fixture dates with Home snapshots disabled', () => {
  // Match Next's server-only alias and React server condition, but execute the
  // actual loader/helper. All Supabase requests are intercepted, never live.
  const output = execFileSync(process.execPath, [
    '--conditions=react-server', '--import', 'tsx', '--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      registerHooks({ resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'server-only' ? 'next/dist/compiled/server-only/empty.js' : specifier, context);
      } });
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tournament-test.invalid';
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test';
      process.env.PUBLIC_HOME_SNAPSHOT_ENABLED = 'false';
      const requests = [];
      globalThis.fetch = async (input) => {
        const url = new URL(String(input));
        requests.push(url.pathname);
        const table = url.pathname.split('/').at(-1);
        let data = [];
        if (table === 'tournaments') data = { id: 'cup', season: 1, scoring_mode: '120min', organizer_id: 0 };
        if (table === 'rounds') data = [{ id: 'round', created_at: '2026-10-01T00:00:00Z', round_number: 1 }];
        if (table === 'matches') data = [{ id: 'match', round_id: 'round', scheduled_for: '2026-10-03T12:00:00Z', completed: false, home_team: null, away_team: null }];
        return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
      };
      const { loadTournamentInitialData } = await import('./src/app/_data/public-data.ts');
      const result = await loadTournamentInitialData('cup');
      assert.equal(result.rounds[0].matches[0].match_date, '2026-10-03T12:00:00.000Z');
      assert.ok(!requests.some((path) => path.includes('public_snapshots') || path.includes('/rpc/')));
      console.log('PASS');
    `,
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 15_000 });
  assert.match(output, /PASS/);
});
