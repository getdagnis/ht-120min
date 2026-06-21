# Matchmaker MVP 4 — Availability-First Cleanup + Testing Environment

## Context

The current Matchmaker implementation has reached the point where real-world testing should begin.

The availability classification work is mostly complete:

* Team availability now comes from CHPP teamdetails.
* Teams are classified as:

  * available
  * booked
  * unavailable
  * unknown
* Booked teams are no longer incorrectly selectable.
* Unknown teams remain visible but disabled.
* Team selector modal groups teams by availability state.
* Temporary manual match flow exists.
* Match modal now displays HT Team ID.

At this stage the highest priority is not new functionality but improving testability and removing confusing UI concepts before gathering real user feedback.

## Goals

1. Improve local testing environment.
2. Remove or simplify confusing Match % UX.
3. Ensure HFI indicators appear consistently everywhere.
4. Record future roadmap items without implementing them now.

## Part 1 — Local Testing Environment

Current problem:

Testing depends on:

* actual CHPP data
* actual friendly availability
* actual ads in database

This makes QA slow and non-deterministic.

Implement a proper local mock environment.

Requirements:

Add:

```env
MATCHMAKER_MOCK_DATA=true
```

Behavior:

When enabled:

* Real CHPP teams should still load normally.
* Real availability should remain visible.
* Existing mock teams may remain.

Additionally inject mock Matchmaker ads into the Tinder feed.

Create at least these deterministic scenarios:

Scenario A

* Available team
* 120 minute
* Domestic
* Long-term

Scenario B

* Available team
* International
* One-off

Scenario C

* Booked team

Scenario D

* HFI team

Scenario E

* International HFI team

Scenario F

* Older listing

Mock ads should be clearly marked:

"(Mock)"

or

"is_mock: true"

to prevent confusion.

Important:

Do not replace production data.

Append mock data only when:

```env
MATCHMAKER_MOCK_DATA=true
```

This should allow testing:

* Tinder browsing
* HFI filtering
* Challenge flow
* Match modal
* Availability states
* Long-term badges

without requiring live users.

## Part 2 — Remove Match Percentage UX

Current Match % system appears confusing.

The score is derived from:

* match type
* venue preference
* location preference
* long-term preference
* back-and-forth preference

While technically functional, it is difficult for users to understand and provides little decision-making value.

Implement:

Remove visible percentage display from Tinder cards.

Replace with availability-first presentation.

Preferred badge hierarchy:

Primary:

🟢 Available
🟡 Booked
⚪ Unknown
🔴 Unavailable

Secondary:

Posted today
Posted this week
Posted recently

Do NOT use wording such as:

"Older listing"

because it sounds negative.

Freshness should be treated as informational only.

Implementation note:

Keep compatibility scoring logic internally if desired.

Just remove it from MVP user-facing UI.

## Part 3 — HFI Consistency Pass

Currently HFI indicators appear inconsistently.

Create a single helper:

```ts
getDisplayTeamName(...)
```

or equivalent.

Example:

FC Example (HFI)

Use it everywhere:

* Tinder cards
* Match modal
* Posting modal
* Team selector
* My Ads
* Dropdowns
* Future views

Avoid duplicated inline checks.

Goal:

One source of truth.

## Part 4 — Availability-First Browsing (Roadmap Only)

Do NOT implement yet.

Add to roadmap/project_state.

Future concept:

Tinder browsing should focus on teams that are currently challengeable.

Proposed future flow:

1. Sync availability.
2. Show available teams first.
3. Swipe through all available teams.
4. Display:

"You've seen all currently available teams."

Buttons:

* Start Over
* Show Booked Teams

Booked teams become a secondary browsing experience.

This is roadmap only.

## Part 5 — Long-Term Partner Series (Roadmap Only)

Do NOT implement yet.

Add to roadmap/project_state.

Concept:

Current long-term flag is passive.

Future evolution:

After a successful match:

"Create recurring training series?"

Features:

* recurring fixtures
* score history
* standings
* win/loss record
* future automated challenge creation

This is intended as a stepping stone toward automated tournaments.

Not MVP.

Roadmap only.

## Part 6 — Tournament Evolution (Roadmap Only)

Do NOT implement yet.

Add to roadmap/project_state.

Observation:

Many users choose a single long-term partner because organizing friendlies manually is annoying.

This does not necessarily mean they prefer a single opponent.

Long-term vision:

Automatic training leagues.

Examples:

* 4 team league
* 8 team league
* recurring cup group
* rotating friendly schedule

Potential future progression:

Single Match
→ Long-Term Partner
→ Mini League
→ Automated Training League

Roadmap only.

## Part 7 — Validation

After changes:

Run:

```bash
npm run build
npm run lint
```

Then verify manually:

* HFI labels everywhere
* Mock ads visible
* Availability badges visible
* No Match % shown
* Challenge flow still works
* Team selector still groups availability correctly
* Real CHPP availability remains untouched
