# ROADMAP: HT-120min Evolution

This document tracks our transition from a manual tournament tracker to a fully integrated Hattrick CHPP platform.

## Phase 1: Identity & OAuth (Status: COMPLETED ✅)

**Goal:** Establish secure connection to Hattrick API.

- [x] **HMAC-SHA1 Utility:** Standardized signing for Hattrick.
- [x] **Handshake flow:** Request Token -> Authorize -> Access Token.
- [x] **Supabase Sync:** Persist tokens and basic manager identity.
- [x] **"Connect" UI:** Entry point for managers.

## Phase 2: Automated Participation (Current Focus 🎯)

**Goal:** One-click verified tournament entry.

- [x] **Multi-team Support:** Allow managers to choose which team joins a specific tournament.
- [x] **Metadata Fetching:** Store logo URLs, country IDs, and league names.
- [x] **CHPP Join Flow:** Replace manual HT ID entry with a "Select your team" picker.

## Phase 3: Automated Result Sync

**Goal:** Zero-effort standings updates and live match tracking.

- [x] **Match Details Polling:** Periodically check for completed matches.
- [x] **Live Match Tracking:** Live score polling, status transitions, and ongoing match UI.
- [x] **Auto-Standings:** Detect 120min achievements, total minutes, and goals automatically.
- [ ] **Sync Action:** Provide a "Sync results from Hattrick" button for tournament admins.

## Phase 4: Identity & Social

**Goal:** Make the platform feel like a real part of the Hattrick ecosystem.

- [x] **Visual Identity:** Real team logos and country flags in tables.
- [ ] **Manager Profiles:** Achievements and history across multiple tournaments.
- [ ] **Tournament Feed:** "Live" activity stream of joins and results.
- [ ] **Realtime Chat:** Simple per-tournament chat rooms. Partly done (functionality implemented, UI needs improvements).
- [ ] **Live Chat Room Match action:** While matches are ongoing, chatroom gets live key event announcements (goals, injuries, cards, half-time summary).
- [ ] **Weekly Tournament Updates/Stats** Key players, most interesting match events in a separate weekly updated standings page widget.
- [ ] **Team/Tournament Announcements:** A separate tab in TournamentView that allows users to share/read "offical" team and tournament updates. Same as chat functionality implemented, currently hidden from UI waiting for UI/UX finalization.
- [ ] **Tournament Join Questionnaire (Priority: Medium):** Segment users during joining flow by gender, training duration (90/120min), and desired activity level (active/social vs. inactive/training-only) to improve tournament quality.

## Phase 5: Advanced Automation

**Goal:** High-level management.

- [ ] **Automated Challenges:** Send friendly challenges directly via the app. _IMPORTANT!_
- [ ] **AI Journalist:** Generate short summaries of round highlights and dramatic 120m matches.

## Phase 6: PRO Tournaments (Priority: High)

**Long Term Goal:** Monetization and premium features for dedicated organizers and users. Unlimited social/statistics/planning features for Pro tournaments, can select one or two features for regular tournaments.

- [ ] **PRO Status System:** Paid subscription integration.
- [ ] **Premium Features:** Custom images, advanced polls, Hall of Fame, enhanced statistics, and dedicated tournament chat rooms.

## Core Technical Mandates

- **Security:** Tokens and secrets stay strictly on the server-side (`/api`).
- **Performance:** Centralized XML parsing to minimize duplicate Hattrick requests.
- **Tone:** Preserve the humorous, community-first, unofficial aesthetic.
