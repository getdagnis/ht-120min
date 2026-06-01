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

- [ ] **Multi-team Support:** Allow managers to choose which team joins a specific tournament.
- [ ] **Metadata Fetching:** Store logo URLs, country IDs, and league names.
- [ ] **CHPP Join Flow:** Replace manual HT ID entry with a "Select your team" picker.

## Phase 3: Automated Result Sync

**Goal:** Zero-effort standings updates.

- [ ] **Match Details Polling:** Periodically check for completed matches.
- [ ] **Auto-Standings:** Detect 120min achievements, total minutes, and goals automatically.
- [ ] **Sync Action:** Provide a "Sync results from Hattrick" button for tournament admins.

## Phase 4: Identity & Social

**Goal:** Make the platform feel like a real part of the Hattrick ecosystem.

- [ ] **Visual Identity:** Real team logos and country flags in tables.
- [ ] **Manager Profiles:** Achievements and history across multiple tournaments.
- [ ] **Tournament Feed:** "Live" activity stream of joins and results.
- [ ] **Realtime Chat:** Simple per-tournament chat rooms.

## Phase 5: Advanced Automation

**Goal:** High-level management.

- [ ] **Automated Challenges:** Send friendly challenges directly via the app.
- [ ] **AI Journalist:** Generate short summaries of round highlights and dramatic 120m matches.

## Core Technical Mandates

- **Security:** Tokens and secrets stay strictly on the server-side (`/api`).
- **Performance:** Centralized XML parsing to minimize duplicate Hattrick requests.
- **Tone:** Preserve the humorous, community-first, unofficial aesthetic.
