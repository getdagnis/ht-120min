# AGENTS.md

This is the front door for agents working on HT-120min. Keep it short, route to the right detail, and update `PROJECT_STATE.md` only for architectural, schema, security, product-direction, integration, or substantial refactor changes.

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

## Collaboration Rule

When a task is not completely obvious and trivial, first inspect the issue and explain the likely cause, then ask whether the user prefers a manual fix, a small targeted change, or a broader implementation. Do not start an elaborate workaround before confirming that direction; the user may prefer to clean up data or make the decision themselves.

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
5. `api/matchmaker/publish.ts`
6. `api/matchmaker/send-challenge.ts`
7. `api/matchmaker/show-interest.ts`
8. `api/matchmaker/teams.ts`
9. `api/teams/info.ts`
10. `api/teams/refresh-fixtures.ts`
11. `api/testing/index.ts`
12. `api/app.ts` (presence, history, activity, Forge session, and Forge statistics)

## Security Rules

- Treat any public exposure of privileged identifiers, login hints, bypass cookies, tokens, or auth conditions as a critical security bug.
- Do not show superadmin IDs, role names, admin-only access rules, or bypass instructions in public UI, login screens, error messages, or user-visible empty states.
- Keep authorization logic in code and server-side checks, not in visible copy.
- If a screen needs internal access guidance, put it in private docs or code comments only, never in a public route.
- Review login and admin surfaces for accidental disclosure before committing or publishing changes.
- Activity telemetry is private operational data. Store it server-side with service-role access only, keep raw user-agent/IP data out of public queries, and document retention before adding fields.

## Source Of Truth

- Current project status lives in `PROJECT_STATE.md`.
- Human setup and project introduction live in `README.md`.
- CHPP implementation standards live in `docs/chpp.md` and `docs/AGENTS_CHPP_INTEGRATION.md`.
- Scheduling rules live in `docs/scheduling.md`.
- Supabase and deployment rules live in `docs/database-and-deployment.md`.
- Existing CHPP schemas, examples, audits, and screenshots are reference appendices, not primary routing docs.

When updating status, distinguish local code, migration file, applied migration, local test, real Supabase test, and production deployment. Do not collapse those into "done" unless there is evidence.

`PROJECT_STATE.md` is a high-level project ledger, not a change history. Update it only when work changes architecture, database/schema/RPC/RLS behavior, security posture, product direction, a major integration, a substantial refactor, or a meaningful blocker/deployment state. Do not add rows for isolated UI styling, copy changes, routine bug fixes, small cleanup, editor/tooling adjustments, or ordinary validation results. Mention those in the task handoff instead. When uncertain, leave the ledger unchanged and ask the user before adding a status entry.

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
- Treat a migration ending in `-- MIGRATION APPLIED!` as immutable. Never edit it: put every follow-up schema, RPC, or function change in the next migration. If it was edited by mistake after application, restore its applied content and move the later changes into a new migration before continuing.
- Preserve RLS assumptions.
- Record migration status in `PROJECT_STATE.md` only when the change has architectural, security, product-direction, migration-state, or substantial behavioral impact.

## Closeout Format

When a task is finished, include:

1. Changes: what changed, briefly.
2. Validation: commands/checks run, and anything not run.
3. How to test: practical user-facing steps to inspect the behavior.
4. The files affected by that task.
5. A `git add` command covering those files.
6. A `git commit -m` command with a message that starts with one of:
   - `fix/` for bug fixes
   - `feature/` for new functionality
   - `major/` for refactors or larger updates
   - `update/` for UI or UX changes without new features or bug fixes

`How to test` should separate UI inspection from real integration testing. If a feature cannot be fully tested without real teams, live matches, CHPP ownership, specific Supabase rows, or production data, say that clearly and give the closest useful UI/manual check.

When real data is unavailable and UI/UX polish is the main need, a minimal dummy UI path is acceptable. Keep dummy UI under Forge/testing surfaces such as `/forge/testing`, do not add public `/dummies` routes, and do not add API functions for dummy views. Dummy UI is only for layout, copy, responsive states, modals, empty states, and flow inspection; it is not proof that CHPP, Supabase, or production behavior works.

Keep the commit message concise and descriptive. Use the task scope, not the whole worktree, in the `git add` command.

For completed code changes, automatically bump the patch version in `package.json` (for example, `0.2.2` to `0.2.3`) and mention it in the closeout. Do not change the minor or major version unilaterally: when the accumulated work plausibly warrants a milestone such as `0.2.8` to `0.3.0` or `0.9.2` to `1.0.0`, suggest that release bump in the closeout instead.
