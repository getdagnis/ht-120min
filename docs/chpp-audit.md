# CHPP API Usage Audit

Scope: review every Hattrick / CHPP-derived data path in the codebase and verify that each field comes from the most authoritative endpoint available in the repo's CHPP docs.

Primary references used:
- `docs/AGENTS_CHPP_INTEGRATION.md`
- `docs/# CHPP Files help.md`
- `docs/teamdetails.schema.xml`
- `docs/matches.schema.xml`
- `docs/chpp datatypes.html`
- `docs/challenges.params.md`
- `docs/managercompendium.schema.xml`
- `api/_lib/chpp-xml.ts`
- `api/_lib/matchmaker.ts`
- `api/auth/callback.ts`
- `api/auth/complete.ts`
- `api/teams/info.ts`
- `api/teams/refresh-fixtures.ts`
- `api/chpp/live-matches.ts`
- `api/matchmaker/*`
- `src/pages/Public/Matchmaker.tsx`
- `src/pages/Public/TournamentView.tsx`

## Executive Summary

The codebase already uses the correct authoritative endpoint for several core flows:
- `matchdetails` is used for live and finished match sync.
- `arenadetails` is used for arena capacity/image data.
- `managercompendium` is used for login / owned-team discovery.
- `matches` is already present in the codebase and is the right source for booked-upcoming friendly detection.

The main reliability problems are:
- Availability is still mixed between `teamdetails.FriendlyTeamID` and `matches`.
- Country and league logic still uses name-based comparisons in several places.
- HFI detection has a string fallback (`leagueName.includes('femme')`).
- Tournament fixture timing still relies on local country-name tables.
- Several fields are stored redundantly as names even when ids exist.

## Integration Matrix

### Manager Data

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Manager name / login identity | Auth callback, profile, account UI | `managercompendium` | `Loginname`, `UserID` / `UserId` | No for this use | `managercompendium` | Low | Correctly used for user identity and manager display name. |
| Owned teams / team list | Login, team selection, tournament join | `managercompendium` | `<Teams><Team>` list | No | `managercompendium` | Low | This is the right discovery source for a manager's clubs. |
| Country | Auth complete, profile, tournament join, Matchmaker profile snapshots | `managercompendium` | `CountryID`, `CountryName` | Yes, for canonical display mapping use `worlddetails` | `managercompendium` for sync, `worlddetails` for display normalization | Medium | The code stores both `country_id` and `country_name`; any comparison should prefer ids. |
| League | Auth complete, tournament join, eligibility checks | `managercompendium` team list | `LeagueID`, `LeagueName`, `LeagueLevelUnitName` | Yes, `leaguedetails` for canonical series metadata | `managercompendium` for owned-team discovery, `leaguedetails` for league hierarchy | Medium | League text is currently used in a few inference paths. |
| Avatar | Profile / account UI | `managercompendium` | `Avatar` | No | `managercompendium` | Low | Persisted as JSON and displayed directly. |
| Supporter status | Profile / account UI | `managercompendium` | `UserSupporterTier` | No | `managercompendium` | Low | The schema exposes it, but `api/_lib/chpp-xml.ts` does not currently parse/store it. |
| Youth info | Not currently used | None | None | Yes, dedicated youth files | Dedicated youth endpoints only | Low | `managercompendium` explicitly says youth should use dedicated youth XML files. No youth manager metadata integration was found. |

