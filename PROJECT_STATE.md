# Project State

## Current Context
- **Last Updated:** 2026-05-31
- **Focus:** LineIcons migration, UI layout updates (2-column home page), and thumbnail integration.
- **Tech Stack:** Vite + React 19, TypeScript, React Router 7, Supabase, Sass, Vercel Functions, LineIcons.

## Database Schema (Supabase)
- `tournaments`: id, slug, name, admin_password, scoring_mode (120min/points), is_private, description, show_description, thumbnail_index.
- `teams`: id, tournament_id, name, ht_team_id, active, replacement_for_team_id, hattrick_user_id, oauth_token, logo_url, country_name, joined_via_oauth.
- `rounds`: tournament_id, round_number.
- `matches`: round_id, home_team_id, away_team_id, home_goals, away_goals, went_120, completed, venue_type.
- `oauth_temp_sessions`: Temporary storage for CHPP OAuth flow.

## Completed Features
- **Tournament Creation:** User can create a tournament with a slug and admin password. Random thumbnail and witty placeholder description assigned.
- **Tournament View:**
  - **Standings:** Automatic calculation based on match results. Supports "120min" and "Points" modes. Header features a square tournament thumbnail.
  - **Fixtures:** View rounds and match results.
  - **Join:** Manual team registration (HT Team ID + Name).
- **Admin Dashboard:**
  - **Settings:** Toggle privacy, update description.
  - **Team Management:** Add teams, deactivate teams, replace teams (during tournament).
  - **Scheduling:** Round Robin (Single/Double) and Recurring (continuous) modes.
  - **Result Entry:** Manual goal entry and 120min flag toggle. Scrap result feature added.
- **UI/UX:**
  - **Home Page:** Two-column layout (2:1). Tournament cards with thumbnails, team chips, and navigation arrows. Top 10 lists for teams and active tournaments.
  - **Iconography:** Migrated from Lucide to LineIcons.

## Pending Tasks
- [ ] **CHPP Validation:** Test OAuth flow once credentials are available.
- [ ] **CHPP Automation:** Automatic match result retrieval.
- [ ] **UI/UX Polish:** Improve mobile responsiveness and nostalgic aesthetic.
- [ ] **Error Handling:** More robust error states for Supabase queries.

## Recent Decisions
- Migrated to LineIcons for a cleaner, consistent visual style.
- Use 100% height thumbnails for tournament cards on the home page.
- Implement square thumbnails on the far left of table headers.
- Support "Scrap Result" in admin to allow clearing accidental entries.
