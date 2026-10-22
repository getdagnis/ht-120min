import { createClient } from '@supabase/supabase-js';
import { prepareMatch120mRatings, persistPreparedMatch120mRatings } from '../src/server/api/_lib/match-120m-ratings.js';
import { usesMatch120mRatings } from '../shared/match-120m-rating.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
if (args.some((arg) => !['--apply', '--tournament-id'].includes(arg) && !/^[0-9a-f-]{36}$/i.test(arg)) ||
  args.filter((arg) => arg === '--apply').length > 1) {
  throw new Error('Usage: node --import tsx scripts/backfill-match-120m-ratings.ts [--tournament-id UUID] [--apply]');
}
const tournamentArg = args.indexOf('--tournament-id');
const tournamentId = tournamentArg < 0 ? null : args[tournamentArg + 1];
if (tournamentArg >= 0 && (!tournamentId || !/^[0-9a-f-]{36}$/i.test(tournamentId))) throw new Error('Invalid tournament ID.');
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Service Supabase environment is required.');
const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function pageAll<T>(query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; ; start += 200) {
    const { data, error } = await query(start, start + 199);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 200) return rows;
  }
}

const tournaments = await pageAll<{ id: string; season: number; scoring_mode: string }>((start, end) => {
  let query = supabase.from('tournaments').select('id,season,scoring_mode').order('id').range(start, end);
  if (tournamentId) query = query.eq('id', tournamentId);
  return query;
});
let finished = 0;
let scored = 0;
let missing = 0;
for (const tournament of tournaments.filter((row) => usesMatch120mRatings(row.scoring_mode))) {
  const rounds = await pageAll<{ id: string }>((start, end) => supabase.from('rounds')
    .select('id').eq('tournament_id', tournament.id).eq('season_number', tournament.season).order('id').range(start, end));
  for (const round of rounds) {
    const matches = await pageAll<{ id: string }>((start, end) => supabase.from('matches')
      .select('id').eq('round_id', round.id).eq('completed', true).order('id').range(start, end));
    for (const match of matches) {
      finished += 1;
      const prepared = await prepareMatch120mRatings(supabase, match.id);
      if (!prepared || (!prepared.home && !prepared.away)) { missing += 1; continue; }
      scored += Number(Boolean(prepared.home)) + Number(Boolean(prepared.away));
      if (apply) await persistPreparedMatch120mRatings(supabase, prepared);
    }
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', tournaments: tournaments.length,
  finished_matches: finished, team_ratings: scored, unscored_matches: missing }));
