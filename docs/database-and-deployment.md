# Database And Deployment

Supabase stores app-owned tournament, team, match, profile, chat/news, announcement, and matchmaker data. Vercel hosts the frontend and serverless API routes.

## Supabase Model

Important tables used by current code:

- `tournaments`
- `teams`
- `rounds`
- `matches`
- `fixture_predicted_rating_shares` (prepared in 095; public reads, service-role writes)
- `fixture_warnings`
- `profiles`
- `oauth_temp_sessions`
- `tournament_chat`
- `global_chat`
- `news_posts`
- `news_reactions`
- `tournament_announcements`
- `tournament_announcement_dismissals`
- `tournament_seasons`
- `tournament_team_auto_arrange_preferences`
- `tournament_season_comments`
- `matchmaker_requests`
- `matchmaker_activity`
- `activity_events` (private raw Forge telemetry, 90-day retention)
- `activity_daily` (private aggregate activity counters)

The app treats tournaments, rounds, matches, standings, chat, and admin decisions as app-owned state. CHPP data is synced into snapshots or used to reconcile fixtures/results.

## Migration Conventions

- Add schema/RPC changes as migrations under `migrations/`.
- `migrations/history/` is an archived legacy area.
- Active migrations must use the root `migrations/` directory.
- Continue the numeric sequence from the latest active migration.
- The current active sequence includes `092_add_global_chat_flag.sql`, `093_add_profile_national_team_roles.sql`, prepared `094_tournament_team_auto_arrange_preferences.sql`, and prepared `095_fixture_predicted_rating_shares.sql`; the next migration must continue at `096_...sql`. Recheck files before numbering.
- Do not create timestamp-prefixed migration names such as `20261001050614_...`.
- Keep migrations compatible with existing rows when possible.
- Record migration state in `PROJECT_STATE.md` only when a schema/RPC/RLS change has architectural, security, product-direction, or substantial behavioral impact. Do not add status entries for routine fixes or small implementation details.
- Distinguish "migration file exists", "applied locally", "applied to Supabase", and "deployed".
- Do not claim production state unless verified.

Recent important migrations:

- `045_add_penalty_shootout_to_matches.sql`
- `046_add_matchdetails_summary_to_matches.sql`
- `047_add_week15_special_schedule.sql`
- `048_add_schedule_metadata_and_generation_rpc.sql`
- `049_reschedule_tournament_rounds_rpc.sql`
- `050_tournament_announcements.sql`
- `051_correct_week15_week16_weekend_schedule.sql`
- `057_tournament_seasons_history.sql`
- `058_tournament_season_yearbook_comments.sql`
- `059_activity_ledger.sql`
- `073_add_join_story_to_teams.sql`
- `074_add_match_arrange_story.sql`
- `075_create_global_chat.sql`
- `076_add_finished_at_to_matches.sql`
- `082_reset_season_and_vacate_slot.sql`
- `086_allow_reserve_registration.sql` (prepared locally; not applied)
- `088_public_data_publications.sql` (publication foundation; owner reports applied and merged on 2026-10-03; no independent live schema inspection)
- `089_home_snapshot_dependencies.sql` (Home transaction hooks/time-boundary RPC; owner-added applied marker preserved, live application not independently verified)
- `090_home_snapshot_event_dispatch.sql` (prepared only: pg_net post-commit mutation dispatch, one bounded due wake and 15-minute database-local recovery; owner-enabled pg_net/UTC pg_cron/Vault required. Local extension-stub tests are not live integration proof. Activation/grant checks: `docs/public-data-implementation.md`)
- `091_add_match_kit_urls.sql` (prepared only: nullable fixture-side CHPP kit URLs; apply before deploying code that selects these columns)
- `092_add_global_chat_flag.sql` (prepared locally; live application unverified)
- `093_add_profile_national_team_roles.sql` (prepared locally; live application unverified)
- `094_tournament_team_auto_arrange_preferences.sql` (prepared locally: default-on preference keyed by tournament, season, team, and Hattrick manager; live application unverified)

