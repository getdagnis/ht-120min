# Project State

## Current Context
- **Last Updated:** 2026-05-31
- **Focus:** Context recovery and state documentation.
- **Tech Stack:** Vite + React 19, TypeScript, React Router 7, Supabase, Sass, Vercel Functions.

## Database Schema (Supabase)
- `tournaments`: id, slug, name, admin_password, scoring_mode (120min/points), is_private, description, show_description.
- `teams`: id, tournament_id, name, ht_team_id, active, replacement_for_team_id, hattrick_user_id, oauth_token, logo_url, country_name, joined_via_oauth.
- `rounds`: tournament_id, round_number.
- `matches`: round_id, home_team_id, away_team_id, home_goals, away_goals, went_120, completed, venue_type.
- `oauth_temp_sessions`: Temporary storage for CHPP OAuth flow.

## Completed Features
- **Tournament Creation:** User can create a tournament with a slug and admin password.
- **Tournament View:**
  - **Standings:** Automatic calculation based on match results. Supports "120min" and "Points" modes.
  - **Fixtures:** View rounds and match results.
  - **Join:** Manual team registration (HT Team ID + Name).
- **Admin Dashboard:**
  - **Settings:** Toggle privacy, update description.
  - **Team Management:** Add teams, deactivate teams, replace teams (during tournament).
  - **Scheduling:** Round Robin (Single/Double) and Recurring (continuous) modes.
  - **Result Entry:** Manual goal entry and 120min flag toggle.
- **CHPP Integration (Scaffolding):**
  - OAuth flow initiated via `api/auth/init`.
  - Callback handling and team data retrieval in `api/auth/callback`.
  - Pending CHPP license approval for production use.

## Pending Tasks
- [ ] **CHPP Validation:** Test OAuth flow once credentials are available.
- [ ] **CHPP Automation:** Automatic match result retrieval.
- [ ] **UI/UX Polish:** Improve mobile responsiveness and nostalgic aesthetic.
- [ ] **Error Handling:** More robust error states for Supabase queries.
- [ ] **Data Validation:** Ensure HT Team IDs are valid via CHPP (when available).

## Known Bugs / Issues
- Tech stack in `AGENTS.md` was incorrectly listed as Next.js (fixed).
- Public view and Admin view share a lot of logic/code; potential for refactoring.

## Recent Decisions
- Use Vercel Serverless Functions for CHPP OAuth to keep Supabase credentials secure.
- Support "Recurring" schedule mode for continuous community tournaments.
- "120min" mode prioritizes 120-minute matches over standard points in standings.
