# AGENT ONBOARDING

UPDATED: JUNE 26, 2026

Project: **HT-120min**, a React + TypeScript + Vite application for organizing recurring Hattrick friendly tournaments. It integrates with Hattrick CHPP OAuth, uses Supabase for persistence, and Vercel serverless functions for backend operations.

Before changing anything, inspect the project and build a concise mental model.

Read files in this order:

1. `AGENTS.md`

   * Treat its project constraints as mandatory.
   * Pay particular attention to the Vercel serverless-function limit and current function inventory.

2. `PROJECT_STATE.md`

   * Note what is currently working, unfinished, or known to be fragile.

3. `package.json`

   * Confirm scripts, framework versions, and dependencies.

4. `src/App.tsx`

   * Understand routing and major screens.

5. `src/components/Layout/Layout.tsx`

   * Understand app-level mounting, authentication hooks, and global behavior.

6. `src/hooks/useAuth.ts`

   * Understand how the application identifies a logged-in user.
   * Important: this application uses custom Hattrick OAuth and localStorage, not a normal Supabase Auth session.

7. Authentication/backend files:

   * `api/auth/init.ts`
   * `api/auth/callback.ts`
   * `api/auth/complete.ts`
   * `api/_lib/chpp-register.ts`
   * `api/_lib/supabase.ts`
   * `api/_lib/chpp-auth.ts`

8. Tournament data pipeline:

   * `src/pages/Public/TournamentView.tsx`
   * `src/components/TournamentTabs/StandingsView.tsx`
   * `src/components/TeamByline/TeamByline.tsx`
   * `src/components/FixtureCard/FixtureCard.tsx`
   * `src/utils/standings.ts`

9. Fixture logic:

   * `src/components/TournamentTabs/FixturesView.tsx`
   * `api/teams/refresh-fixtures.ts`
   * `src/utils/ht-data.ts`
   * `src/utils/scheduler.ts`

10. Matchmaker/API structure:

* `api/matchmaker/activity.ts`
* other files under `api/matchmaker/`
* `api/testing/index.ts`

1. Database files:

* `supabase-schema.sql`
* all migrations, especially the newest numbered migrations.

Important constraints:

* The app has a hard Vercel function limit of **12 serverless functions**.
* Do not add a 13th function.
* Current deployed functions are:

  * `/api/auth/callback`
  * `/api/auth/complete`
  * `/api/auth/init`
  * `/api/chpp/live-matches`
  * `/api/matchmaker/activity`
  * `/api/matchmaker/publish`
  * `/api/matchmaker/send-challenge`
  * `/api/matchmaker/show-interest`
  * `/api/matchmaker/teams`
  * `/api/teams/info`
  * `/api/teams/refresh-fixtures`
  * `/api/testing/index`
* `api/testing/index.ts` is the most likely candidate to remove or consolidate if a production function is needed.
* Do not weaken Supabase RLS broadly.
* Do not trust a Hattrick user ID supplied from localStorage as authenticated identity.
* Avoid broad refactors. The app has just launched to initial users, so production stability matters more than architectural perfection.
* Keep changes isolated and reversible.
* Do not modify files during this first pass.

Run:

```bash
npm run build
npm run lint
```

Then report:

1. Current architecture in a concise summary.
2. Authentication model and its security limitations.
3. How profile data reaches the standings and `TeamByline`.
4. Current serverless-function structure.
5. Any discrepancies between documentation and actual implementation.
6. Files likely involved in implementing reliable “last seen / online” presence.
7. The smallest safe implementation strategy you would recommend.

Do not implement anything yet. Stop after the investigation report.
