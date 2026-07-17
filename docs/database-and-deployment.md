# Database And Deployment

Supabase stores app-owned tournament, team, match, profile, chat/news, announcement, and matchmaker data. Vercel hosts the frontend and serverless API routes.

## Supabase Model

Important tables used by current code:

- `tournaments`
- `teams`
- `rounds`
- `matches`
- `fixture_warnings`
- `profiles`
- `oauth_temp_sessions`
- `tournament_chat`
- `news_posts`
- `news_reactions`
- `tournament_announcements`
- `tournament_announcement_dismissals`
- `tournament_seasons`
- `tournament_season_comments`
- `matchmaker_requests`
- `matchmaker_activity`
- `activity_events` (private raw Forge telemetry, 90-day retention)
- `activity_daily` (private aggregate activity counters)

The app treats tournaments, rounds, matches, standings, chat, and admin decisions as app-owned state. CHPP data is synced into snapshots or used to reconcile fixtures/results.

## Migration Conventions

- Add schema/RPC changes as migrations under `migrations/`.
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

## RLS And Access Assumptions

The current MVP uses permissive policies in several public-facing areas. When changing Supabase access:

- Enable RLS on exposed public tables.
- Prefer explicit `TO anon` / `TO authenticated` policies.
- Do not use `auth.role()` in new policies.
- Do not use user-editable metadata for authorization.
- Be careful with `SECURITY DEFINER`; it can bypass RLS and is public-callable unless privileges are revoked.
- Remember that Postgres UPDATE policies also need SELECT visibility.

## Vercel Function Limit

The Vercel Hobby plan allows 12 serverless functions. Current count is 12.

Every `.ts` file in `api/` outside `_lib/` counts. Files in `api/_lib/` do not.

Before API work:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
```

Do not add new counted functions unless another function is removed or consolidated.

Current counted functions are listed in `AGENTS.md`.

## Deployment Notes

- Frontend deploys through Vercel.
- Supabase migrations must be applied separately from frontend deployment unless a deployment process explicitly handles them.
- CHPP server routes require server-side CHPP consumer credentials.
- Frontend Supabase access uses public Vite env variables.
- Service-role and CHPP secrets must stay server-side.
- `SUPABASE_SECRET_KEY` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) is required for server-authorized writes such as immutable season yearbook comments. Never prefix it with `VITE_` or expose it to browser code.
- `APP_SESSION_SECRET` must be present in production. Do not fall back to `CHPP_CONSUMER_SECRET` for session signing.
- `FORGE_SUPERADMIN_HT_ID` is server-only configuration for the Forge superadmin. Do not use a `VITE_` value as the production source of authorization.
- Activity events contain operational metadata, including raw user-agent and IP fields. They are service-role-only tables with no anon/authenticated grants; the Forge stats route is the only application read path and raw events are intended to be removed after 90 days. Authenticated events store the Hattrick manager nickname from `profiles`, and the stats service may associate earlier events from the same visitor cookie with that nickname. Keep raw IP/user-agent values out of Forge UI responses.
- The superadmin bypass cookie is dev-only. Keep its token out of production and do not surface it in the UI.

## Consolidated API Routes

The Vercel function limit is kept at 12 by routing related server operations through counted dispatchers:

- `api/app.ts`: presence, history, activity ingestion, Forge session, and Forge statistics.
- `api/testing/index.ts`: the protected CHPP testing toolkit and its historical sub-tools.

Frontend calls should use the dispatcher query routes or the rewrites in `vercel.json`; do not recreate the removed standalone presence/history functions without checking the function count.

## Validation

Docs-only:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
git diff --check
```

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
- `api/_lib/supabase.ts`
- `src/lib/supabase.ts`
- `docs/schedule-rpc-smoke-test.sql`