### Team Data

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Team name / team id | Auth, registration, Matchmaker, Tournament UI | `teamdetails` and `managercompendium` | `TeamName`, `TeamID` | No | `teamdetails` for per-team metadata, `managercompendium` for discovery | Low | Correct canonical source. |
| Gender | Matchmaker browse, posting dropdown, team selector, tournament eligibility | `teamdetails` | `GenderID` | No | `teamdetails` | Medium | This should remain id-based. HFI should be a display suffix, not an inferred string category. |
| League / series / hierarchy | Tournament join, bylines, category filtering | `teamdetails` | `LeagueID`, `LeagueName`, `LeagueLevelUnitID`, `LeagueLevelUnitName`, `LeagueSystemID` | Yes, `leaguedetails` for canonical series metadata | `teamdetails` for team-centric views, `leaguedetails` for series hierarchy | Medium | Current code still has a name fallback (`femme`) that is not authoritative. |
| Country | Team eligibility, flags, scheduling, tournament restrictions | `teamdetails` and `managercompendium` | `CountryName` / `CountryID` | Yes, `worlddetails` | Store ids, derive names from `worlddetails` | High | Several parts of the app still compare `countryName` strings directly. |
| Arena | Team registration, Matchmaker posting | `teamdetails` | `ArenaID`, `ArenaName` | No | `teamdetails` | Low | Correct for the team's owned arena reference. |
| Arena size | Matchmaker posting / team details | `teamdetails` + `arenadetails` | `FanclubSize`, `ArenaID`, `Capacity` | No | `teamdetails` + `arenadetails` | Low | Capacity belongs to `arenadetails`; `teamdetails` only provides the id pointer. |
| Logo | Registration and cards | `teamdetails` | `LogoURL` | No | `teamdetails` | Low | Canonical team logo field. |
| Fan club size | Matchmaker posting / team details | `teamdetails` | `FanclubSize` | No | `teamdetails` | Low | Correct source. |
| Friendly booking pointer | Matchmaker availability and booking checks | `teamdetails` | `FriendlyTeamID` | Yes, `matches` is better for upcoming fixtures | `matches` as source of truth; `FriendlyTeamID` only as a hint | Critical | `FriendlyTeamID` is valid, but it is not the best source for "is a friendly already booked?" when `matches` already exposes the upcoming fixture list. |

### Arena Data

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Arena name / arena id | Matchmaker and team registration | `arenadetails` | `ArenaID`, `ArenaName` | No | `arenadetails` | Low | Correct authoritative source. |
| Arena capacity | Matchmaker posting, team pages | `arenadetails` | `Capacity` | No | `arenadetails` | Low | Correct authoritative source. |
| Arena image | Matchmaker posting, team pages | `arenadetails` | `ArenaImage` / `ArenaImageURL` | No | `arenadetails` | Low | Correct authoritative source. |
| Refresh strategy | Matchmaker browse / publish / admin create | `arenadetails` fetched opportunistically after `teamdetails` | N/A | No | Explicit refresh when team details are fetched, with bounded TTL | Medium | Current behavior is acceptable for MVP but does not have a formal invalidation policy. |

### Matchmaker Availability and Challenge Flow

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Browse-card availability state | Matchmaker browse cards | Mixed: `matches` in helper, plus `teamdetails` in other code paths | `FriendlyTeamID`, `PossibleToChallengeMidweek`, `PossibleToChallengeWeekend`, `MatchType`, `Status` | Yes | `matches` for booking state; `teamdetails` for coarse challengeability flags; `challenges?actionType=challengeable` for actual challenge checks when managing your own team | Critical | This is the main source-of-truth problem. `matches` is already the authoritative feed for upcoming fixtures, so booked friendlies should be derived from that first. |
| Booking detection | Matchmaker publish, booking-status endpoint | `teamdetails` in some flows, `matches` in helper | `FriendlyTeamID` vs `MatchType` 4/5/8/9 | Yes | `matches` as primary source | Critical | The code already has `fetchTeamBookingStatus()` using `matches`; other call sites still check `FriendlyTeamID`. |
| Challenge eligibility windows | Team selector modal, post form | `teamdetails` | `PossibleToChallengeMidweek`, `PossibleToChallengeWeekend` | Partial | `teamdetails` | Medium | These flags are useful but only describe challenge windows; they do not replace the booked-fixture check. |
| Actual challengeable state | Future manual challenge flow | Not currently used | N/A | Yes, `challenges` (`actionType=challengeable`) | `challenges` | Medium | The repo has docs for `challenges`, but the feature is not wired up yet. |
| Manual arrangement modal | Matchmaker heart flow | No backend write | N/A | N/A | Frontend-only temporary handoff | Low | Correct for MVP until a real booking API is introduced. |
| 120-minute / friendly type support | Matchmaker heart flow | `matches` and local request state | `MatchType`, request `match_type` | Yes | `matches` for booking detection; UI heuristics can stay local | Low | Matchmaker score should remain a heuristic, not a CHPP truth source. |

