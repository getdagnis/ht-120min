# AGENTS: CHPP Integration Standards

This document outlines the engineering standards and best practices for interacting with the Hattrick CHPP API within the HT-120min project.

## 1. Source of Truth

- **Match Details (`matchdetails.xml`)**: This is the **authoritative** source of truth for all matches (ongoing or finished). It contains definitive information about match status, final scores, finished dates, and extra time status.
- **Live Feed (`live.xml`)**: Use this only for lightweight monitoring of ongoing matches (e.g., polling for score updates). **Do not** rely on it for final match states or status transitions.

## 2. Robust Finish & Extra-Time Detection

When implementing match tracking, prioritize `matchdetails.xml`:

1. **Status Check**: Check `<MatchStatus>2</MatchStatus>` and the presence of a non-empty, non-zero `<FinishedDate>`.
2. **Extra-Time Detection**:
    - **Primary**: EventTypeID 70 (`Extension`) in `<EventList>` indicates extra time started.
    - **Secondary**: Scan `<MatchPart>` occurrences in the `EventList` for values 3 or 4.
    - **Tertiary**: Check for goals in `Scorers` list with `MatchPart` 3 or 4.
3. **Data Synchronization**: When a match is detected as finished via `matchdetails.xml`, perform a full synchronization with the Supabase database. This includes updating:
    - `home_goals` and `away_goals`
    - `completed: true`
    - `status: 'finished'`
    - `went_120`: Derived from EventTypeID 70 or MatchPart 3/4 detection.
    - `total_minutes`: 120 if `went_120` is true, 90 otherwise.

## 3. Data Integrity & Syncing

- **Ongoing Matches**: Sync live scores and ongoing status continuously.
- **Completed Matches**: Always allow for re-syncing of completed matches to ensure `went_120` and achievement points are calculated correctly. If a match is completed, a re-sync should *not* overwrite `went_120` to `false` if it was already `true`.
- **UI Refresh**: The UI refresh mechanism must trigger a re-check of both active and recently completed matches (missing achievement metadata) to ensure the standings table is always up-to-date without needing full page reloads.

## 4. API Request Configuration

- **Required Parameters**: When fetching `matchdetails.xml`, always include `matchEvents=true` to retrieve the `<EventList>`. Without this, event-based indicators (like `MatchPart` tags, `EventTypeID`, and `EventKey`) will be absent.
- **Explicit Versioning**: If an endpoint is missing expected fields, explicitly define the version (e.g., `version=3.1`) in the request parameters. Implicit versioning may default to lighter, stripped-down payloads that omit critical detail.

## 5. Debugging Execution Paths

If code changes do not appear reflected in production:

1. **Verify Execution Path**: Inject a unique log marker (`console.log`) or a temporary failure (`throw new Error`) at the start of the handler to definitively verify the expected code is running.
2. **Correlate Requests/Logs**: When handling multiple concurrent requests, use a unique `requestId` in both server logs and JSON responses to correlate them.
3. **Inspect Raw Payloads**: Do not rely on derived boolean logic (e.g., `isExtraTime`). Always log/inspect the *raw* API response payload (e.g., `console.log(xml.substring(...))`) to verify the server is receiving the expected data.
4. **Check Routing/Deployment**: Ensure the deployed commit on the server matches the local branch. If changes are ignored, assume a routing or deployment mismatch until proven otherwise.

## 6. Challenges API (note: this section is a rough draft, update as you proceed, improve it)

Before implementing, read:

- AGENTS.md
- PROJECT_STATE.md
- ROADMAP.md
- docs/chpp-audit.md
- docs/AGENTS_CHPP_INTEGRATION.md
- plans/temp/tinder_phase3.md
- docs/auth-flow.md
- docs/challenges.params.md, docs/challenges.schema.xml, docs/challenges.example.xml
- All Matchmaker-related Supabase tables and activity/event systems currently used by the project
