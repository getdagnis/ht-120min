# PROJECT_STATE.md

Last updated: 2026-07-02

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
| Tournament creation/joining | Implemented | Base migrations through organizer/profile/team fields | Not rerun for docs-only refactor | Confirm |
| Schedule generation | Implemented | `047`, `048`, corrected by `051` | Covered by `tests/schedule-draft.test.ts`; not rerun for docs-only refactor | Confirm |
| Schedule regeneration | Implemented | `049`, corrected by `051` | Covered by `tests/reschedule-draft.test.ts`; not rerun for docs-only refactor | Confirm |
| W15/W16 calendar correction | Implemented locally | `051`; file contains `-- MIGRATION APPLIED!` marker | Covered by calendar/schedule tests; not rerun for docs-only refactor | Confirm actual Supabase/prod state |
| Tournament announcements | Implemented locally | `050`; file contains `-- MIGRATION APPLIED!` marker | Covered by `tests/tournament-announcements.test.ts`; not rerun for docs-only refactor | Confirm actual Supabase/prod state |
| Default tournament chat message | Implemented in create flow | Uses existing `tournament_chat` table | Not rerun for docs-only refactor | Confirm |
| Fixture refresh and reversed venue linking | Implemented locally | Uses existing match fields from `037`, `046` | Not rerun for docs-only refactor | Confirm |
| Next match date on cards/menu | Implemented via `src/utils/tournament-next-match.ts` using rounds/matches | No new migration | Not rerun for docs-only refactor | Confirm |
| CHPP country display normalization | Implemented locally for Latvia `CountryID=48` / `LeagueID=53` / localized names | No migration; existing rows handled in UI | `npm test` and `npm run build` passed 2026-07-02 | Confirm |
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
- Latvian CHPP country data is normalized for display from localized names such as `Lettonia`/`Latvija` and the CHPP CountryID/LeagueID split.
- Fixture booking/reconciliation uses `matches`.
- Live/finished result sync uses `matchdetails` with match events.
- Reversed home/away friendly location is treated as arranged, with venue mismatch metadata recorded.

### UI

- Results Entry has compact flags, no team logos, HT profile links for teams, icon-only result actions, responsive mobile result controls, and cleaned 120-minute chips.
- Fixtures collapse older finished rounds by default while keeping last finished, current/next, and future rounds visible.
- Empty fixtures still show a Hattrick join CTA before schedules are generated, including when the viewer has already joined one team but can add another.
- Empty standings show a first-team placeholder row with a join link, and team logo displays fall back to `/default-logo.png`.
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
- Country and league logic still has name-based fallbacks. Prefer ids for future work.
- Some CHPP parsing remains ad hoc, especially around `api/teams/info.ts`.
- The manual schedule smoke-test SQL is a reference helper, not proof of production state.

## Do Not Disturb Casually

- Do not add API functions without checking the 12-function limit.
- Do not replace app-owned tournament standings with CHPP tournament endpoints; HT-120min tournaments are app-owned.
- Do not remove manual admin result flows while CHPP automation is still incomplete.
- Do not treat `FriendlyTeamID` as the source of truth for booking when `matches` can answer the same question.
- Do not depend on country or league display names for new identity logic when ids are available.

## Latest Validation

Docs refactor validation should use:

```bash
find api -name "*.ts" | grep -v "/_lib/" | wc -l
rg "docs/(architecture|scheduling|chpp|database-and-deployment)\\.md|PROJECT_STATE|AGENTS_CHPP" AGENTS.md README.md PROJECT_STATE.md docs
git diff --check
```

Full code validation was not rerun for this docs-only refactor. When code changes are made, run:

```bash
npm run build
npm test
```