Public publication rollout state, preflight and test boundaries are in
[`public-data-implementation.md`](public-data-implementation.md). Publication artifacts are server-only; the prepared
schema does not replace the existing automatic match producer. Home cached delivery is opt-in and requires explicit publication approval, an independently scheduled protected worker and verified purge coverage; see the linked activation order.

## RLS And Access Assumptions

The current MVP uses permissive policies in several public-facing areas. When changing Supabase access:

- Enable RLS on exposed public tables.
- Prefer explicit `TO anon` / `TO authenticated` policies.
- Do not use `auth.role()` in new policies.
- Do not use user-editable metadata for authorization.
- Be careful with `SECURITY DEFINER`; it can bypass RLS and is public-callable unless privileges are revoked.
- Current-season reset and scheduled-team removal use service-role-only RPCs. The
  consolidated API checks tournament operational access before invoking them;
  browser clients do not write lifecycle, slot, or assignment state directly.
- Remember that Postgres UPDATE policies also need SELECT visibility.

## Vercel Function Limit

The Vercel Hobby plan allows 12 serverless functions. Current count is 12.

The migrated application exposes one consolidated Next.js API route at
`src/app/api/[[...path]]/route.ts`. The former handlers live under
`src/server/api/` and are not standalone root `api/` functions. Keep future
server work behind the consolidated route unless the deployment function
budget is explicitly rechecked.

## Deployment Notes

- Frontend deploys through Vercel.
- Supabase migrations must be applied separately from frontend deployment unless a deployment process explicitly handles them.
- CHPP server routes require server-side CHPP consumer credentials.
- Frontend Supabase access uses `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Service-role and CHPP secrets must stay server-side.
- `SUPABASE_SECRET_KEY` is required for server-authorized writes such as immutable season yearbook comments. Never expose it to browser code.
- `APP_SESSION_SECRET` must be present in production. Do not fall back to `CHPP_CONSUMER_SECRET` for session signing.
- `FORGE_SUPERADMIN_HT_ID` is server-only configuration for the Forge superadmin.
- `ANALYTICS_EXCLUDED_HT_USER_ID` is optional server-only configuration. When its Hattrick ID matches a verified app session, Vercel Web Analytics and internal Forge activity tracking are excluded for that visitor.
- Activity events contain operational metadata, including raw user-agent and IP fields. They are service-role-only tables with no anon/authenticated grants; the Forge stats route is the only application read path and raw events are intended to be removed after 90 days. Authenticated events store the Hattrick manager nickname from `profiles`, and the stats service may associate earlier events from the same visitor cookie with that nickname. Keep raw IP/user-agent values out of Forge UI responses.
- The superadmin bypass cookie is dev-only. Keep its token out of production and do not surface it in the UI.

## Consolidated API Routes

The Vercel function limit is kept at 12 by routing related server operations through counted dispatchers:

- `src/server/api/app.ts`: presence, history, activity ingestion, Forge session, and Forge statistics.
- `src/server/api/testing/index.ts`: the protected CHPP testing toolkit and its historical sub-tools.

Frontend calls should use the existing public `/api/...` contracts. The consolidated App Router adapter dispatches
those paths to `src/server/api/` handlers; `/api/app?route=...` remains the shared dispatcher contract for app-owned
operations that use it.

## Validation

Docs-only checks should confirm the consolidated route handler and run `git diff --check`.

Code changes:

```bash
npm run build
npm test
```

Database changes should also include a clear manual or automated verification path. Update `PROJECT_STATE.md` only when the database change has architectural, security, product-direction, migration-state, or substantial behavioral impact.

## Detailed References

- `PROJECT_STATE.md`
- `AGENTS.md`
- `migrations/`
- `src/server/api/_lib/supabase.ts`
- `src/lib/supabase.ts`
- `docs/schedule-rpc-smoke-test.sql`
