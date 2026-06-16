# Project State - HT-120 Tournament Manager

## Core Platform Functionality

### 1. Identity & Hattrick Integration

- **CHPP OAuth 1.0a**: Fully functional handshake flow (Request -> Authorize -> Access Token).
- **Manager Profiles**: Centralized `profiles` table syncing manager names, home leagues, and Hattrick avatars.
- **Global Profile Viewing**: Internal `ProfileModal` for inspecting any manager's Hattrick identity and registered teams.

### 2. Tournament Management

- **Automated Participation**: Managers join tournaments by selecting from their real Hattrick teams (multi-team support).
- **Flexible Scheduling**: Admin tools to generate Round Robin (Single/Double) or Recurring schedules.
- **Fixture Warnings**: Automated detection of misarranged or missing friendlies by comparing Hattrick schedules with tournament fixtures.

### 3. Live Experience

- **Live Match Tracking**: Real-time polling of ongoing matches with event detection (Goals, Cards, Injuries) and automated "Match Finished" transitions.
- **Tournament Chat**: Per-tournament real-time communication with specialized "System Messages" for administrative reporting and match event simulation.
- **News & Announcements**: Dedicated tab for official tournament updates and team-specific news posts.

### 4. Administrative Controls

- **Admin Dashboard**: Full control over tournament settings, team registration, and manual result entry.
- **Match Simulator**: Playground for admins to broadcast simulated match events to the community chat.
- **Egress Optimization**: Precision data fetching (explicit field selection) to minimize bandwidth and egress costs.

## Missing / In-Progress Functionality

- **LeagueID Discrepancy**: Standardizing byline links to use the specific team's LeagueID instead of the manager's home league.
- **Automated Challenges**: Implementation of `challenges.xml` to send friendly invites directly from the platform (requires CHPP write-access verification).
- **Advanced Statistics**: Weekly round highlights, "120m Specialist" leaderboards, and historical performance tracking.
- **Monetization (PRO)**: Infrastructure for premium tournament features and custom branding.
- **Tournament roles**: Participants should be able to apply and with admin's accept fill specific tournament roles, such as "press secretary" and more (needs a list)

### 4. 120min Matchmaker (Tinder)

- **Team Availability Tracking**: Real-time CHPP checks to identify which manager teams are available for friendlies on upcoming matchup dates.
- **Request Posting**: Managers can post friendly requests with specific preferences (Location, Venue, Match Type).
- **Instant Matching**: Swipe-style browsing of opponents with one-click acceptance and automatic Hattrick challenge linking.
- **Developer Scenarios**: Mock data layer for testing diverse UX states without relying on real Hattrick schedules.

## Recent Architectural Updates

- **Matchmaker Logic Fixes**: Corrected inverted team selection logic, fixed Supabase query typos, and eliminated redundant UI fragments.
- **Improved Accept Flow**: Enhanced the match acceptance process to require explicit team selection when a manager has multiple available teams, preventing accidental bookings.
- **Developer Test Mode**: Integrated `DEV_MATCHMAKER_TEST_MODE` to allow testing of the Matchmaker flow with mock teams.
- **Chat Evolution**: Standardized `author_ht_id` tracking in `tournament_chat` to support both real managers and system-level administrative reporting (HT_ID 0).
- **UI Unification**: Migrated metadata display to the `TeamByline` component for system-wide consistency in logo, flag, and link rendering.
- **Constraint Refinement**: Decoupled chat authorship from strict profile foreign keys to allow for non-user system messages and improved stability during live updates.
- **API documentation**: Structured API documentation added to the project, including Hattrick match types and schedules
- **Manual site-wide UI responsiveness updates by user**: Making sure the features already present look great on every type of screen
