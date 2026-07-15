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
- `matchmaker_requests`
- `matchmaker_activity`

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
- `APP_SESSION_SECRET` must be present in production. Do not fall back to `CHPP_CONSUMER_SECRET` for session signing.
- The superadmin bypass cookie is dev-only. Keep its token out of production and do not surface it in the UI.

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
