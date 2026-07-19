# PROJECT_STATE.md

Last updated: 2026-07-18

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
| Fixture refresh and reversed venue linking | Implemented locally | Uses existing match fields from `037`, `046` | Not rerun for docs-only refactor | Confirm |
| Featured tournaments | Implemented locally with superadmin-only admin toggle and featured-first sorting across public/open/organizer lists, with featured items ordered oldest-first | `052`; pending Supabase application | `npm run build` and `npm test` passed 2026-07-03 | Confirm |
| Superadmin bypass and app session hardening | Implemented locally; bypass token is env-backed and disabled in production, app session secret no longer falls back to CHPP secret | No migration | `npm run build` and `npm test` passed 2026-07-10 | Confirm |
| Auth failure fallback | Implemented locally; auth init and callback dependency/runtime failures log an `AUTH_FAILURE` reference and return visitors to the app with retry/report actions instead of exposing a Vercel error page | No migration | `npm run build`, `npm run lint`, and `npm test` (82) passed 2026-07-17 | Deploy and exercise a real login flow; owner alerting still requires Vercel alerting or Sentry/log-drain configuration |
| Activity ledger and Forge statistics | Implemented locally; records identified and anonymous visits, page views, create/join actions, route/referrer/device/language/country metadata, per-user journeys and daily aggregates. Authenticated events capture the Hattrick manager nickname and link earlier events from the same visitor cookie to that identity. Raw events are retained for 90 days by the maintenance path and are only exposed through the Forge-protected stats route | `059_activity_ledger.sql`; migration file added, Supabase application not verified | `npm run lint`, `npm test` (82), `npm run build`, server import check, 12-function count, and `git diff --check` passed 2026-07-18 | Apply `059`, set the server-only Forge admin env, then verify stats and nickname continuity with real traffic |
| Forge session, restored CHPP testing, full-width Forge, and analytics workspace | Implemented locally; Forge uses a signed 30-day server cookie, the former CHPP testing toolkit is consolidated into the counted testing route, Forge no longer inherits the public app max width, and the statistics view uses a restrained light analytics workspace with visitor drill-down, flags, breakdowns, and safe journey metadata | No migration | `npm run lint`, `npm test` (82), `npm run build`, server import check, 12-function count, and `git diff --check` passed 2026-07-18 | Set `FORGE_SUPERADMIN_HT_ID` and `APP_SESSION_SECRET` in Vercel, then verify login persistence, testing tools, and analytics |
| Sandbox tournament creation | Implemented locally as public third tournament type using real CHPP team metadata and normal tournament mechanics; creation now cleans up partial rows after dependent insert failures, reports a clear migration error, bypasses verified-team/archive rules, only allows adding teams before schedule generation, hides country limits, uses an HFI-specific random ID range, and permanently marks names with `(test)` | `053`; pending Supabase application; `055` adds the suffix to existing sandbox names | `npm run build`, `npm test` (69), and `git diff --check` passed 2026-07-14 | Apply `053` and `055`, then confirm |
| Tournament name suffix defaults | Implemented locally; sandbox names enforce `(test)`, country flags are optional via the create-flow checkbox, and HFI/special-league suffixes are applied only when the relevant selector changes. Manual name edits are preserved on normal saves, and removing a generated country flag automatically unchecks the flag option | No new migration; `055` covers existing sandbox names | `npm run build`, `npm test` (69), and `git diff --check` passed 2026-07-14 | Confirm create/edit behavior after applying `055` |
| Tournament name and slug uniqueness | Implemented locally; display names are unique after case/diacritic/punctuation/emoji normalization, existing duplicates are preserved while new duplicates are rejected by a trigger, Continue resolves suggested slug collisions without trailing dashes, and the teams step shows the resulting slug | `054`; pending Supabase application | `npm run build`, `npm test` (69), and `git diff --check` passed 2026-07-14 | Apply `054` and confirm |
| Tournament roster health/status | Implemented locally; generated real tournaments pause when their active roster becomes unhealthy, while empty open tournaments become private/unlisted and legacy archived rows are excluded from public lists | No migration; existing `status` and `is_private` fields | `npm run build` and `npm test` passed 2026-07-13 | Confirm against live Supabase |
| Tournament valid-user count | Implemented locally in migration `056`; `tournaments.valid_users` is maintained from active, non-placeholder OAuth-linked teams with distinct Hattrick user IDs. Existing rows default to `0` for manual cleanup/backfill | `056`; pending Supabase application | Pending migration application; code validation in progress | Apply `056`, then manually backfill historical rows as needed |
| APPG scoring and bulk simulation | Implemented locally for organizer-managed and sandbox tournaments. APPG outcomes are explicit (`ET3`, `ET2`, `PS1`, `RT0`, `OPW`, or `needs_review`); admins can enter or simulate a full season/round, download/import the CSV template, and save without a page refetch. Existing CHPP results remain `needs_review` until event evidence is classified | `060_add_appg_match_outcomes.sql`; migration file created, Supabase application not verified | `npm run lint`, `npm test` (89), `npm run build`, server import check, 12-function count, and `git diff --check` passed 2026-07-18 | Apply `060`, then test a disposable organizer-managed APPG tournament with real Supabase data |
| Tournament seasons/history | Versioned v2 snapshots freeze participants, standings, matches, awards, records and an automatic season story. The public History tab uses a two-column archive with shared distinctions, all participants, final standings, records, a memorable match and immutable participant yearbook comments. Admins can explicitly finish active seasons or generate missing reports for previously finished seasons from either Season Planner or the empty History tab; adding the next season requires a generated report. Published reports have a DB-backed per-manager modal dismissal and History-view marker, with a seven-day announcement window | `057` exists and is marked applied in-file; `058` adds yearbook comments and is pending application; report notice tracking reuses `050` dismissal records | `npm run build`, `npm test` (82), and API function count `12` passed 2026-07-17. Chromium E2E spec added, but both bundled Chromium and system Chrome abort with `SIGABRT` on this Intel Mac before tests start | Apply `058`, generate the first real tournament report, then verify comments and report notices against live Supabase |
| Team ownership reclaim | Implemented locally; existing organizer-added/bot/incomplete team rows are upgraded when the owner joins that exact tournament via CHPP, and logged-in users now get a global reclaim prompt for active non-sandbox teams that match their CHPP team list but are not fully OAuth-linked | No migration; uses existing team OAuth/profile fields | `npm run build`, `npm test` (69), and `git diff --check` passed 2026-07-15 | Confirm after deployment with a real owner login |
| CHPP country/league display and flag normalization | Implemented locally from `src/utils/worlddetails.xml` v1.2 through the shared `worlddetails` catalogue. `leagueName` is the single short English UI name, `fullName` is the full English name, and `countryName` preserves Hattrick's original local country name. ISO codes and emoji are stored with the same record. Parent LeagueID and associated CountryID remain separate; country-backed teams use one Hattrick parent-league flag, while countryless leagues use an additional Hattrick league flag. CHPP country-name normalization is shared by the browser and API parsers | No migration; existing rows are resolved by `country_id`, future CHPP writes use canonical shared names | `npm run build` passed 2026-07-14; `npm test` has one unrelated existing world-details flag assertion failure | Confirm against live HFI refresh; existing translated `country_name` values are not backfilled |
| Matchmaker challenge send | Partially implemented | Existing matchmaker/profile/token migrations | Requires real CHPP reauth and endpoint confirmation | Confirm |

