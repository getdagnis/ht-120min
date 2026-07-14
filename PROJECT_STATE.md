# PROJECT_STATE.md

Last updated: 2026-07-14

This is the current-status ledger. Update it after meaningful implementation work. Be explicit about what is local, migrated, tested, deployed, or still unknown.

## Current Product State

HT-120min is an early MVP for recurring Hattrick friendly tournaments. Tournaments are the core product; Matchmaker is an entry layer for finding friendly opportunities.

The app currently supports:

- Hattrick OAuth login and profile snapshots.
- Tournament creation, joining, team management, standings, fixtures, chat/news, and admin tools.
- Schedule generation and schedule regeneration for future unarranged rounds.
- Manual result entry and CHPP-based match/result refresh.
- Matchmaker ad publishing, browsing, availability checks, interest flow, and challenge-send path.

## Status Table

| Area | Code | DB migration | Local test | Production |
| --- | --- | --- | --- | --- |
| Tournament creation/joining | Implemented; OAuth callback now keeps superadmin team selection unfiltered, matches league limits by LeagueID, saves organizer names for new validated tournaments, and falls back to profile/team organizer names for older null rows | Base migrations through organizer/profile/team fields | `npm test` and `npm run build` passed 2026-07-02 | Confirm |
| Schedule generation | Implemented | `047`, `048`, corrected by `051` | Covered by `tests/schedule-draft.test.ts`; not rerun for docs-only refactor | Confirm |
| Schedule regeneration | Implemented | `049`, corrected by `051` | Covered by `tests/reschedule-draft.test.ts`; not rerun for docs-only refactor | Confirm |
| W15/W16 calendar correction | Implemented locally | `051`; file contains `-- MIGRATION APPLIED!` marker | Covered by calendar/schedule tests; not rerun for docs-only refactor | Confirm actual Supabase/prod state |
| Tournament announcements | Implemented locally | `050`; file contains `-- MIGRATION APPLIED!` marker | Covered by `tests/tournament-announcements.test.ts`; not rerun for docs-only refactor | Confirm actual Supabase/prod state |
| Default tournament chat message | Implemented in create flow | Uses existing `tournament_chat` table | Not rerun for docs-only refactor | Confirm |
| Fixture refresh and reversed venue linking | Implemented locally | Uses existing match fields from `037`, `046` | Not rerun for docs-only refactor | Confirm |
| Next match date on cards/menu | Implemented via `src/utils/tournament-next-match.ts` using rounds/matches | No new migration | Not rerun for docs-only refactor | Confirm |
| Featured tournaments | Implemented locally with superadmin-only admin toggle and featured-first sorting across public/open/organizer lists | `052`; pending Supabase application | `npm run build` and `npm test` passed 2026-07-03 | Confirm |
| Superadmin bypass and app session hardening | Implemented locally; bypass token is env-backed and disabled in production, app session secret no longer falls back to CHPP secret | No migration | `npm run build` and `npm test` passed 2026-07-10 | Confirm |
| Sandbox tournament creation | Implemented locally as public third tournament type using real CHPP team metadata and normal tournament mechanics; creation now cleans up partial rows after dependent insert failures, reports a clear migration error, bypasses verified-team/archive rules, only allows adding teams before schedule generation, hides country limits, and uses an HFI-specific random ID range | `053`; pending Supabase application | `npm run build` and `npm test` passed 2026-07-14 | Apply `053` and confirm |
| Tournament name and slug uniqueness | Implemented locally; display names are unique after case/diacritic/punctuation/emoji normalization, existing duplicates are preserved while new duplicates are rejected by a trigger, and generated slugs use collision suffixes without trailing dashes | `054`; pending Supabase application | `npm run build` and `npm test` passed 2026-07-14 | Apply `054` and confirm |
| Tournament roster health/status | Implemented locally; generated real tournaments pause when their active roster becomes unhealthy, while empty open tournaments become private/unlisted and legacy archived rows are excluded from public lists | No migration; existing `status` and `is_private` fields | `npm run build` and `npm test` passed 2026-07-13 | Confirm against live Supabase |
| API TypeScript editor config | Implemented locally with `api/tsconfig.json` so Vercel API files use Node globals in the IDE without changing `tsc -b` build scope | No migration | `npm run build` passed 2026-07-10; standalone `npx tsc -p api/tsconfig.json` exposes pre-existing API typing issues | Confirm |
| CHPP country display and flag normalization | Implemented locally from `src/utils/worlddetails.xml` v1.2 through shared world-details records. Parent LeagueID and associated CountryID are kept separate; country-backed teams use one Hattrick parent-league flag, while countryless leagues use an additional Hattrick league flag. English and local names are both retained for future language preferences | No migration; existing rows are resolved by `country_id`, future CHPP writes use canonical English names | `npm test` (65), `npm run build`, `git diff --check`, and no active FlagCDN references passed 2026-07-14 | Confirm against live HFI refresh; existing translated `country_name` values are not backfilled |
| Empty tournament join affordances and team logo fallback | Implemented locally | No migration | `npm test` and `npm run build` passed 2026-07-02 | Confirm |
| Matchmaker challenge send | Partially implemented | Existing matchmaker/profile/token migrations | Requires real CHPP reauth and endpoint confirmation | Confirm |

