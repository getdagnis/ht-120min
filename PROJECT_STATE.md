# PROJECT STATE

Last updated: 2026-06-25

---

## Core Goal

Make it easy for Hattrick managers to find and organize 120-minute friendlies.

---

## Completed

### Platform

- OAuth login with `manage_challenges` scope
- Token scope stored in `profiles.oauth_scope` (as of June 2026)
- Team synchronization via CHPP
- Multi-team support (HFI + male)
- Tournament creation and joining
- Automated standings
- Live match tracking (polls `matchdetails.xml`, scores from `<Scorers>` list)
- Team logos and country data
- Fixture refresh via `teams/refresh-fixtures`
- Venue mismatch detection and goal correction

### Matchmaker

- Ad publishing (`matchmaker/publish`)
- Ad browsing (Tinder-style swipe UI)
- HFI team support and gender filtering
- Team availability classification (available / booked / unavailable / unknown)
- Booking status checks via CHPP `matches` feed
- Mock data mode (`MATCHMAKER_MOCK_DATA=true`)
- Ad freshness indicators
- Show-interest flow (`matchmaker/show-interest`)
- Challenge send flow (`matchmaker/send-challenge`) — routes to CHPP Challenges API
- Match modal with challenge responsibility clarification

### CHPP Challenges API

- `view` action works (proven via oauth-verify + challenges-view testing tools)
- OAuth init requests `manage_challenges` scope
- Scope captured from access token response and stored in `profiles.oauth_scope`
- `oauth-verify` now shows `oauthScope` and `hasManageChallengesScope` fields
- `challengeable` and `challenge` actions blocked by 401 if stored token predates scope addition — **requires re-authorization by each user**

### Infrastructure

- Vercel Hobby plan: currently at **12/12 serverless functions** (hard limit)
- All dev/debug tools consolidated into single `api/testing/index.ts` router
- `vercel.json` rewrites all `/api/testing/*` to `api/testing/index.ts`
- `api/teams/info` returns `logoUrl` in response
- `chpp/proxy` endpoint removed — `teams/info` used instead

---

## Known Bugs / Blockers

- **CHPP `challengeable` / `challenge` return HTTP 401** for any user whose token was issued before `manage_challenges` scope was added to `auth/init`. Fix: those users must re-authorize via `/api/auth/init`. No code change needed, this is an existing-token problem.
- **Matchmaker `handleAccept` is a stub** — the match acceptance flow does not yet create a real server-side match record or send a CHPP challenge automatically. Currently relies on manual challenge send.
- **No race condition protection** — two users can simultaneously match with the same ad. No server-side lock exists.
- **Edit mode doesn't pre-populate form** — editing an ad opens a blank form instead of loading existing ad data.
- **Stale ads after challenge** — after a challenge is sent in HT, the ad remains visible until the next availability sync.

---

## Current Focus

### CHPP Challenges Integration

- [ ] Confirm `challengeable` returns valid XML after re-authorization with `manage_challenges` scope
- [ ] Confirm `challenge` (direct send) works end-to-end
- [ ] Wire `matchmaker/send-challenge` to CHPP challenge creation in production flow
- [ ] Handle `challengeable` 401 gracefully in the UI (prompt re-auth)

### Matchmaker Loop Completion

- [ ] Replace `handleAccept` stub with real server-side match creation
- [ ] Add race condition protection (optimistic lock or status check before match insert)
- [ ] Implement stale-ad cleanup when a team becomes booked
- [ ] Fix edit mode to pre-populate existing ad data

---

## Next Features

### Matchmaker Improvements

- [ ] Compatibility filtering (show ✅/⚠️/❌ on cards based on location/type preferences)
- [ ] Availability-first browsing (available teams first, booked as secondary)
- [ ] Trust signals on cards (arena size, fanclub size, post age)
- [ ] `getDisplayTeamName` helper for consistent HFI labeling everywhere

### Recurring Partners

- [ ] Long-term partner relationships
- [ ] Match history and head-to-head records
- [ ] Recurring training series after a successful match

### Tournament Recruitment

- [ ] Matchmaker → tournament funnel
- [ ] Tournament discovery improvements

### Automation

- [ ] Automatic standings updates via CHPP match result retrieval
- [ ] AI round summaries
- [ ] Automated scheduling

---

## Roadmap (Not MVP)

- Recurring friendly pools
- Mini leagues (4–8 team rotating schedules)
- Automatic training league generation
- Full scheduling automation

---

## Deployment Constraints

- Vercel Hobby plan: **12 serverless function limit** (currently at capacity)
- Before adding any new `/api/*.ts` file: remove or consolidate an existing one
- Dev tooling must go into `api/testing/index.ts` as a routed handler, never as a new file
- Run `find api -name "*.ts" | grep -v "/_lib/" | wc -l` before any new endpoint
