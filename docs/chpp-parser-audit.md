# CHPP Parser Coverage Audit

Scope: verify what each CHPP parser actually extracts, compare it with the official schema, and identify fields that are being ignored or could replace current heuristics.

This is a parser audit, not a source-selection audit.

Primary references:

- `api/_lib/chpp-xml.ts`
- `src/utils/chpp-xml.ts`
- `api/teams/info.ts`
- `api/teams/refresh-fixtures.ts`
- `api/chpp/live-matches.ts`
- `docs/managercompendium.schema.xml`
- `docs/teamdetails.schema.xml`
- `docs/arenadetails.schema.xml`
- `docs/matches.schema.xml`
- `docs/AGENTS_CHPP_INTEGRATION.md`
- `docs/challenges.params.md`

## Executive Summary

The shared parser layer is useful but incomplete.

The biggest parser-related risks are:

- `teamdetails` is parsed for `CountryName`, but `CountryID` is ignored, which makes localized country names leak into the data model.
- `teamdetails` is parsed for booking-related fields, but `FriendlyTeamID` is still used as a fallback signal in some flows.
- `managercompendium` is parsed for team discovery, but supporter tier, language, and several nested team fields are ignored.
- `arenadetails` is parsed correctly for `ArenaImage`, but image population still depends on the refresh/update path, not just the parser.
- There is a duplicated client-side XML helper in `src/utils/chpp-xml.ts` with the same omissions as the server helper.
- One route, `api/teams/info.ts`, still does ad hoc regex parsing instead of using the shared parser.

## Parser Coverage Matrix

### `managercompendium`

| Area | Parsed Now | Available in Schema | Missed Fields | Impact |
| --- | --- | --- | --- | --- |
| Manager identity | `hattrickUserId`, `managerName` | `UserID`, `Loginname` | `Language`, `Name`, `HasManagerLicense` | Low |
| Supporter status | Not parsed | `UserSupporterTier` | `UserSupporterTier` | Medium |
| Country | `countryId`, `countryName` | `CountryID`, `CountryName` | None on top-level country | Low |
| Avatar | Parsed as layered JSON | `Avatar` | None | Low |
| Team list | `teamId`, `teamName`, `genderId`, `leagueSystemId`, `leagueName`, `leagueId`, `leagueLevelUnitName`, `regionName`, `countryName` | `TeamID`, `TeamName`, `ShortTeamName`, `IsPrimaryClub`, `FoundedDate`, `IsDeactivated`, `GenderID`, `LeagueSystemID`, `Arena`, `League`, `Country`, `Region`, `HomePage`, `Cup`, `PowerRating`, `FriendlyTeamID`, `LeagueLevelUnit`, `NumberOfVictories`, `NumberOfUndefeated` | Many nested fields | Medium |

Notes:

- The parser is good enough for basic team discovery.
- It does not preserve enough of the nested team data to replace other heuristics later.
- If supporter status is wanted in UI, the field is already available in the schema and should be parsed here.

### `teamdetails`

| Area | Parsed Now | Available in Schema | Missed Fields | Impact |
| --- | --- | --- | --- | --- |
| Team identity | `teamId`, `teamName` | `TeamID`, `TeamName`, `ShortTeamName` | `ShortTeamName` | Low |
| Country | `countryName` only | `CountryID`, `CountryName` | `CountryID` | High |
| League / hierarchy | `genderId`, `leagueSystemId`-adjacent fields via some callers, `friendlyTeamId`, `possibleToChallengeMidweek`, `possibleToChallengeWeekend` | `LeagueID`, `LeagueName`, `LeagueLevelUnitID`, `LeagueLevelUnitName`, `LeagueLevel`, `LeagueSystemID` | `LeagueID`, `LeagueName`, `LeagueLevelUnitID`, `LeagueLevelUnitName`, `LeagueLevel`, `LeagueSystemID` | High |
| Arena pointer | `arenaId` | `ArenaID`, `ArenaName` | `ArenaName` | Low |
| Arena image / logo | `logoUrl` | `LogoURL`, `DressURI` | None for logo URL | Low |
| Fan club | `fanclubSize` | `FanclubID`, `FanclubName`, `FanclubSize` | `FanclubID`, `FanclubName` | Low |
| Booking state | `friendlyTeamId` | `FriendlyTeamID` | No direct parse of the full match list | Critical |

Notes:

