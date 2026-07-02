# AGENT_ONBOARDING.md

Last updated: 2026-07-02

This is an optional deep-orientation checklist for a new agent joining the project cold. It is not the source of truth for constraints or current status.

Use this when the task is broad, risky, or asks you to "familiarize yourself with the project." For normal implementation tasks, start with `AGENTS.md` and follow its task routing.

## Canonical Docs

Read these first:

1. `AGENTS.md` - agent entry point, hard constraints, task routing, validation defaults.
2. `PROJECT_STATE.md` - current implementation status, blockers, migration/test/deploy notes.
3. `README.md` - human project intro, setup, and commands.

Then read focused docs based on the task:

- `docs/architecture.md` - frontend structure, ownership boundaries, reusable UI.
- `docs/scheduling.md` - calendar, generation, rescheduling, BYEs, W15/W16 rules.
- `docs/chpp.md` - CHPP auth, endpoint sources, parser rules, known limitations.
- `docs/database-and-deployment.md` - Supabase model, migrations, RLS assumptions, Vercel limits.

For CHPP work, also read `docs/AGENTS_CHPP_INTEGRATION.md` and the relevant schema/example files.

## First-Pass Repo Scan

For a full mental model, inspect these files in order:

1. `package.json`
   - scripts, framework versions, dependencies
2. `src/App.tsx`
   - routing and major screens
3. `src/styles/global.sass`
   - global tokens, typography, themes, responsive helpers
4. `src/components/Layout/Layout.tsx`
   - app shell, login controls, active/organizer tournament menu
5. `src/hooks/useAuth.ts`
   - custom Hattrick identity model and localStorage/session behavior
6. `src/pages/Public/TournamentView.tsx`
   - tournament page, tabs, admin mode, schedule/result/chat flows
7. `src/pages/Create/CreateTournament.tsx`
   - creation flow, organizer linking, initial team/chat insert
8. `src/pages/Public/Matchmaker.tsx`
   - matchmaker browsing and publishing UI

Backend/API scan:

- `api/auth/init.ts`
- `api/auth/callback.ts`
- `api/auth/complete.ts`
- `api/teams/refresh-fixtures.ts`
- `api/chpp/live-matches.ts`
- `api/matchmaker/*`
- `api/testing/index.ts`
- `api/_lib/supabase.ts`
- `api/_lib/chpp-auth.ts`
- `api/_lib/chpp-xml.ts`
- `api/_lib/chpp-register.ts`

Core utilities:

- `src/utils/hattrick-calendar.ts`
- `src/utils/schedule-draft.ts`
- `src/utils/reschedule-draft.ts`
- `src/utils/scheduler.ts`
- `src/utils/match-schedule.ts`
- `src/utils/tournament-next-match.ts`
- `src/utils/standings.ts`
- `src/utils/tournament-announcements.ts`
- `src/utils/team-eligibility.ts`
- `src/utils/matchmaker.ts`

Database references:

- newest numbered migrations in `migrations/`
- `supabase-schema.sql`
- `docs/database-and-deployment.md`

## Security And Identity Notes

- This app uses custom Hattrick OAuth and localStorage-backed client identity hints; it is not a normal Supabase Auth session model.
- Do not trust a Hattrick user id from localStorage as authenticated server identity.
- Do not expose Supabase service-role keys or CHPP consumer secrets to frontend code.
- Do not weaken RLS broadly to make a UI flow work.
- Use ids for identity decisions; treat country, league, team, and manager names as display fields.

## Hard Checks During Orientation

Confirm Vercel function count:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
```

Confirm current dirty state before editing:

```bash
git status --short
```

For code changes, normal validation is:

```bash
npm run build
npm test
```

For docs-only changes, use the lighter checks from `AGENTS.md`.

## Investigation Report Template

When asked to investigate before implementing, report:

1. Current architecture summary.
2. Relevant source-of-truth docs and files read.
3. Authentication/identity assumptions and risks.
4. Supabase tables or migrations involved.
5. Vercel/API function impact.
6. CHPP endpoint/source-of-truth impact, if any.
7. Smallest safe implementation strategy.
8. Validation plan.