### Tournament Features

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Participants / team roster | Tournament creation, tournament view | Supabase snapshots populated from CHPP | `teamdetails` and `managercompendium` fields copied into DB | Partial | `teamdetails` / `managercompendium` for registration snapshots | Medium | Most tournament state is app-owned; CHPP is only the seed source. |
| Fixtures | Fixture refresh, tournament view | `matches` | `MatchType`, `MatchDate`, `Status`, `HomeTeamID`, `AwayTeamID` | Yes, if mirroring CHPP tournament fixtures use `tournamentfixtures` | `matches` for friendly reconciliation; `tournamentfixtures` only for CHPP-managed tournament fixtures | Medium | Current fixture refresh uses `matches` correctly, but date estimation is local and country-name based. |
| Results / live sync | Tournament view and live sync API | `matchdetails` | `MatchStatus`, `FinishedDate`, `HomeGoals`, `AwayGoals`, `EventList` | No | `matchdetails` with `matchEvents=true` | Low | This matches `docs/AGENTS_CHPP_INTEGRATION.md`. |
| Standings | Tournament view | Derived from app DB | N/A | No direct CHPP source for app standings | App DB | Low | Not a CHPP source-of-truth problem. |
| Player statistics | Not currently integrated | None | None | Yes, player endpoints exist | `players` / `playerdetails` when needed | Low | No current direct integration found. |
| Brackets / tournament metadata | Tournament view | App DB | N/A | Partial | App DB, with CHPP only if mirroring official tournaments | Low | Mostly internal application state. |

### League Data

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Country / league lookup | Login, tournament join, Matchmaker filtering | `teamdetails` and `managercompendium` | `CountryName`, `CountryID`, `LeagueID`, `LeagueName` | Yes, `worlddetails` and `leaguedetails` | Use ids as the source, names only for display | High | Multiple places still treat names as identifiers. |
| Division hierarchy | Tournament display, league labels | `teamdetails` | `LeagueLevelUnitID`, `LeagueLevelUnitName`, `LeagueLevel`, `LeagueSystemID` | Yes, `leaguedetails` | `leaguedetails` | Medium | Better than inferring from team or league names. |
| Promotion / relegation metadata | Not currently modeled | None | None | Likely `leaguedetails` / league hierarchy files | Not currently used | Low | No current direct integration found. |

### Country Data and Identifier Mapping

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Country names | Team byline, team display, Matchmaker, tournament pages | Persisted DB `country_name` fields, plus local helpers | `country_name` strings | Yes, `worlddetails` | `country_id` -> display name/flag via canonical mapping | High | `src/utils/ht-data.ts` keys flag URLs and friendly times by country name. |
| Country flags | TeamByline, TeamDisplay | Local `COUNTRY_TO_ISO` table keyed by name | `countryName` string | Yes, `worlddetails` for canonical ids | `country_id`-based display mapping | High | Display-only helpers are fine, but the source should not be a name string. |
| Country restrictions | Auth callback, auth complete, tournament join, team eligibility | String equality on `countryName` | `countryName` | Yes | Compare canonical ids instead of names | High | This is one of the biggest reliability risks outside Matchmaker booking. |
| League restrictions | Auth callback, team eligibility | `leagueName` text fallback | `leagueName` | Yes, `LeagueID` / `LeagueSystemID` | Compare ids, not names | High | `leagueName.includes('femme')` is the clearest fragile fallback in the repo. |
| League ids / country ids | Profiles, teams, tournament pages | Mixed DB and CHPP snapshot fields | `country_id`, `league_id`, `country_name` | Yes | Keep ids authoritative, derive names later | Medium | The data model should prefer ids even when names are also cached. |