- `CountryID` is present in the schema but not parsed. That is a real gap.
- The parser currently encourages name-based storage because it exposes `countryName` but not `countryId`.
- `FriendlyTeamID` is a valid field, but it should be treated as a hint, not the canonical booking truth, because the `matches` feed already exists for that purpose.

### `arenadetails`

| Area | Parsed Now | Available in Schema | Missed Fields | Impact |
| --- | --- | --- | --- | --- |
| Arena identity | `arenaId`, `arenaName` | `ArenaID`, `ArenaName` | None | Low |
| Arena image | `arenaImageUrl` from `ArenaImage` | `ArenaImage`, `ArenaFallbackImage` | `ArenaFallbackImage` | Low |
| Capacity | `capacity` | `CurrentCapacity.Total`, plus breakdowns | `Terraces`, `Basic`, `Roof`, `VIP`, `RebuiltDate`, `ExpandedCapacity` | Medium |
| Team / league / region metadata | Not parsed | `Team`, `League`, `Region` | All of them | Low |

Notes:

- The parser is correctly reading `ArenaImage` from the schema.
- If arena images are missing in the DB, the most likely causes are refresh/backfill logic or stale rows, not a wrong field name in the parser.

### `matches`

| Area | Parsed Now | Available in Schema | Missed Fields | Impact |
| --- | --- | --- | --- | --- |
| Match identity | `matchId` | `MatchID` | None | Low |
| Timing | `matchDate` | `MatchDate` | None | Low |
| Type | `matchType` | `MatchType` | None | Low |
| Teams | `homeTeamId`, `awayTeamId` | `HomeTeam`, `AwayTeam` nested ids and names | `HomeTeamName`, `AwayTeamName`, short names | Low |
| Status | `status` | `Status` | None | Low |
| Context / cup data | Not parsed | `MatchContextId`, `CupLevel`, `CupLevelIndex`, `SourceSystem` | All of them | Low |
| Score details | Not parsed | `HomeGoals`, `AwayGoals` | Both goals | Low |
| Orders | Not parsed | `OrdersGiven` | `OrdersGiven` | Low |

Notes:

- This parser is sufficient for booking detection.
- If the UI ever needs richer upcoming-match display, `HomeTeamName`, `AwayTeamName`, and `MatchContextId` are already available in the schema.

### `matchdetails`

`api/_lib/chpp-match-events.ts` is the shared structured event parser. It is used by both `api/chpp/live-matches.ts` and manual linking in `api/teams/refresh-fixtures.ts`.

| Area | Parsed Now | Available in Schema | Missed Fields | Impact |
| --- | --- | --- | --- | --- |
| Match completion | `FinishedDate`, `MatchStatus` check | `FinishedDate`, `MatchStatus` | None for current use | Low |
| Score | `HomeGoals`, `AwayGoals` | `HomeGoals`, `AwayGoals` | None | Low |
| Extra time | `AddedMinutes`, `MatchPart` checks in `EventList` | `EventList`, `MatchPart`, `EventTypeID` | None for current sync | Low |
| Venue mismatch | `HomeTeamID`, `AwayTeamID` | `HomeTeam`, `AwayTeam` nested ids | `HomeTeamName`, `AwayTeamName` | Low |
| Cards | `510-514`, player, minute, subtype | `Bookings`, `EventList` | No player names retained in fixture JSON | Low |
| Injuries | type, player, minute, location, doctor weeks, foul flag | `Injuries`, `401-423`, `454` | Later competition rules may add more injury lifecycle events | Medium |

Notes:

- The event parser relies on structured XML only; it does not inspect localized event text.
- Event data is mapped from actual CHPP sides to scheduled fixture sides before it is written to `matches.match_event_details`.

### Ad hoc parsing in `api/teams/info.ts`

This route does not use the shared parser and instead extracts fields with regex.

| Field | Parsed Now | Available in Schema | Better Coverage in Shared Parser | Impact |
| --- | --- | --- | --- | --- |
| Team name | Yes | Yes | Yes | Low |
| League ID | Yes | Yes | Yes | Low |
| League system ID | Yes | Yes | No, not currently in shared `ParsedTeamDetails` return path for this route | Medium |
| League name | Yes | Yes | Yes | Low |
| Country name | Yes | Yes | No, country id is still missing | High |
| Gender | Yes | Yes | Yes | Low |

Notes:

