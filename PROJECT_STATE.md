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
