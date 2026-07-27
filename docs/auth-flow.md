# HT-120min Authentication & Tournament Flows

This document outlines the three primary Hattrick OAuth-based flows in the application: **Standalone Login**, **Join Tournament**, and **Create Tournament**.

## 1. Flow Comparison Table

| Feature | **Standalone Login** | **Join Tournament** | **Create Tournament** |
| :--- | :--- | :--- | :--- |
| **Trigger** | "Login" button (Header) | "Join" button (TournamentView) | "Create" button (Home/Header) |
| **Initial Request** | `/api/auth/init` | `/api/auth/init?tournament_id={id}` | `/api/auth/init?is_creation=true` |
| **Redirect After OAuth** | `/auth/callback?token=...` | `/t/{slug}?token=...` | `/create?step=teams&token=...` |
| **Finalization API** | `/api/auth/complete` | `/api/auth/complete` | `/api/auth/complete` |
| **Required User Data** | Manager Name, User ID | Team Selection, Manager Details | Team Selection, Manager Details |
| **DB Side Effects** | Profile Upsert | Profile Upsert + `teams` entry | Profile Upsert + Data for Tournament Creation |
| **Resulting UI** | User Dropdown updated | Tournament Standings updated | Form moves to "Finalize" step |

## 2. Shared Infrastructure

### Services & Tables

- **Hattrick CHPP**: The external source of truth for manager and team data.
- **Supabase**: Used for persistent storage (`profiles`, `teams`, `tournaments`) and session management (`oauth_temp_sessions`).
- **`oauth_temp_sessions`**: Temporary table used to maintain state across the OAuth redirect loop. Stores tokens, retrieved manager details, and eligible teams.

### Core Stages (The "3-Step Handshake")

1. **Init (`/api/auth/init`)**:
    - Generates a request token from Hattrick.
    - Stores `tournament_id` or `is_creation` flag in `oauth_temp_sessions`.
    - Redirects user to Hattrick Authorization page.

2. **Callback (`/api/auth/callback`)**:
    - Exchanges verifier for an access token.
    - Fetches `managercompendium` XML from Hattrick.
    - Filters eligible teams based on league category (male/HFI) and country limits.
    - Generates a `selection_token` and updates the temporary session with retrieved data.
    - **Branching Point**: Determines the redirect URL based on the initial intent (Login, Join, or Create).

3. **Complete (`/api/auth/complete`)**:
    - Retrieves the temporary session using the `selection_token`.
    - Upserts the manager's `profile` (Avatar, Name, Country).
    - If joining: Registers the specific team in the `teams` table.
    - Returns a JSON response containing the user details and the final redirect URL.

---

## 3. Flow Details

### A. Standalone Login Flow

*Goal: Just log in to see "My Profile" or switch themes.*

- **Logic**: No `tournament_id` is passed. The user is redirected to a generic `/auth/callback` page which immediately calls `/api/auth/complete`.
- **UI**: Header updates from "Login" to "Manager Name".

### B. Join Tournament Flow

*Goal: Register a specific team in an existing tournament.*

- **Logic**: `tournament_id` is carried through the flow. The user is redirected back to the specific tournament page.
- **UI**: A modal appears on the tournament page asking the user to pick one of their eligible teams. Upon selection, the join is finalized.

### C. Create Tournament Flow

*Goal: Link a Hattrick manager to a new tournament before its creation.*

- **Logic**: `is_creation=true` is set. The user is redirected to the `/create` flow.
- **UI**: The creation form's "Step 2" (Team Selection) is automatically populated with the user's data.

## 4. Troubleshooting Overlaps

The system distinguishes flows using the `oauth_temp_sessions` table.

- If `is_creation` is true: It's a **Create** flow.
- If `tournament_id` is present but `is_creation` is false: It's a **Join** flow.
- If neither is present: It's a **Standalone Login**.