Production means live deployed behavior. If it has not been checked against the live Supabase/Vercel deployment, leave it as `Confirm`.

## What Works Now

### Tournaments

- Create tournament with organizer/team snapshots.
- Join tournament through CHPP OAuth.
- Store manager/team metadata, country ids/names where available, logos, OAuth tokens, and organizer data.
- Generate single, double, and recurring schedules from the admin panel.
- Regenerate future unarranged rounds without changing pairings.
- Handle odd-team BYEs.
- Show standings, fixtures/results, news/chat, and admin panels.
- Enter results manually, including misarranged matches where admins decide the result should count.
- Refresh fixtures from CHPP `matches` and live/finished results from CHPP `matchdetails`.

### Scheduling

- Weeks 1-3 are blocked cup weeks.
- Weeks 4-6 are selectable but flagged with cup-likelihood warnings.
- Week 15 weekend is optional because qualification games can block teams.
- Week 16 weekend is included by default as a regular friendly slot.
- Schedule payloads include `scheduled_for`, `schedule_slot_type`, and `include_week15_weekend_friendly`.
- Regeneration locks completed, arranged, linked, or already-started rounds.

### CHPP

- OAuth flow requests `manage_challenges` scope.
- Manager/team discovery uses `managercompendium`.
- Team metadata uses `teamdetails`.
- CHPP country data is normalized from CountryID, independent of the manager's CHPP language; league flags use LeagueID separately. Existing translated database text remains until a data backfill or team refresh.
- Fixture booking/reconciliation uses `matches`.
- Live/finished result sync uses `matchdetails` with match events.
- Reversed home/away friendly location is treated as arranged, with venue mismatch metadata recorded.

### UI

- Results Entry has compact flags, no team logos, HT profile links for teams, icon-only result actions, responsive mobile result controls, and cleaned 120-minute chips.
- Fixtures collapse older finished rounds by default while keeping last finished, current/next, and future rounds visible.
- Empty fixtures still show a Hattrick join CTA before schedules are generated, including when the viewer has already joined one team but can add another.
- Empty standings show a first-team placeholder row with a join link, and team logo displays fall back to `/default-logo.png`.
- Admin settings show a dirty-state save reminder, organizer-only admin password reset, and team deletion now requires a second admin-password confirmation.
- Superadmin-only featured tournament toggling is available in admin settings and pins featured tournaments to the top of open, active, and organizer lists.
- Superadmin bypass is env-backed, dev-only, and no longer exposed as a hardcoded cookie value; production session signing now requires `APP_SESSION_SECRET`.
- Sandbox Playground is available as a public create-flow tournament type. It creates unlisted test tournaments with random real CHPP team metadata, stores sandbox metadata for future expiry cleanup, and excludes test tournaments from normal public discovery lists.
- Generate schedule now shows a clearer empty-state reason, waits for a picked start date before previewing, and uses a no-teams placeholder label.
- Tournament cards use canonical league names and avoid mobile overflow on the home grid.
- Chat shows a login button when the viewer is not authenticated.
- Description editor has textarea and regenerate controls restored in tournament/admin contexts.
- Supporters wall hydrates known users from DB by ids while keeping readable constants for name/team context.

## Known Risks And Blockers

- Vercel Hobby is at `12/12` serverless functions. New endpoints require consolidation.
- Production status for migrations `050` and `051` was not independently verified in this docs pass; files are marked applied locally.
- CHPP `challengeable` / `challenge` can return 401 for users whose tokens predate the `manage_challenges` scope. Those users must reauthorize.
- Matchmaker `handleAccept` remains incomplete as a full server-side booking/match creation loop.
- Race protection for simultaneous Matchmaker accepts is not complete.
- Stale Matchmaker ads can remain visible until availability sync runs.
- `src/utils/worlddetails.xml` is the current catalogue source. If CHPP changes its world-details data, regenerate/review `shared/worlddetails.ts` and preserve the LeagueID/CountryID distinction.
- Some CHPP parsing remains ad hoc, especially around `api/teams/info.ts`.
- The manual schedule smoke-test SQL is a reference helper, not proof of production state.

## Do Not Disturb Casually

- Do not add API functions without checking the 12-function limit.
- Do not replace app-owned tournament standings with CHPP tournament endpoints; HT-120min tournaments are app-owned.
- Do not remove manual admin result flows while CHPP automation is still incomplete.
- Do not treat `FriendlyTeamID` as the source of truth for booking when `matches` can answer the same question.
- Do not depend on country or league display names for new identity logic when ids are available.

## Latest Validation

Latest code validation for the country/flag fix:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
rg "docs/(architecture|scheduling|chpp|database-and-deployment)\\.md|PROJECT_STATE|AGENTS_CHPP" AGENTS.md README.md PROJECT_STATE.md docs
git diff --check
```

`npm run build` and `npm test` passed on 2026-07-14. The build still reports the existing CSS `:global` warning and large bundle warning. For future code changes, run:

```bash
npm run build
npm test
```
