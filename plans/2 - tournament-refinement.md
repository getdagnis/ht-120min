# 2 - Tournament Evolution & Management Refinement Plan

Evolve the tournament structure to support categories, seasons, and strict Hattrick-driven validation while enhancing admin security and stability.

## Objective

Implement tournament categories (Male/HFI), registration types (Validated/Manual-Data), seasons, and strict validation rules. Add safety nets for tournament health (25% rule) and a Super-Admin testing ground.

## Changes

### 1. Database & Schema Update

- **`tournaments` table**:
  - `league_category`: TEXT ('male' | 'hfi')
  - `registration_type`: TEXT ('validated' | 'manual')
  - `season`: INTEGER (default 1)
  - `is_test`: BOOLEAN (default false)
  - `status`: TEXT ('open' | 'active' | 'finished' | 'waiting')
- **`teams` table**:
  - `is_placeholder`: BOOLEAN (default false) - for BYE/Inactive spots in standings.

### 2. Tournament Creation (`src/pages/Create/CreateTournament.tsx`)

- **New Fields**:
  - **Tournament Category**: Dropdown with "Regular league (male)" and "Hattrick Femme International (HFI)".
  - **Tournament Type**: Dropdown with "Hattrick Validated (CHPP)" and "Self-Managed (Manual entry)".
    - _Validated_: Managers join personally.
    - _Self-Managed_: Organizer adds teams via "Get team data" (no personal manager OAuth required).
- **Subtitle**: All new tournaments default to "Season 1".
- **Strict Validation**: Eligibility is checked against the selected category immediately.

### 3. Tournament View & Standings (`src/pages/Public/TournamentView.tsx`)

- **UI & Seasons**:
  - Display "Season {tournament.season}" as a subtitle.
  - If `status === 'finished'`, show "Season {n}: Finished" and provide a "Start Season 2" waiting phase.
- **Standings Table**:
  - **Inactive/BYE Spots**: Display at the bottom of the table.
  - Replace name/stats with dashes ("-") and a `variant="zero"` **Invite** button in that row.
  - Remove the global invite button if these per-row buttons exist.
- **Tournament Health (25% Rule)**:
  - Prevent seeding if active teams are below the minimum quota.
  - **Pause Tournament** if > 25% of teams go inactive (exemptions for small 2-3 team "recurring friendlies").

### 4. Admin Panel & Management (`src/pages/Public/TournamentView.tsx`)

- **Confirmations**: Every action (Add, Revive, Replace, Seed) must trigger a `window.confirm` alert.
- **Seeding Info**: Add a warning for odd team counts and explain BYE point rules (challenges allowed).
- **Locking Settings**: Disable category/type selection if `teams.length > 0`. Lock to the existing team's category.
- **Surgical Deletion**:
  - If `isGenerated`: Deactivate (`active = false`).
  - If NOT `isGenerated`: Destroy relationship for the current season but preserve team history/stats.
- **Validation**:
  - Strict Error: "This team is not eligible for [HFI/male league] based tournament".
  - **ID Input**: Standardize as `type="text"` with regex `\D/g` (6-7 chars).
  - **Name Input**: **Always read-only**. Data MUST be fetched via "Get team data".
- **Super-Admin Features**:
  - Check for cookie `issuperadmin="you bet"`.
  - If present, show "Testing Ground" option and allow bypassing of male/female/country rules for testing.
- **Footer Actions**: Add "Archive", "Pause", and "Delete" buttons at the bottom of the admin panel.

### 5. Hattrick Integration & Auth

- **`api/auth/callback.ts`**: Enforce strict category checks.
- **`api/teams/info.ts`**: (Already created) Ensure it provides `leagueId` for strict category validation.

## Verification

1. Verify "Season 1" subtitle and locking of settings.
2. Verify "Get team data" is the ONLY way to populate the read-only Name field.
3. Verify strict "not eligible" message for category mismatches.
4. Verify inactive/bye spots appear at the bottom of standings with per-row Invite buttons.
5. Verify 25% rule pauses ongoing tournaments.
6. Verify Super-Admin bypasses for "Testing Ground" tournaments.
