# AGENTS.md

This is the front door for agents working on HT-120min. Keep it short, route to the right detail, and update `PROJECT_STATE.md` after meaningful work.

## Product

HT-120min is a niche community tool for recurring Hattrick friendly tournaments.

Primary goal: remove spreadsheet, forum, and manual coordination work for volunteer organizers.

Current positioning: "The easiest way to organize recurring Hattrick friendlies."

Target users are small Hattrick communities, private leagues, regional groups, and friendly tournament organizers. Optimize for organizer efficiency, not participant customization.

## Current Priority

Early MVP before Beta.

Prefer:

- manual + working
- simple + understandable
- fast to ship

Avoid:

- enterprise features
- complex permissions
- premature architecture
- blocking MVP work on future CHPP automation

Decision check:

1. Does this help organizers run tournaments?
2. Does this reduce manual work?
3. Can it ship this week?
4. Can it work without CHPP today?

If any answer is no, reconsider the scope.

## Hard Constraints

- Vercel Hobby allows 12 serverless functions. The project is currently at `12/12`.
- Every `.ts` file under `api/` outside `_lib/` counts as one Vercel function.
- Do not add a new API function unless another one is removed or consolidated.
- Dev/debug tooling belongs in `api/testing/index.ts` as routed handlers.
- Shared server code belongs in `api/_lib/`.
- Before API endpoint work, run:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
```

Current counted functions:

1. `api/auth/init.ts`
2. `api/auth/callback.ts`
3. `api/auth/complete.ts`
4. `api/chpp/live-matches.ts`
5. `api/matchmaker/activity.ts`
6. `api/matchmaker/publish.ts`
7. `api/matchmaker/send-challenge.ts`
8. `api/matchmaker/show-interest.ts`
9. `api/matchmaker/teams.ts`
10. `api/teams/info.ts`
11. `api/teams/refresh-fixtures.ts`
12. `api/testing/index.ts`

## Source Of Truth

- Current project status lives in `PROJECT_STATE.md`.
- Human setup and project introduction live in `README.md`.
- CHPP implementation standards live in `docs/chpp.md` and `docs/AGENTS_CHPP_INTEGRATION.md`.
- Scheduling rules live in `docs/scheduling.md`.
- Supabase and deployment rules live in `docs/database-and-deployment.md`.
- Existing CHPP schemas, examples, audits, and screenshots are reference appendices, not primary routing docs.

When updating status, distinguish local code, migration file, applied migration, local test, real Supabase test, and production deployment. Do not collapse those into "done" unless there is evidence.

## Task Routing

| Task | Read first |
| --- | --- |
| Any CHPP/OAuth/match refresh work | `docs/chpp.md`, then `docs/AGENTS_CHPP_INTEGRATION.md` |
| Schedule generation, rescheduling, fixtures dates, BYEs | `docs/scheduling.md` |
| Supabase schema, migrations, RLS, Vercel functions | `docs/database-and-deployment.md` |
| Frontend structure, reusable UI, page ownership | `docs/architecture.md` |
| Current blockers, migration state, validation state | `PROJECT_STATE.md` |
| Product direction | `ROADMAP.md` |
| Broad first-pass project familiarization | `AGENT_ONBOARDING.md` |

For CHPP tasks, also inspect the relevant endpoint schemas/examples in `docs/` before changing parser or sync logic.

## Tech Stack

- Vite
- React 19
- TypeScript with `no-explicit-any`
- React Router 7
- Sass modules
- Supabase
- Vercel Serverless Functions

Useful commands:

```bash
npm run dev
npm run build
npm test
npm run lint
```

## UI Rules

Reusable UI first. Before creating page-local wrappers or styles, check:

- `Button`
- `Card`
- `HeroCard`
- `SectionCard`
- `SidebarWidget`
- `Modal`
- `TournamentCard`
- `FixtureCard`
- `Avatar`
- `TeamByline`
- `TeamDisplay`
- `SupportersWall`
- `MottoWidget`
- `TinderWidget`
- `ProfileModal`
- `TeamSelectorModal`

If no existing component fits, prefer a reusable component under `src/components/`. Use page-local JSX/Sass only for genuinely one-off layouts.

Visual tone: Hattrick-friendly, nostalgic, community driven, not generic SaaS or enterprise.

## Validation Defaults

Docs-only:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
rg "docs/(architecture|scheduling|chpp|database-and-deployment)\\.md|PROJECT_STATE|AGENTS_CHPP" AGENTS.md README.md PROJECT_STATE.md docs
git diff --check
```

Code changes:

```bash
npm run build
npm test
```

API or CHPP changes:

- Confirm function count stays at or below 12.
- Use endpoint-specific test routes inside `api/testing/index.ts`.
- Inspect raw XML when parser behavior is uncertain.

Database changes:

- Create migrations intentionally.
- Preserve RLS assumptions.
- Record migration status in `PROJECT_STATE.md`.
