# Plan: 120min Tinder (Friendly Matchmaker) - Refined

This plan implements a low-friction, Tinder-style "Friendly Matchmaker" for Hattrick managers to find 120-minute training partners.

## 1. Database Schema Evolution

Create a new migration for the matchmaker system using existing identity tables.

### `matchmaker_requests` Table (Revised)

- `id` (UUID, PK)
- `team_id` (UUID, FK to teams): The team seeking a friendly.
- `manager_ht_id` (BIGINT, FK to profiles): The requester.
- `match_type` (TEXT): '120min' (default), '90min_acceptable'.
- `opponent_location` (TEXT): 'domestic', 'international', 'any'.
- `home_away` (TEXT): 'home', 'away', 'any'.
- `match_day` (TEXT): Default 'Wednesday'.
- `time_window` (TEXT): Optional free text.
- `message` (TEXT): Optional notes.
- `status` (TEXT): 'open', 'matched', 'expired', 'cancelled'.
- `matched_with_team_id` (UUID, FK to teams, NULLABLE): The team that "Accepted".
- `matched_at` (TIMESTAMP, NULLABLE)
- `expires_at` (TIMESTAMP): Calculated based on friendly booking deadlines.
- `created_at` (TIMESTAMP)

### `matchmaker_views` Table (New)

- `id` (UUID, PK)
- `manager_ht_id` (BIGINT): The manager browsing.
- `request_id` (UUID): The request seen.
- `decision` (TEXT): 'skipped', 'matched'.
- `created_at` (TIMESTAMP)

## 2. UI Components

### Homepage Teaser (`src/components/FriendlyHub/MatchmakerTeaser.tsx`)

- High-impact CTA: "🔥 23 teams are searching for a 120 minute friendly".
- "Find My Match →" button.
- Small feed of "Recent searches" showing team flags and preferences.

### Matchmaker Page (`src/pages/Public/Matchmaker.tsx`)

- **Card-based UI**: One opponent at a time.
- **Actions**: Large [❌ Skip] and [❤️ Accept Match] buttons.
- **Team Selection**: When posting, query the `teams` table for the manager's verified teams.
- **Match Found Screen**: Immediate feedback after "Accept", linking to the Hattrick challenge page.

## 3. Logic & Utilities

### Expiry Calculation

- Use `global-match-times.json` (or a simplified version for now) to determine when friendlies close in various regions. Default to a safe early Tuesday cutoff if region-specific data is unavailable.

### Browsing Query

- Fetch requests where:
  - `status = 'open'`
  - `manager_ht_id != current_user`
  - `id NOT IN (SELECT request_id FROM matchmaker_views WHERE manager_ht_id = current_user)`
- Order by `random()`.

## 4. Implementation Phases

### Phase 1: The Matchmaker MVP

- Database migration (Requests + Views).
- Team selection from existing `teams` table.
- Create Request flow.
- "Swipe" (Card) browsing with Skip/Accept.
- Success screen with Hattrick link.

### Phase 2: Refinement

- Proper expiry logic using global times.
- Homepage high-impact widget.

## Verification

- Verify that "Accepted" requests disappear from the deck.
- Verify that "Skipped" requests don't reappear for the same manager.
- Verify that requests are tied to the internal `teams` UUIDs.