Production means live deployed behavior. If it has not been checked against the live Supabase/Vercel deployment, leave it as `Confirm`.

## What Works Now

### Tournaments

- Create tournament with organizer/team snapshots.
- Join tournament through CHPP OAuth.
- Reclaim ownership of organizer-added/bot-looking teams when the real owner logs in and confirms the prompt.
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
- Standings now has a scoring display control that cycles enabled modes with a recycle icon. The 90-minute points column is green, visible rows resort to the selected mode's natural ranking, and each visible metric header supports ascending/descending sorting. Organizer-managed and sandbox APPG tournaments expose average points per game and APPG outcome-aware ranking; unclassified CHPP results are intentionally excluded from the APPG total until reviewed.
- Admin Results Entry supports APPG outcome classification in single-result and bulk editors, penalty shootout fields, season/round simulation, and a CSV template/import path. Bulk saves update local match state without reloading the full tournament view.
- Fixtures collapse older finished rounds by default while keeping last finished, current/next, and future rounds visible.
- Empty fixtures still show a Hattrick join CTA before schedules are generated, including when the viewer has already joined one team but can add another.
- Empty standings show a first-team placeholder row with a join link, and team logo displays fall back to `/default-logo.png`.
- Welcome modals now exist locally for the home page, Matchmaker, newly created tournaments, and first visits to open tournaments. They use one shared modal shell with per-surface copy and per-browser dismissal state.
- Tournament cards prioritize a future planned start date over the previous finished date, so next-season planning is visible before historical status.
- Tournament History is available locally as a public archive for finished seasons, including frozen participant metadata, shared awards, records, memorable matches, final standings and one immutable yearbook comment per participating team. A development-only `/dummies/tournament-history` route provides UI review without login or database data. The standings tab now mirrors the same yearbook comments block, unfinished seasons show a placeholder yearbook below News, and the History tab badge tracks unread season comments only after the page has already been visited once.
- Admin settings show a dirty-state save reminder, organizer-only admin password reset, and team deletion now requires a second admin-password confirmation.
- Superadmin-only featured tournament toggling is available in admin settings and pins featured tournaments to the top of open, active, and organizer lists.
- Featured tournaments are ordered oldest-first within each pinned list.
- Account dropdown now separates current active participations from finished participations and labels the active section as `ACTIVE:`.
- Superadmin bypass is env-backed, dev-only, and no longer exposed as a hardcoded cookie value; production session signing now requires `APP_SESSION_SECRET`.
- Sandbox Playground is available as a public create-flow tournament type. It creates unlisted test tournaments with random real CHPP team metadata, stores sandbox metadata for future expiry cleanup, and excludes test tournaments from normal public discovery lists.
- Generate schedule now shows a clearer empty-state reason, waits for a picked start date before previewing, and uses a no-teams placeholder label.
- Tournament cards use canonical league names and avoid mobile overflow on the home grid.
- Chat shows a login button when the viewer is not authenticated.
- Team ownership reclaim now targets only incomplete organizer-added rows (`joined_via_oauth = false` and no owner), suppresses stale duplicates when the same Hattrick team is already linked to the current profile, and excludes sandbox rows. Finished/stopped status is not used to infer ownership.
- Tournament FAQ now uses the same compact sidebar accordion as Create Tournament tips; updated creation guidance covers sandbox tournaments, schedule/result handling, and current privacy/restriction behavior.
- Description editor has textarea and regenerate controls restored in tournament/admin contexts.
- Supporters wall hydrates known users from DB by ids while keeping readable constants for name/team context.

