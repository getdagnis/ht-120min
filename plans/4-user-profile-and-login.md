# Plan: User Profile and Login Improvements

This plan outlines the improvements to the login logic, the addition of a user dropdown, and the implementation of a "My Profile" modal.

## 1. Objectives

- Improve login logic by making the login/user button persistent across all screens.
- Implement a dropdown for the logged-in user with "Active in: [Tournament]" and "My Profile" links.
- Create a "My Profile" modal displaying comprehensive manager information, including HT avatar, registered teams, and achievements.
- Enhance the header layout to accommodate both action buttons (Create/Join) and the user button.

## 2. Key Files & Context

- `src/components/Layout/Layout.tsx`: Header and navigation logic.
- `src/components/ProfileModal/`: New directory for the profile modal component.
- `api/chpp/managerdetails.ts`: New API endpoint to fetch Hattrick manager details.
- `src/hooks/useAuth.ts`: New hook to manage user state and profile data.
- `supabase-schema.sql`: Reference for teams and tournament data.

## 3. Implementation Steps

### Phase 1: API & Data Fetching

1.  **Database Migration**:
    - Create a `profiles` table to store persistent user data:
      ```sql
      CREATE TABLE profiles (
        hattrick_user_id BIGINT PRIMARY KEY,
        manager_name TEXT NOT NULL,
        country_id INTEGER,
        country_name TEXT,
        avatar_json JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
      ```
2.  **Create `api/chpp/managerdetails.ts`**:
    - Implement a POST handler that takes `access_token` and `access_token_secret`.
    - Fetch `managercompendium.xml` from CHPP.
    - Parse and return manager details (avatar, country, teams).
3.  **Update `api/auth/complete.ts`**:
    - After successful registration, fetch manager details from CHPP and upsert into the `profiles` table.
4.  **Create `src/hooks/useAuth.ts`**:
    - Manage `managerName`, `hattrickUserId`, and `accessToken` state.
    - Provide functions for logging in, logging out, and fetching profile data.
    - Fetch user's active tournaments and profile from Supabase.

### Phase 2: UI Components

1.  **Create `src/components/ProfileModal/ProfileModal.tsx`**:
    - Design a modal that displays:
      - Hattrick Avatar (rendered from layers).
      - Manager Name and join date.
      - Country name/flag with a link to Hattrick.
      - Registered teams on HT-120min.
      - Tournaments participated in with team details.
      - HT-120min achievements (Medal, Registration date, First tournament).
2.  **Create `src/components/Avatar/Avatar.tsx`**:
    - A component to render the Hattrick avatar using the layer data from CHPP.

### Phase 3: Layout Updates

1.  **Update `src/components/Layout/Layout.tsx`**:
    - Refactor the header to show:
      - Logo (left).
      - Action Button (right):
        - On Home / Tournament / Other pages: "CREATE TOURNAMENT" (links to `/create`).
        - On Create page: "JOIN TOURNAMENT" (scrolls to `opentours` on home or redirects to home).
      - User Button / Login Button (right):
        - If not logged in: "Login (CHPP)".
        - If logged in: "[Manager Name]" with a dropdown.
    - Ensure both buttons are visible on mobile (icons only if necessary).
    - Implement the User Dropdown:
      - "Active in: [Tournament Title]" (link to the most recently joined tournament).
      - "My Profile" (opens the `ProfileModal`).
    - Trigger `ProfileModal` from the dropdown.

### Phase 4: Integration

1.  **Wire up the components**:
    - Integrate `useAuth` into `Layout.tsx`.
    - Pass profile data to `ProfileModal`.
    - Ensure theme toggling still works correctly.

## 4. Verification & Testing

- **Login Flow**: Verify that logging in works and updates the header immediately.
- **Dropdown**: Test the dropdown on different pages and ensure it shows the correct active tournament.
- **Profile Modal**: Check if all manager data, including the avatar, is displayed correctly.
- **Mobile View**: Ensure the header and modal are responsive and look good on small screens.
- **API**: Test the `managerdetails` endpoint with valid tokens.
