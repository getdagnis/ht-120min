# Project State - HT-120 Tournament Manager

## Technical Implementation Details

### Data Fetching & Egress Optimization

- **Egress Reduction**: Re-factored all `supabase.from(...).select('*')` queries in `TournamentView.tsx` to explicitly select only necessary fields. This drastically reduces the payload size and egress costs.
- **Polling Strategy**: Implemented intelligent polling for the tournament chat. It fetches data on load, then uses `setInterval` with dynamic intervals (5s, 20s, or 60s) based on message activity (message age), balancing "live" feel with bandwidth efficiency.

### UI/UX Refinement

- **Standings Table**:
  - Now displays `manager_name` for teams, fetched from the `teams` table.
  - Uses a CSS Grid layout (2/3 main, 1/3 sidebar) to organize tournament data.
- **Tournament Chat**:
  - **UX**: Messages are aligned right (for current user, name hidden) and left (for others, name shown).
  - **Performance**: Messages are container-scrollable (not page-scrollable) with `flex: 1` and `overflow-y: auto`.
  - **Stability**: Fixed double-posting bug by relying exclusively on Supabase Realtime for state synchronization.

### Dev Environment Configuration

- **vercel.json**: Updated `rewrites` to use the pattern `"/((?!.*\\.).*)"` to correctly distinguish between SPA routes and static assets, preventing local dev server crashes when resolving JS/CSS files.
- **Git Tracking**: File is tracked to ensure production deployments work (`vercel --prod`), but local changes that would crash the dev server are handled via `git update-index --skip-worktree` or manual management.

## Current Task State

1. [DONE] Define and implement `fixture_warnings` database schema.
2. [DONE] Update `MatchWithTeams` interface and query to fetch manager data.
3. [DONE] Finalize `FixtureCard.module.sass` (v3 mockup).
4. [DONE] Implement `refresh-fixtures.ts` schedule-to-friendly comparison.
5. [DONE] Integrate `FixtureCard` into `TournamentView.tsx` and implement refresh triggers.
6. [DONE] Implement intelligent fixture refresh (15m rule) and optimized upcoming round check.
7. [DONE] Implement Match ID storage for deep-linking.
8. [DONE] URL-based tab deep-linking.
9. [DONE] Admin recovery email UI & setup.
10. [DONE] Image modal for tournament banner.
11. [DONE] Isolate Join and Login OAuth flows, implement tournament participation safeguard, fix UI refresh on join, and reintroduce team logo fetching in creation flow.
12. [TODO] **Live Match Tracking**: Backend polling, status transitions (ongoing), and frontend UI polling. (PENDING - Test target: Wednesday).