- This route is a source of parser drift.
- It should either reuse the shared parser or at least mirror its field coverage.
- It currently keeps `countryName` only, which is exactly the kind of localization risk that later leaks into validation and storage.

## Parser Gaps Worth Fixing

### Critical

1. `teamdetails` does not parse `CountryID`.
   - Complexity: Low
   - Risk: High
   - Confidence: High
   - Why it matters: the app currently stores and compares country names, which is fragile and can be localized or otherwise unstable.
   - Recommended fix: parse and persist `CountryID`, then derive display names from canonical country metadata.

2. Booking-related code still treats `FriendlyTeamID` as a useful fallback instead of a secondary hint.
   - Complexity: Medium
   - Risk: High
   - Confidence: High
   - Why it matters: the `matches` feed is already the better source for upcoming friendlies.
   - Recommended fix: keep `FriendlyTeamID` for cross-checking only, not as the primary source of booking state.

### High

1. `api/teams/info.ts` performs bespoke regex parsing.
   - Complexity: Low
   - Risk: Medium
   - Confidence: High
   - Why it matters: bespoke parsing tends to lag behind the shared parser and can silently omit fields.
   - Recommended fix: route this through the shared parser or align the extracted fields with it.

2. `managercompendium` parsing misses `UserSupporterTier`.
   - Complexity: Low
   - Risk: Medium
   - Confidence: High
   - Why it matters: the field already exists in CHPP and can be surfaced without additional API calls.
   - Recommended fix: add it to the parsed manager snapshot if the UI needs it.

### Medium

1. `arenadetails` parsing is correct, but backfill behavior is not guaranteed.
   - Complexity: Medium
   - Risk: Medium
   - Confidence: High
   - Why it matters: images can stay empty if old rows never get refreshed after the arena sync path exists.
   - Recommended fix: add a one-time backfill or re-sync pass for existing teams, then keep opportunistic refresh.

2. `matches` parser does not retain `HomeTeamName`, `AwayTeamName`, or `MatchContextId`.
   - Complexity: Low
   - Risk: Low
   - Confidence: High
   - Why it matters: not required for booking detection, but useful if the browse UI ever shows richer upcoming match context.
   - Recommended fix: keep as-is for now unless UI needs those fields.

## Arena Image Investigation

Current state:

- `parseArenaDetailsXml()` reads `ArenaImage` and normalizes it into `arenaImageUrl`.
- `api/matchmaker/teams.ts` and `api/matchmaker/admin-create.ts` both write `arena_image_url` when arena details are fetched.

Most likely failure modes:

1. Existing team rows were created before arena sync existed and never got refreshed.
2. The row already has a non-null `arena_image_url`, so the opportunistic update path skips it.
3. The team details fetch succeeded but the arena details fetch failed or was skipped because `arenaId` was missing.

Conclusion:

- This does not look like a parser field-name problem.
- It looks like a refresh/backfill problem, with the parser itself already reading the correct arena image field.

## Country Name Localization Risk

Current state:

- The code stores `countryName` from CHPP responses in multiple tables and uses it for equality checks, flags, and scheduling.
- The shared `teamdetails` parser does not preserve `CountryID`.
- `api/teams/info.ts` also extracts `countryName` directly.

Why this is risky:

- Names are display values.
- Ids are identifiers.
- If the CHPP response is localized, or if the app receives names in a manager language, name-based storage can drift immediately.

Recommended architecture:

- Parse `CountryID` wherever it exists.
- Persist `country_id`.
- Build a canonical country mapping for names, flags, and friendly times.
- Treat `countryName` as display-only.

## Recommended Follow-Up Plan

1. Expand `parseTeamDetailsXml()` to keep `CountryID`, `LeagueID`, `LeagueSystemID`, and `ArenaName` where available.
2. Add `UserSupporterTier` to `parseManagerCompendiumXml()` if the UI wants it.
3. Replace the ad hoc parsing in `api/teams/info.ts` with the shared parser or a wrapper around it.
4. Add a backfill job or one-time resync for `arena_image_url` on existing teams.
5. Introduce a canonical country layer and stop using `countryName` as an identifier.

## Notes

- The parser layer is not the only problem, but it is a major source of drift when fields are available in CHPP and not preserved in the app model.
- This audit intentionally focuses on extraction coverage, not on which endpoint should be used for a given business rule.
- No production code was modified for this audit.