### Caching and Refresh Behavior

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Manager snapshot persistence | Auth callback / complete | `managercompendium` | `profiles.teams_json`, `avatar_json`, `country_id`, `country_name` | N/A | Refresh on login and explicit re-sync | Medium | No unified TTL. Cached profile data can drift. |
| Team metadata persistence | Matchmaker and registration flows | `teamdetails` | `teams.logo_url`, `teams.arena_id`, `teams.arena_image_url`, `gender_id` | N/A | Refresh on explicit load or bounded TTL | Medium | The app updates missing assets opportunistically, not via a formal cache policy. |
| Arena metadata persistence | Matchmaker and registration flows | `arenadetails` | `arena_name`, `capacity`, `arena_image_url` | N/A | Refresh on team sync and when arena id changes | Medium | Arena details are only refreshed when the surrounding team fetch runs. |
| Booking freshness | Matchmaker browse and publish | `matches` and `teamdetails` | `availabilityStatus`, `friendlyTeamId` | N/A | Recheck on page open and immediately before publish/challenge | High | Booking state is the most time-sensitive CHPP-derived signal in the app. |
| Live match refresh | Tournament view | `matchdetails` | `completed`, `status`, `went_120`, `home_goals`, `away_goals` | No | Poll / resync active and recently completed matches | Low | This is aligned with the repo's CHPP standards doc. |
| Fixture refresh | Tournament view | `matches` | `ht_match_id`, `match_type`, `status` | N/A | Refresh on demand and after relevant edits | Medium | The CHPP source is correct; the date estimate is the weaker part. |

### Derived Business Logic

| Feature | UI Location | Current Endpoint | Current Field | Better Endpoint Exists? | Recommended Source | Risk Level | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HFI detection | Auth callback, Matchmaker filters, team selection | `teamdetails` / `managercompendium` | `LeagueSystemID`, `LeagueID`, `LeagueName` | Partial | Prefer `LeagueSystemID` / `LeagueID`; avoid name fallback | High | The `leagueName.includes('femme')` fallback is not authoritative. |
| Friendly schedule estimation | Tournament refresh | Local country-name time table | `country_name` | Not a direct CHPP source in this repo | Keep as product logic, but store country ids | Medium | This is a scheduling heuristic, not CHPP truth. |
| Compatibility score | Matchmaker browse | Local heuristics | Request preferences and team metadata | N/A | Keep as heuristic only | Low | The score is intentionally approximate and should remain so. |
| Venue / location compatibility | Matchmaker browse and post forms | Local logic | `country_name`, `home_away` | Partial | Compare canonical ids where possible | High | Same-country checks should not depend on name strings. |
| Gender label rendering | Matchmaker, browse cards, modal, team list | Local display helper | `genderId` | No | `genderId === 0` as display-only HFI label | Low | This is fine as a presentation rule. |

## Source-of-Truth Conclusions

1. `matchdetails` is the authoritative source for ongoing or finished match state.
2. `matches` is the authoritative source for a team's upcoming and recent fixtures, and should be used for friendly booking detection.
3. `teamdetails` is authoritative for team metadata, including gender, arena id, logo, and the challengeability flags.
4. `managercompendium` is the correct login / ownership snapshot source.
5. `arenadetails` is the correct arena source.
6. `challenges` is the correct CHPP family for actual challenge management if and when that feature is implemented.
7. `worlddetails` and `leaguedetails` are the correct direction for canonical country and league normalization.

## Prioritized Findings

### Critical

