import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import {
  EXOTIC_HFI_CAMPAIGN_SLUGS,
  EXOTIC_HFI_QUEENS_SLUG,
  EXOTIC_HFI_TOURNAMENTS,
} from '../src/constants/exotic-hfi-campaign';
import { buildRealTournamentInsert } from '../src/utils/tournament-creation';

type SeedMode = 'dry-run' | 'apply';

interface TournamentOwnerRow {
  id: string;
  slug: string;
  organizer_id: number | null;
  organizer_name: string | null;
}

function getMode(argv: string[]): SeedMode {
  const modes = argv.filter((argument) => argument === '--dry-run' || argument === '--apply');
  if (modes.length !== 1 || argv.length !== 3) {
    throw new Error('Usage: npm run seed:exotic-hfi -- --dry-run | --apply');
  }
  return modes[0] === '--apply' ? 'apply' : 'dry-run';
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY are required for the Exotic HFI seed.');
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function main() {
  const mode = getMode(process.argv);
  const supabase = getServiceClient();
  const { data: campaignRows, error: campaignError } = await supabase
    .from('tournaments')
    .select('id, slug, organizer_id, organizer_name')
    .in('slug', EXOTIC_HFI_CAMPAIGN_SLUGS);
  if (campaignError) throw campaignError;

  const rowsBySlug = new Map<string, TournamentOwnerRow>(
    ((campaignRows || []) as TournamentOwnerRow[]).map((row) => [row.slug, row]),
  );
  const queens = rowsBySlug.get(EXOTIC_HFI_QUEENS_SLUG);
  const organizerId = Number(queens?.organizer_id) || null;
  if (!queens || !organizerId) {
    throw new Error(`Could not resolve a valid organizer from ${EXOTIC_HFI_QUEENS_SLUG}; refusing to ${mode}.`);
  }

  const { data: organizerProfile, error: organizerError } = await supabase
    .from('profiles')
    .select('manager_name')
    .eq('hattrick_user_id', organizerId)
    .maybeSingle();
  if (organizerError) throw organizerError;
  const organizerName = organizerProfile?.manager_name || queens.organizer_name || null;

  console.log(`Mode: ${mode}`);
  console.log(`Organizer inherited from ${EXOTIC_HFI_QUEENS_SLUG}: ${organizerName || '(unnamed)'} (${organizerId})`);
  console.log(`Guam / Queens: SKIP (existing slug ${queens.slug})`);

  const planned = EXOTIC_HFI_TOURNAMENTS.map((target) => ({ target, existing: rowsBySlug.get(target.slug) }));
  for (const { target, existing } of planned) {
    console.log(
      JSON.stringify({
        country: target.displayName,
        countryId: target.country.countryId,
        leagueId: target.country.leagueId,
        isoCode: target.country.isoCode,
        flag: target.country.emoji,
        name: target.name,
        slug: target.slug,
        countryLimit: target.countryLimit,
        description: target.description,
        organizer: { id: organizerId, name: organizerName },
        existing: existing ? 'already present' : 'missing',
        action: existing ? 'SKIP' : 'CREATE',
      }),
    );
  }

  if (mode === 'dry-run') return;

  for (const { target, existing } of planned) {
    if (existing) continue;
    const { error } = await supabase.from('tournaments').insert(
      buildRealTournamentInsert({
        name: target.name,
        slug: target.slug,
        scoringMode: '120min',
        leagueCategory: 'hfi',
        registrationType: 'validated',
        adminPassword: nanoid(8),
        isPrivate: false,
        countryLimit: target.countryLimit,
        description: target.description,
        showDescription: true,
        adminEmail: null,
        maxTeams: null,
        organizerId,
        organizerName,
      }),
    );
    if (error?.code === '23505') {
      const { data: racedRow, error: racedLookupError } = await supabase
        .from('tournaments')
        .select('slug')
        .eq('slug', target.slug)
        .maybeSingle();
      if (racedLookupError) throw racedLookupError;
      if (racedRow) {
        console.log(`Skipped ${target.slug}; it was created by another run.`);
        continue;
      }
    }
    if (error) {
      throw new Error(`Could not create ${target.slug}: ${error.message}`);
    }
    console.log(`Created ${target.slug}`);
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
