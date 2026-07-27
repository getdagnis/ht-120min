# Plan: Fixture Refresh and Precise Match Minutes (Revised v2)

This plan addresses the fixture refresh stuck behavior and results display, ensuring strict alignment with the Hattrick (CHPP) API schedule rules.

## Hattrick Schedule Domain Rules (Saved to Memory)
1. **No Advanced Booking**: Friendlies cannot be booked two weeks ahead.
2. **Thursday 6 AM Rule**: Future round matches can only be detected/refreshed after Thursday 6:00 AM Swedish Time, when all friendlies globally from the previous week are finished.
3. **Guam Context**: Friendlies are played on Wednesday 04:15 Hattrick Time. Refreshing before Thursday is a waste of egress resources.

## Objective
- Fix the `upcomingRound` selection logic so it doesn't get stuck on past rounds with `misarranged` (unplayed) matches.
- Restore UI features (collapsing past rounds, showing round dates).
- Implement precise match minutes tracking using Hattrick's `AddedMinutes`.
- Improve sorting of match data.
- Use "Hattrick Time" (Europe/Stockholm) for all date operations.

## Key Files & Context
- `api/teams/refresh-fixtures.ts`
- `api/chpp/live-matches.ts`
- `src/components/TournamentTabs/FixturesView.tsx`
- `src/pages/Public/TournamentView.tsx`

## Proposed Changes

### 1. Fix "Stuck" Round Refresh (`api/teams/refresh-fixtures.ts`)
- **Fix Match Type:** Ensure `matchType=5` is used.
- **Fix Upcoming Round Logic:** A match should be considered "resolved" if it is `completed` OR if it is `misarranged` and the match date has already passed. This allows the `upcomingRound` pointer to correctly advance to Round 2 on Thursday.
- **Hattrick Time Alignment:** Ensure `calculateMatchDate` precisely reflects Swedish Time.

### 2. Precise Match Minutes (`api/chpp/live-matches.ts`)
- **Update Finish Logic:** When a match finishes, fetch `matchdetails.xml` and extract `<AddedMinutes>`.
- **Total Minutes Calculation:** `total_minutes = (went_120 ? 120 : 90) + AddedMinutes`.

### 3. UI Restorations (`src/components/TournamentTabs/FixturesView.tsx`)
- **Collapse Past Rounds:** Collapse all rounds before the active `upcomingRoundIndex`.
- **Restore Round Dates:** Display the calculated round date in the header.

### 4. Sorting (`src/pages/Public/TournamentView.tsx`)
- Sort matches by date/time within each round grouping.

## Verification & Testing
- Verify that triggering a refresh now correctly targets Round 2 (since today is Thursday and Round 1 is past).
- Verify `AddedMinutes` is correctly applied to finished matches.
