# AGENTS.md

## Project

HT-120min is a niche community tool for organizing recurring Hattrick friendly tournaments.

Primary goal:

- Remove spreadsheet/manual coordination work.
- Make recurring friendly tournaments easy to create and maintain.
- Eventually automate as much as possible through CHPP API.

Target users:

- Small Hattrick communities.
- Private leagues.
- Regional groups.
- Friendly tournament organizers.

Current positioning:

> "The easiest way to organize recurring Hattrick friendlies."

Not trying to become a general tournament platform.

## Primary Users

Typical organizer profile:

- Long-time Hattrick player.
- Volunteer organizer.
- Not highly technical.
- Often manages tournaments via forum posts and spreadsheets.
- Usually knows all participating teams personally.

Implication:

Optimize for organizer efficiency, not participant customization.

## Current Stage

Early MVP before Beta.

Priority:

1. Ship usable product.
2. Validate demand.
3. Improve automation later.

Avoid:

- Enterprise features.
- Complex permissions.
- Premature architecture.
- Multi-year scalability discussions.

Whenever uncertain:
Choose the simplest solution that allows organizers to run a tournament.

---

## CHPP Knowledge Base

For technical implementation details regarding Hattrick CHPP API:

- [AGENTS_CHPP_INTEGRATION.md](docs/AGENTS_CHPP_INTEGRATION.md) - **Mandatory reading** for any CHPP-related task. Covers Swedish Time rules, Match Types, and Weekly Cycles.

---

## Tech Stack

Frontend:

- Vite
- React (v19)
- TypeScript (no-explicit-any enabled)
- React Router (v7)

Backend:

- Supabase
- Vercel Serverless Functions (for CHPP OAuth)

Styling:

- Sass modules

Deployment:

- Vercel

---

## Product Concept

Tournament organizer creates a tournament.

Teams join (manually or via CHPP OAuth).

System generates friendly pairings.

Every round:

- Teams play friendlies in Hattrick.
- Results are recorded (currently manual).
- Standings update automatically.

Core value:
Reduce organizer workload.

---

## Planned CHPP Integration

CHPP license application submitted and pending.

Current status:

- No production CHPP access yet.
- OAuth flow and basic team data retrieval are partially implemented but untested in production.
- Development should assume manual workflows first.

When CHPP becomes available:

High priority:

- Team lookup
- Team validation
- Country retrieval
- Team metadata
- Logo retrieval
- Match result retrieval
- Friendly scheduling assistance

Potential future:

- Auto scheduling
- Automatic standings updates
- Historical statistics
- Team profile pages

Design code so CHPP can be added later without major rewrites.

Do not block MVP waiting for CHPP.

---

## Product Philosophy

Prefer:

- Manual + working
- Simple + understandable
- Fast to ship

Over:

- Fully automated
- Technically elegant
- Over-engineered

Rule:
A manual workflow that works today beats a perfect workflow dependent on future API access.

---

## Visual Direction

Audience:

- Hattrick users.

Tone:

- Friendly.
- Slightly nostalgic.
- Community driven.
- Not corporate.

Current visuals intentionally reference Hattrick culture.

Avoid:

- Generic SaaS aesthetics.
- Startup buzzwords.
- Enterprise language.

---

## Important Context

Project originated from a small Guam-based HFI community (~13 teams) that needed a reliable way to organize recurring non-international friendlies.

The project exists because existing organization methods were mostly:

- spreadsheets
- forum posts
- manual coordination

The tool is being built by a solo founder.

Engineering decisions should optimize for:

- simplicity
- maintainability
- speed of delivery

not:

- theoretical scale
- large-team workflows

---

## Decision Framework

When proposing solutions:

Ask:

1. Does this help organizers run tournaments?
2. Does this reduce manual work?
3. Can it ship this week?
4. Can it work without CHPP today?

If any answer is "no", reconsider.

---

## Near-Term Roadmap

Phase 1:

- Tournament creation
- Team registration
- Fixtures
- Standings
- Basic admin tools

Phase 2:

- CHPP integration
- Team imports
- Result imports
- Team metadata

Phase 3:

- Full automation
- Statistics
- Enhanced community features

Always prioritize Phase 1 work before later phases.

## Deployment Constraints

### Vercel Hobby Plan: 12 Serverless Function Limit

The project is deployed on Vercel Hobby plan, which allows a maximum of **12 serverless functions** per deployment.

Every `.ts` file in `/api/` that is NOT inside a `_lib/` folder counts as one function.

Current function count: **12** (as of June 2026).

**Rules for agents:**
- Do NOT add new files directly to `/api/` or its subdirectories (outside `_lib/`) without first removing or consolidating an existing one.
- Dev/debug tooling belongs in `api/testing/index.ts` as a routed handler — not as a separate file.
- Shared code belongs in `api/_lib/` — those files do NOT count toward the limit.
- Before adding any new endpoint, run: `find api -name "*.ts" | grep -v "/_lib/" | wc -l` and confirm the count stays ≤ 12.

**Current 12 functions:**
1. `api/auth/init.ts`
2. `api/auth/callback.ts`
3. `api/auth/complete.ts`
4. `api/chpp/live-matches.ts`
5. `api/matchmaker/activity.ts`
6. `api/matchmaker/publish.ts`
7. `api/matchmaker/send-challenge.ts`
8. `api/matchmaker/show-interest.ts`
9. `api/matchmaker/teams.ts`
10. `api/teams/info.ts`
11. `api/teams/refresh-fixtures.ts`
12. `api/testing/index.ts`



please familiarize yourself with the project, key files, global styles, package.json, all agent docs (agents.md,
   project_state.md and especially the docs folder, we will have to use hattrick chpp api interfaces a lot) -
   docs/AGENTS_CHPP_INTEGRATION.md, docs/# CHPP Files help.md, docs/auth-flow.md, docs/match-event-types.md etc. until you're confident
   you've learned everything there was to learn.
