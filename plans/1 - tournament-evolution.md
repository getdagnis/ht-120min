# Tournament Evolution Plan

Transition tournaments to categorized, seasonal entities with strict validation and enhanced admin security.

## Objective

Implement tournament categories, registration types, seasons, and Super-Admin features while standardizing management actions.

## Changes

### 1. Database & Schema

- **`migrations/012_tournament_evolution.sql`**:
  - Add `registration_type` (validated | manual).
  - Add `is_test` (boolean).
  - Add `season` (integer, default 1).<div className={styles.}></div>

### 2. Tournament Creation (`src/pages/Create/CreateTournament.tsx`)

- Add **Tournament Category** dropdown: "Regular league (male)" (default), "Hattrick Femme International (HFI)".
- Add **Tournament Type** selection: "Hattrick Validated (CHPP)" (default), "Self-Managed (Manual entry)". Hattrick Validated — means that only a user who manages that team can join with it to a tournament. Self-managed — team data is still retrieved from HT via CHPP but organizer is allowed to do so without managers permission (if I understand correctly that that is possible). Completely manually adding teams should not be possible.
- Update `handleHattrickLink` and `handleFinalSubmit` to include these new fields.
- Ensure all new tournaments start with `Season 1`.

### 3. Tournament View & Admin (`src/pages/Public/TournamentView.tsx`)

- **UI Enhancements**:
  - Show "Season {tournament.season}" subtitle below the main title. Once season 1 is fully finished, status changes to `Season 1: Finished` and the tournament goes into a waiting phase if the organizer wants to revive it and go for a Season 2. History panel‘ and hall of fame appears next to
  - Season count is fully updated only when a season is fully finished. If a season is not fully finished (reset/rescheduled), season count is not updated.
- **Lock Settings**: Disable the League Type/Category dropdown if `teams.length > 0`. Lock it into the only possible option based on the already registerd team.
- **Management Confirmations**:
  - Add `window.confirm` to `addTeam`, `reviveTeam`, `replaceTeam`, and `generateSchedule`.
  - **Seeding Fixtures**: Add a specific warning for odd team counts and explain BYE rules (challenges allowed for points).
  - When a "bye team" (missing team) or an inactive team is present in a tournament, it gets a spot on the very bottom of the league standings with "-" dashes in place of all scores and instead of any name it has a variant="zero" button Invite in its place (remove existing invite button), but it always stays on the bottom of the league.
  - **Losing teams** If more than 25% teams become inactive in a ongoing tournament, it goes into a paused state until minimum quota is reached or schedule is reset and rescheduled (no teams allowed to become non-existant in tournaments of up to 5 teams, one team is allowed to go inactive in 6 tournament teams but not in 7 (as there already is one bye spot), and then upwards strictly more than 25% are not allowed). Same applies to generating a schedule - cannot generate one without the quota. This DOES NOT apply to tournaments (or rather "recurring friendlies" de facto) that are initially generated between 2-3 teams.
- **Archive** add delete/archive/pause button at the bottom of a tournament. Archive only if it has any history/seasons finished before, delete if it has no history and less than 4 teams present. Archived can be in theory revived by organizers or superusers, but deleted and without history are gone forever.
- **Surgical Deletion Logic**:
  - If `isGenerated`: Deactivate team (active = false).
  - If NOT `isGenerated`: DON'T hard delete team from DB, only destroy any relationship between that team and that season of that tournament. Keep the team and the rest of its history (e.g. past trophies, participations, minutes scored, places achieved as well as registration date 100% in tact).
- **Strict Validation**:
  - In `addTeam` and `fetchTeamData`, use a very strict error message: "This team is not eligible for [HFI/male league] based tournament".
  - Standardize team ID input fields. Currently some seem to be text input fields, some number. I prefer text + regex as arrow addition/deduction buttons make no sense anyway. They should remember equally the previously entered ID values, all the same way, so names and types must match. I believe 6-7 characters is the way to go, although I suspect there might be some 5 digit teams out there but I'll drop it to 5 only if I actually enounter one.
- **Super-Admin Features**:
  - Check for cookie `issuperadmin="you bet"`.
  - If present, show "Testing Ground" option in admin and allow viewing of `is_test` tournaments.
  - Has the option to switch back and forth between otherwise hard rules — e.g. both male/female options are available always, same for countries. When adding a new team for testing purposes, its eligibility is checked against this rule not against other teams in the tournament.
- **Result Entry Logic**:
  - Disable `setEditingMatch` (entering results) if `tournament.registration_type === 'validated'`.
- **Archive Logic Fix**:
  - Ensure `checkArchiveStatus` correctly counts active validated teams and doesn't fire prematurely.

### 4. API & Auth

- **`api/auth/callback.ts`**: Update team filtering to use the new `league_type` strictly.
- **`src/pages/Public/OAuthTeamSelect.tsx`**: Ensure validation uses the category set at creation.

## Verification

1. Verify Category and Type are selectable at creation.
2. Verify "Season 1" appears in the header.
3. Verify Category cannot be changed once teams are added.
4. Verify "Enter Result" is hidden for validated tournaments.
5. Verify hard delete vs. deactivation logic.
6. Verify Super-Admin cookie grants access to test mode.
