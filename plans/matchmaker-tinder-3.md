# Matchmaker Evolution Plan (MVP Refinement)

## Objective

Transition the Matchmaker (Tinder) feature from a mock-based demonstration to a real-data integrated system that supports anonymous browsing, per-action team selection, and admin-curated realistic ads using live Hattrick (CHPP) data.

## 1. Database & Persistence Updates

### `migrations/035_matchmaker_cleanup.sql`

* No structural changes to `matchmaker_views`.
* Ensure `matchmaker_requests` columns (`is_back_and_forth`, `is_long_term`, `gender_id`) are correctly indexed for performance.

## 2. API Implementation

### `api/matchmaker/admin-create.ts`

* New endpoint guarded by `issuperadmin` cookie or `DEV_MATCHMAKER_TEST_MODE`.
* **Input**: `{ managerId, matchType, opponentLocation, homeAway, isBackAndForth, isLongTerm, message }`.
* **Process**:
    1. Uses current admin token to fetch `managercompendium` for `managerId`.
    2. Picks the primary team (or first available).
    3. Fetches `teamdetails` and `arenadetails` for that team.
    4. Upserts records in `profiles` and `teams` (snapshotting name, logo, country, league, arena image, fanclub size).
    5. Creates an `open` request in `matchmaker_requests`.

### `api/matchmaker/reset.ts`

* New endpoint to delete all `matchmaker_views` for the authenticated `manager_ht_id`.
* Used by the "Start Again" UI button.

### `api/matchmaker/publish.ts`

* Refine existing logic to ensure it captures the full team/arena snapshot from CHPP during manual ad creation.

## 3. Frontend & UI Logic

### Matchmaker Swiping Stack (`Matchmaker.tsx`)

* **Anonymous Mode**: If user is not logged in:
  * Fetch all `status='open'` requests.
  * Filter out "skips" using local component state (cleared on refresh).
* **Authenticated Mode**: Continue using `matchmaker_views` to filter the stack.
* **"Start Again" Button**: Add to the empty state view when no more cards are left.

### Team Selection Modals

* **Challenge Modal**:
  * Triggered when ❤️ Challenge is clicked.
  * If user has >1 available team: Show a minimalistic red modal to select the challenging team.
  * Proceed to the Hattrick challenge URL with the selected team context.
* **Creation Modal**:
  * Redesign the "Create My Profile" flow.
  * Step 1: Select Team (if >1).
  * Step 2: Set Preferences (Message, Location, etc.).
  * Uses a clean "Tinder Red" style with `var(--radius-lg)`.

## 4. Visual Cleanup

* Remove hardcoded CSS values in `Matchmaker.module.sass`.
* Re-integrate with `globals.sass` variables for shadows, radiuses, and spacing.
* Ensure the design feels like part of the main site while maintaining its "Red Zone" identity.

## Verification & Testing

* **Admin Test**: Use the `/api/matchmaker/admin-create` to populate the 16 pioneer manager IDs.
* **Anonymous Test**: Verify swiping works without login (resetting on refresh).
* **Multi-Team Test**: Verify the "Challenge" modal appears correctly for managers with multiple teams.
* **Reset Test**: Verify "Start Again" clears persisted views.