1. Matchmaker booking state is still split across `teamdetails.FriendlyTeamID` and `matches`.
   - Complexity: Medium
   - Risk: High
   - Confidence: High
   - Why it matters: `matches` already exposes upcoming fixtures and booked friendlies. `FriendlyTeamID` is valid but weaker as a primary source for "can this team be used right now?".
   - Recommended fix: make `matches` the source of truth for booked-state detection everywhere, and keep `FriendlyTeamID` only as a corroborating hint.

### High

2. Country and league comparisons still use strings in multiple flows.
   - Complexity: Medium
   - Risk: High
   - Confidence: High
   - Why it matters: name-based checks are fragile and can break with localization, formatting, or stale cached data.
   - Recommended fix: compare canonical ids (`country_id`, `league_id`, `league_system_id`) and treat names as display-only.

3. HFI detection still has a name-based fallback.
   - Complexity: Low
   - Risk: High
   - Confidence: High
   - Why it matters: `leagueName.includes('femme')` is a heuristic, not a source of truth.
   - Recommended fix: keep `LeagueSystemID` / `LeagueID` as the decision path and remove name matching except as a last-resort debug fallback.

### Medium

4. Tournament fixture timing is estimated from local country-name tables.
   - Complexity: Medium
   - Risk: Medium
   - Confidence: Medium
   - Why it matters: the schedule is a product rule, but it can drift from the real CHPP-friendly schedule and cause misleading "available now" assumptions.
   - Recommended fix: keep it as UI logic if needed, but derive the country identity from ids and make the heuristic explicit in the UI.

5. Profile / manager snapshots are cached without a formal refresh policy.
   - Complexity: Medium
   - Risk: Medium
   - Confidence: High
   - Why it matters: stale country, avatar, or team-list data can linger until the next login or manual refresh.
   - Recommended fix: add a clear refresh window or explicit re-sync trigger for CHPP snapshots.

6. Supporter tier is available in the schema but not parsed into the app model.
   - Complexity: Low
   - Risk: Low
   - Confidence: High
   - Why it matters: not a correctness issue today, but the data is already there and can be surfaced cleanly if needed.
   - Recommended fix: parse `UserSupporterTier` from `managercompendium` if the UI needs it.

### Low

7. Generic CHPP proxy usage is acceptable but should remain a thin transport layer.
   - Complexity: Low
   - Risk: Low
   - Confidence: High
   - Why it matters: it is not the source-of-truth problem, but it can encourage ad hoc parsing if left as a catch-all.
   - Recommended fix: keep it for transport only; prefer endpoint-specific helpers for business logic.

## Recommended Migration Plan

1. Normalize identifiers first.
   - Store and compare `country_id`, `league_id`, `league_system_id`, and `gender_id` wherever possible.
   - Keep names only for display.

2. Make `matches` the single source of truth for friendly booking state.
   - Reuse the existing booking helper.
   - Remove any remaining primary logic that depends on `FriendlyTeamID` alone.

3. Keep `teamdetails` for metadata, not booking truth.
   - Use it for arena id, logo, gender, and challenge flags.
   - Do not use it to decide whether a friendly is already booked.

4. Keep `matchdetails` for live and finished match sync.
   - Continue including `matchEvents=true`.
   - Do not infer final match state from live feed data.

5. Add explicit refresh boundaries.
   - Refresh manager/team snapshots on login and Matchmaker entry.
   - Keep arena and booking data on a short refresh loop.

6. Treat HFI, country, and league names as presentation only.
   - Remove name-based fallback logic where the id is already present.

7. Only add `challenges` integration when actual challenge actions are implemented.
   - The docs support it.
   - The current product flow does not need it yet for the MVP.

## Notes

- The older audit was directionally correct about availability, country-string matching, and caching risk, but it did not separate canonical CHPP sources from local product heuristics.
- This report intentionally treats local scoring, local scheduling, and UI grouping as product logic rather than CHPP truth.
- No production code was modified for this audit.
