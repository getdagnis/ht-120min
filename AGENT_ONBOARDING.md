# AGENT_ONBOARDING.md

Last updated: 2026-08-30

This is a short orientation map, not a second source of truth. Read `AGENTS.md`
for operating rules and `PROJECT_STATE.md` for current status. Do not duplicate
those documents here.

## Start here

1. `package.json` — scripts, framework, and version.
2. `README.md` — human setup and product overview.
3. `PROJECT_STATE.md` — implementation, migration, validation, and deployment state.
4. `src/app/(public)/[locale]/layout.tsx` — localized Next public shell.
5. `src/app/(public)/[locale]/t/[slug]/page.tsx` — public tournament entry point.
6. `src/components/Layout/Layout.tsx` — shared navigation and identity controls.
7. `src/legacy-pages/Public/TournamentView.tsx` — interactive tournament tabs and admin workspace.

The public app is owned by Next.js App Router. React Router remains inside the
deferred Forge subsystem only. All API contracts are dispatched through
`src/app/api/[[...path]]/route.ts`; implementation belongs under
`src/server/api/` and shared server helpers under `src/server/api/_lib/`.

## Read by task

- Public shell, components, or page ownership: `docs/architecture.md`
- CHPP, OAuth, match refresh, or date parsing: `docs/chpp.md` and `docs/AGENTS_CHPP_INTEGRATION.md`
- Schedules, fixture dates, rounds, or BYEs: `docs/scheduling.md`
- Supabase, migrations, RLS, or deployment: `docs/database-and-deployment.md`
- Product direction: `ROADMAP.md`

Relevant implementation areas:

- Auth: `src/hooks/useAuth.ts`, `src/server/api/auth/`
- Tournament page: `src/legacy-pages/Public/TournamentView.tsx`
- Create flow: `src/legacy-pages/Create/CreateTournament.tsx`
- API dispatcher: `src/app/api/[[...path]]/route.ts`
- CHPP refresh: `src/server/api/teams/refresh-fixtures.ts`, `src/server/api/chpp/live-matches.ts`
- Scheduling utilities: `src/utils/hattrick-calendar.ts`, `src/utils/schedule-draft.ts`, `src/utils/reschedule-draft.ts`, `src/utils/match-schedule.ts`
- Domain utilities: `src/utils/standings.ts`, `src/utils/season-history.ts`, `src/utils/team-eligibility.ts`

## Safe first checks

```bash
git status --short
test -f 'src/app/api/[[...path]]/route.ts' && echo 1
npm test
npm run lint
npm run build
```

For database work, inspect the newest migration files and verify actual
Supabase application separately; a local migration file is not proof of a live
database change. For production claims, distinguish local code, deployment,
live Supabase state, and real OAuth/CHPP testing.

Do not recursively search `.git`, `node_modules`, `.next`, `dist`, `.rcs`,
`.vercel`, `supabase/.temp`, or generated reports. The workspace VS Code
settings exclude these from search, Explorer, and file watching.
