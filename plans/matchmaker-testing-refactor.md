# Plan - Matchmaker Testing Strategy Refactor

We are refactoring the Matchmaker testing strategy to separate real user flows from admin seeding tools. This will involve cleaning up the production `/publish` endpoint and ensuring the `/admin-create` tool works correctly for seeding realistic data.

## Objectives

1.  **Clean `/api/matchmaker/publish.ts`**: Remove all impersonation and admin-bypass logic.
2.  **Verify/Refine `/api/matchmaker/admin-create.ts`**: Ensure it functions as a standalone seeder using admin credentials.
3.  **Data Seeding**: Populate the database with 20-50 realistic Matchmaker ads.
4.  **Verification**: Test both flows to ensure they work as intended.

## Key Files & Context

- `api/matchmaker/publish.ts`: The production endpoint for creating ads.
- `api/matchmaker/admin-create.ts`: The admin tool for seeding data.
- `api/_lib/matchmaker.ts`: Shared CHPP utility functions.
- `src/pages/Public/Matchmaker.tsx`: Frontend Matchmaker page.

## Implementation Steps

### 1. Refactor `/api/matchmaker/publish.ts`

- Remove `adminManagerId` from the request body destructuring.
- Remove `isAdmin` check and `effectiveManagerId` logic.
- Ensure `parsedManagerId` is strictly derived from the provided `managerId`.
- Force `created_by_admin` to `false` in the database insert.
- Ensure all real-world restrictions (booking checks, ownership checks) remain active.

### 2. Verify and Refine `/api/matchmaker/admin-create.ts`

- Ensure it correctly identifies the admin's token using `adminManagerId`.
- Verify it skips availability and ownership checks for the target manager.
- Ensure it sets `created_by_admin = true`.
- Improve error handling and response messages.

### 3. Frontend Cleanup (Optional)

- Optionally remove or disable the impersonation UI in `src/pages/Public/Matchmaker.tsx` to align with the new strategy.

### 4. Data Seeding

- Identify a list of target Hattrick manager IDs.
- Use `curl` or a script to call `/api/matchmaker/admin-create` multiple times to populate the app with realistic content.

## Verification & Testing

### Real User Flow
- Log in as a real Hattrick manager.
- Attempt to publish an ad for a team they own.
- Attempt to publish an ad for a team they DON'T own (should fail).
- Attempt to publish an ad for a team that already has a friendly (should fail).
- Verify the ad appears in "My Ads".

### Admin Seeding Flow
- Call `/api/matchmaker/admin-create` with valid admin credentials and a target manager ID.
- Verify that a realistic ad is created even if the team is already booked or not owned by the admin.
- Verify the ad appears in the browsing interface for other users.
- Verify `created_by_admin` is set to `true` in the database.
