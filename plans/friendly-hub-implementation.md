# Plan: Friendly Hub (Matchmaker) Implementation

This plan transforms the current simple Marketplace into a comprehensive "Friendly Hub" (or "Friendly Matchmaker") with authenticated posting, rich metadata, filtering, and a teaser widget on the homepage.

## 1. Database Schema Evolution

Create a new migration to evolve the database structure.

### `marketplace_posts` Table (Updates)

- `manager_ht_id` (BIGINT, non-nullable): Track who posted.
- `league_id` (INT): For flags and country filtering.
- `match_type` (TEXT): '120min' (default), '90min'.
- `opponent_type` (TEXT): 'domestic', 'international', 'any'.
- `venue_type` (TEXT): 'home', 'away', 'any'.
- `match_day` (TEXT): 'Wednesday' (default), etc.
- `expires_at` (TIMESTAMP): Set to the next Thursday 06:00 HT time by default.
- `interest_count` (INT): Default 0.
- `status` (TEXT): 'open', 'interested', 'arranged', 'expired'.

### `marketplace_interests` Table (New)

- `id` (UUID, PK)
- `post_id` (UUID, FK to marketplace_posts)
- `manager_ht_id` (BIGINT): Who is interested.
- `team_id` (BIGINT): Which team they are offering.
- `message` (TEXT)
- `created_at` (TIMESTAMP)

## 2. Visual Utility & Logic

- Create `src/utils/marketplace.ts` to handle:
  - Expiry calculation (finding the next Thursday 06:00 HT).
  - Status detection (logic to auto-expire or check for arranged matches if possible).

## 3. Component Refactoring

### Homepage Teaser (`src/components/FriendlyMarketplace/FriendlyMarketplace.tsx`)

- Rename to something like `FriendlyHubTeaser`.
- Remove the posting form.
- Show "pulse" stats: "🔥 X teams looking for a 120min friendly".
- Show a list of latest 2-3 requests with flags and key info.
- Add "See all requests →" button linking to `/hub`.

### Friendly Request Card (`src/components/TinderWidget/RequestCard.tsx`)

- Rich UI with team logo (if available), flag, manager info.
- Clear display of requirements (120min, International, Venue).
- Action button: "I'm interested" (requires login).

## 4. New Page: Friendly Hub (`src/pages/Public/TinderWidget.tsx`)

- **Hero Section**: Social proof and "Post Request" button.
- **Main Layout**: Sidebar with filters (Region, Match type, etc.) and main grid of cards.
- **Posting Flow**: A modal using `useAuth` to allow the manager to pick one of their teams and set requirements.

## 5. Interaction Model

- Implement "I'm Interested" flow:
  - User clicks button -> Selects their own team -> Request saved in `marketplace_interests`.
  - Future: Trigger notification or automated challenge.

## 6. Implementation Phases

### Phase 1: The "Real" Marketplace (The Hub)

- Database migration.
- New `/hub` page with listing and filtering.
- OAuth-based posting modal.
- Homepage teaser update.

### Phase 2: Interactivity & Status (Future)

- "Interest" system.
- Automation of "Arranged" status.

## Verification

- Verify that only authenticated users can post.
- Verify that team selection works (no manual input).
- Verify that filters (Domestic/International) work.
- Verify that the homepage teaser correctly reflects live data.
