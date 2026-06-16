# 120min Tinder. Part II

You are taking over development of the Hattrick "120min Tinder" / Friendly Matchmaker feature.

Read this entire brief before making changes. The system has already gone through one major architectural correction, and some previous assumptions were proven wrong.

## 1. Product Context

This is a consumer-facing entertainment feature, not an enterprise system.

The goal:

- A Hattrick manager can quickly find a 120-minute training opponent.
- The experience should feel instant and friendly.
- The system should explain situations clearly instead of showing generic technical failures.

Core flow:

Manager opens Matchmaker.

They can:

- Browse existing requests.
- Skip opponents.
- Accept an opponent.
- Post their own request.

When posting:

1. We fetch their current Hattrick teams.
2. We determine which teams are available for next week's friendly.
3. They choose an available team.
4. The request is published.
5. Other managers can accept it.
6. They receive a Hattrick challenge link.

---

# 2. Major Architecture Change Already Completed

The original architecture was flawed.

Previous bad assumption:

profiles.teams_json
    ↓
used as current list of manager teams

This was wrong because:

- It was a snapshot taken during login.
- It could be filtered by tournament logic.
- It could become outdated when a manager gained/lost teams.

Another bad assumption:

teams table
    ↓
contained authority for CHPP access

This caused errors like:

"OAuth credentials not found for this team"

because a valid Hattrick team could exist without a local teams row.

Current architecture:

Hattrick CHPP
      ↓
manager OAuth credentials
      ↓
managercompendium API
      ↓
live list of current teams
      ↓
matches API
      ↓
availability status

The Matchmaker should always prefer live CHPP data.

profiles.teams_json is only a cache/fallback and should never be treated as truth.

---

# 3. Current State

This part is mostly working.

The following has been fixed:

✓ Matchmaker no longer depends on profile.teams_json for team selection.

✓ A new endpoint fetches current teams from CHPP.

✓ Availability is checked using CHPP match data.

✓ Teams correctly appear even if they are not in any local tournament.

✓ Teams with booked friendlies are correctly marked unavailable.

✓ Publishing now goes through a server endpoint that performs validation.

✓ OAuth credentials are now looked up on the manager level.

Current real-world test:

My account has two teams.

- Male team:
  - Not in any HT-120min tournament.
  - Has a friendly booked.

- Female HFI team:
  - Is in an HT-120min tournament.
  - Has a friendly booked.

The system now correctly finds BOTH teams and correctly says both are unavailable.

This confirms the original stale team problem is solved.

---

# 4. Important Architectural Principle

Local tables are caches and internal references.

They are NOT the source of truth for:

- Which teams a manager owns.
- Whether a team has a friendly booked.
- Current CHPP identity.

Those should always come from CHPP when the user is actively using the feature.

The teams table still has a valid purpose:

- Internal UUIDs.
- Linking matchmaker requests.
- Tournament participation.
- Historical references.
- Caching display data.

---

# 5. Current Problem: Feature Is Hard To Test

The feature works in real life, but currently my account cannot create a request because all my teams are legitimately booked.

That is good production behavior.

However it blocks development.

We need a safe testing solution.

---

# 6. Implement a Developer Test Mode

Do NOT introduce fake production data.

Do NOT permanently store fake teams in the database.

We need a controlled developer testing environment.

Preferred approach:

Create a development-only mock layer.

Example:

DEV_MATCHMAKER_TEST_MODE=true

When enabled:

The API that returns manager teams may append several fake teams.

Example:

[
  {
    teamId: 999001,
    teamName: "FC Testing United",
    countryName: "Latvia",
    availabilityStatus: "available"
  },

  {
    teamId: 999002,
    teamName: "Bug Hunters FC",
    countryName: "England",
    availabilityStatus: "booked",
    availabilityReason: "Friendly already booked"
  }
]

The fake teams should clearly indicate they are test teams.

They should never appear in production.

---

# 7. Also Allow Simulated Matchmaker Data

The team list alone is not enough.

We eventually need to test:

- Creating requests.
- Browsing requests.
- Accepting requests.
- Matching.
- Expiry.
- Empty states.
- Error states.

Consider creating a more general developer scenario system.

Example:

/dev/scenarios

or a simple configuration:

DEV_SCENARIO = "matchmaker_full_flow"

Possible scenarios:

SCENARIO: New user

- No teams.
- No requests.

SCENARIO: Available teams

- Several available teams.

SCENARIO: All booked

- Teams unavailable.

SCENARIO: Active requests

- Multiple fake opponents.

SCENARIO: Match found

- Existing matched request.

SCENARIO: API failure

- CHPP unavailable.

The goal is to be able to visually test every UX state without waiting for real Hattrick circumstances.

---

# 8. Existing Code Review Notes

There are several things in the current code that should be inspected.

## A) Typo in Supabase select

In Matchmaker.tsx I noticed:

league_id:leage_id

This appears twice:

fetchRequests()
fetchMyRequests()

This is almost certainly a typo.

Verify the actual database column.

It should probably be:

league_id

or:

league_id:league_id

This may currently break flag rendering.

---

## B) Team selection click logic appears inverted

Current code:

onClick={() => {
  if (t.availabilityStatus === 'booked') {
    setSelectedHtTeamId(t.teamId);
  }
}}

This means:

Booked teams are selectable.

Available teams are not selectable.

That seems exactly backwards.

Expected behavior:

- Available teams should be selectable.
- Booked teams should either:
  - Not be clickable, or
  - Be clickable only to show why they are unavailable.

Review the intended UX and fix this.

---

## C) Availability reason display appears reversed

Current code:

if (t.availabilityReason && t.availabilityStatus === 'available')

That means availability explanations only show for available teams.

That is suspicious.

Usually reasons are more useful for:

"booked"
"unknown"

Example:

"Already has a friendly against FC Example on Wednesday."

Review and correct this logic.

---

## D) React fragments look broken

I noticed:

<>
  <span className="mr-sm">👍</span>
  <>Available!</>
</>

and similar for booked.

Nested empty fragments with text are unnecessary and may be invalid depending on JSX parsing.

Replace with normal JSX.

---

## E) Accept flow should be reviewed

Current code:

const myTeam =
    myTeams.find(team => team.availabilityStatus !== "booked")
    ?? myTeams[0]

This is questionable.

Acceptance should probably not silently choose a team.

A manager with multiple available teams should likely choose which team is accepting.

Think through the UX.

At minimum, ensure we do not accidentally accept a match using a booked team.

---

# 9. Preserve Existing Principles

Do not revert to using:

profile.teams_json

as the source of truth.

Do not make local teams table required before CHPP validation.

Do not store fake data in production tables.

Prefer:

- Live CHPP for current state.
- Local database for internal relationships.
- Developer scenarios for testing.

---

# 10. Immediate Goal

First implement a clean developer test mode for Matchmaker so we can actually test:

- Posting a request.
- Viewing the request.
- Browsing from another perspective.
- Accepting a match.
- Error handling.
- Empty states.

Do not over-engineer a full testing framework yet, but design it so it can later grow into a reusable "developer scenarios" system for other features of the site.
