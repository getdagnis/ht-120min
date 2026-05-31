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

## Tech Stack

Frontend:

- Vite
- React (v19)
- TypeScript
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