## Known Risks And Blockers

- Vercel Hobby is at `12/12` serverless functions. New endpoints require consolidation.
- Production status for migrations `050` and `051` was not independently verified in this docs pass; files are marked applied locally.
- CHPP `challengeable` / `challenge` can return 401 for users whose tokens predate the `manage_challenges` scope. Those users must reauthorize.
- Matchmaker `handleAccept` remains incomplete as a full server-side booking/match creation loop.
- Race protection for simultaneous Matchmaker accepts is not complete.
- Stale Matchmaker ads can remain visible until availability sync runs.
- `src/utils/worlddetails.xml` is the raw CHPP catalogue source; `shared/worlddetails.ts` is the application source of truth. If CHPP changes its world-details data, regenerate/review the shared file, preserve the LeagueID/CountryID distinction, and keep `leagueName` short/English, `fullName` full/English, and `countryName` local/original.
- `src/utils/global-match-times.json` remains separate because it contains scheduling policy rather than identity metadata. The deleted `leagues.ts`, API league adapter, and unused `leagues.html` were redundant catalogue layers.
- Some CHPP parsing remains ad hoc, especially around `api/teams/info.ts`.
- The manual schedule smoke-test SQL is a reference helper, not proof of production state.
- Auth failure records are visible in Vercel logs, but automatic owner notification is not configured yet; add a Vercel alert, log drain, or Sentry integration if immediate email/push notification is required.
- Activity analytics require migration `059` and the server-only Supabase secret. Authenticated events capture the manager nickname from the profile table, while anonymous events can be associated with that nickname later through the visitor cookie. The current stats view intentionally exposes operational aggregates and selected journey metadata only to Forge; raw IP and user-agent fields remain out of the UI, and retention cleanup is application-driven until a scheduled maintenance path is added.
- Forge authorization requires `FORGE_SUPERADMIN_HT_ID` in production. `VITE_ADMIN_HT_ID` is accepted only for local development compatibility and cannot authorize Forge in production.
- The historical CHPP testing toolkit is restored as a consolidated `/api/testing` dispatcher. It performs real CHPP reads and challenge sends; challenge sends remain confirmation-gated and must be tested with a disposable target.
- APPG event classification from CHPP is not inferred from ordinary scores. Until verified CHPP event identifiers are documented, linked/live results remain `needs_review`; organizers or CSV imports must classify them explicitly.

## Do Not Disturb Casually

- Do not add API functions without checking the 12-function limit.
- Do not replace app-owned tournament standings with CHPP tournament endpoints; HT-120min tournaments are app-owned.
- Do not remove manual admin result flows while CHPP automation is still incomplete.
- Do not treat `FriendlyTeamID` as the source of truth for booking when `matches` can answer the same question.
- Do not depend on country or league display names for new identity logic when ids are available.

## Latest Validation

Latest code validation for APPG scoring, bulk simulation, tournament seasons/history, and yearbook:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
rg "docs/(architecture|scheduling|chpp|database-and-deployment)\\.md|PROJECT_STATE|AGENTS_CHPP" AGENTS.md README.md PROJECT_STATE.md docs
git diff --check
```

`find api -name "*.ts" | grep -v "/_lib/" | wc -l` returned `12`.

`npm run check:server-imports`, `npm run lint`, `npm test` (89), `npm run build`, the 12-function count, and `git diff --check` passed on 2026-07-18 for APPG scoring, standings controls, bulk result simulation/CSV parsing, activity/Forge analytics, visual refresh, and team ownership reclaim filtering. Auth initialization and callback failures now use guarded dynamic imports and redirect back to the app with a non-sensitive reference; the server logs the matching `AUTH_FAILURE` object. The server import check was added after Vercel's Node ESM runtime exposed an extensionless relative import that local Vite development accepted; it scans `api/` and `shared/` and requires explicit runtime `.js` extensions for relative server imports. The counted function total remains `12` after consolidating presence, history, activity, Forge session, and Forge statistics behind `api/app.ts`, while CHPP testing is consolidated behind `api/testing/index.ts`. Chromium verification could not execute because both bundled Chromium and system Chrome abort with `SIGABRT` on this Intel Mac before opening a page; the focused E2E spec remains in `e2e/tournament-history.spec.ts`. The build still reports the existing CSS `:global` warning and large bundle warning. Live Supabase migration/application and Vercel verification remain outstanding.

```bash
npm run build
npm test
```
