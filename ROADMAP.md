# ROADMAP: HT-120min

## Core Thesis

HT-120min exists to make 120-minute football coordination trivial.

A manager should immediately understand:

- who can play
- who might be available soon
- what to do next

If no match exists, the system must still provide a meaningful next action.

---

## Product Strategy

### 1. Tournaments = Core System

The product is tournaments, not listings.

Everything converges here:

- structured competition
- recurring participation
- statistics + history
- organizer control
- long-term engagement

This is where value and monetization naturally emerge.

---

### 2. Matchmaker = Entry Layer

Matchmaker is not the product. It is the funnel into activity.

Its job:

- reduce friction to first contact
- convert intent into participation
- surface active and near-future matches
- never leave users at a dead end

---

### 3. Social Layer = Retention Engine

If no immediate match exists, the system must still be useful.

Core mechanisms:

- interest signals
- lightweight interaction between managers
- visibility into future availability
- recurring partner formation

Not discussion for its own sake — only as a path to matches.

---

## Core Product Requirements

### Match Availability Must Be Trustworthy

- clear separation: available now / available later
- no false-positive “available” teams
- stale ads visibly degraded
- challengeability must be predictable

If this fails, the system loses credibility.

---

### No Dead Ends

Every interaction must lead to one of:

- match now
- match later
- express interest
- join recurring structure
- enter tournament flow

Browsing alone is not sufficient.

---

### Reduce Coordination Cost

Every feature must reduce:

- messaging overhead
- manual scheduling
- uncertainty
- repeated negotiation

If it adds steps, it must remove more elsewhere.

---

## Product Pillars

### 1. Matchmaker

Purpose: initiate contact between managers

Core features:

- ads
- browsing
- filtering by availability
- team linking
- HFI separation
- basic compatibility signals

Next evolution:

- reliable availability model
- interest + intent signals
- lightweight “save / follow” interactions
- bridge into tournaments and recurring play

---

### 2. Tournaments (CORE)

Purpose: structured competition system

Core features:

- tournament creation
- joining flows
- standings
- live match tracking
- results sync

Next evolution:

- recruitment via Matchmaker
- discovery + onboarding funnels
- richer competition formats
- automated participation cycles

---

### 3. Social / Identity Layer

Purpose: continuity between tournaments

Core features:

- manager identity
- team history
- participation history
- cross-tournament reputation signals

Scope constraint: keep minimal — only what supports competition.

---

## Development Phases

### Phase 1: Trust Foundation (Current)

Goal: Matchmaker is reliable enough for public recommendation

- correct challengeability detection
- separate availability states
- fix HFI and data inconsistencies
- remove misleading listings
- introduce “what next” action for every ad

---

### Phase 2: Conversion Layer

- express interest system
- ad-level interaction (comments / signals)
- temporary challenge links (fallback flow)
- lightweight matchmaking actions

---

### Phase 3: Tournament Expansion

Goal: shift core usage from browsing → structured play

- tournament recruitment flows
- tournament discovery improvements
- recurring partner structures
- match history + head-to-head tracking

---

### Phase 4: Automation Layer

- direct friendly challenge creation
- scheduling assistance
- automated tournament workflows
- AI-generated round summaries

---

## Long-Term Direction

- recurring competition pools
- semi-automated leagues
- fully structured seasonal cycles
- minimal manual coordination required

---

## Hard Constraint

If a manager visits the platform, they must always leave with one of:

- a match opportunity
- a future match opportunity
- a structured competition path

Anything else is noise.
