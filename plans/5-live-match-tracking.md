# Plan: Live Match Tracking

Implement automatic live match tracking for tournaments, displaying ongoing scores and updating final results when matches conclude.

## Objective
- Detect matches past their start time.
- Fetch live scores from Hattrick CHPP Live API.
- Update UI with "Ongoing" status and real-time scores every 30 seconds.
- Automatically save final results to Supabase when matches finish.

## Proposed Changes

### 1. Backend: Live Matches API
- Create `api/chpp/live-matches.ts`:
  - Accepts a list of `ht_match_id`.
  - Uses `live.xml` CHPP file to get current status and scores.
  - Returns a mapping of `htMatchId` to `{ status: 'ongoing' | 'finished', homeGoals, awayGoals }`.

### 2. Frontend: Live Tracking Hook
- Create `src/hooks/useLiveMatches.ts`:
  - Input: Array of matches from the current tournament.
  - Logic:
    - Filter matches: `status === 'arranged' && ht_match_id && !completed && now > match_date`.
    - If live matches exist, poll `/api/chpp/live-matches` every 30 seconds.
    - Update local state with live scores.
    - If a match is reported as `finished`, call a backend endpoint to finalize the result in Supabase.

### 3. Frontend: Component Updates
- **`FixtureCard.tsx`**:
  - Add `isLive` prop or detect `ongoing` status.
  - Display "Ongoing" badge (green) when active.
  - Show live score updates.
- **`TournamentView.tsx`**:
  - Integrate `useLiveMatches` hook.
  - Pass live scores to `FixtureCard`.
  - Handle automatic data refresh when a match finishes.

### 4. Backend: Match Finalization
- Create or update an endpoint (e.g., `api/teams/finalize-match.ts`) to:
  - Verify match completion via CHPP.
  - Update the `matches` table in Supabase with final `home_goals`, `away_goals`, and `completed: true`.

## Verification Plan
1. **Mock Testing**: Use mock CHPP responses simulating ongoing and finished matches.
2. **UI Verification**: Ensure "Ongoing" badge appears and scores update without page refresh.
3. **End-to-End**: Verify that finished matches are correctly saved to the database and the UI reflects the "Finished" state.
