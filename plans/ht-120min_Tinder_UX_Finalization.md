# HT-120min Tinder — UX Finalization Pass (v2)

STOP.

Do not enter plan mode.
Do not redesign database architecture.
Do not refactor tournaments.
Do not build new team ownership systems.

Current objective:

Ship a Matchmaker MVP before next week's friendly booking cycle.

Everything below should optimize for shipping.

---

## Core Product Definition

The product is:

"Book 120-minute friendlies"

NOT

"Post classified ads"

Users should feel they are booking matches.

The ad is merely a technical implementation detail.

---

## Important Reality Constraint

CHPP automatic booking is NOT ready.

Therefore MVP flow is:

1. Team becomes available.
2. Another manager clicks Book Match.
3. System shows "Match Found".
4. System provides direct Hattrick booking link.
5. User completes booking manually.

This is temporary.

The UI should still be designed around the final automatic-booking vision.

Do not introduce concepts that assume future manual negotiation.

No second acceptance.

No waiting for approval.

No inbox-style workflow.

Posting availability already implies consent.

Exactly like Hattrick's friendly pool.

---

## Terminology Cleanup

Avoid implementation language.

Replace:

Challenge
Accept Match
Request
Matched
Open

With:

Book Match
Available
Booked
Match Scheduled
My Teams

Examples:

CHALLENGE
→ BOOK MATCH

MY ADS
→ MY TEAMS

OPEN
→ AVAILABLE

MATCHED
→ BOOKED

---

## Browsing Experience

Keep Tinder-style browsing.

Do NOT convert into list view.

Reasons:

- low inventory
- memorable concept
- differentiates from forum posts
- feels fun despite simple functionality

One card at a time remains correct.

---

## Start Over Behaviour

KEEP current Start Over button.

Current implementation is correct.

Reason:

Inventory is small.

Users often want to compare the same few teams.

If a manager sees:

Team A
Team B
Team C

and reaches the end:

they must be able to restart immediately.

Do not force waiting.

Do not hide previously seen teams forever.

Current Start Over behaviour stays.

---

## Card Navigation

Keep:

NOPE
BOOK MATCH

Add:

← Previous
→ Next

(only on desktop and as large side arrows, see screenshot)

Reason:

This is not real Tinder.

Managers may want to compare options.

Allow moving back and forth through the current pool.

Do not over-copy Tinder mechanics.

The joke already works.

---

## Hero/Header

Current hero is approximately 2x too tall.

Goal:

First match card visible above fold.

Structure:

HT-120min Tinder

Instant 120-minute friendlies.

Book training matches in seconds.

[Post an Ad]

Illustration remains but change to the longer one: /tinder-date-long-transp.png

Use the originally intended logo with transp background that can go over the image slightly, that also saves space /tinder-logo.png (use this logo for teaser widget too)

Bottom line - reduce height significantly.

Think:

compact landing section header

not

full-page advertisement.

---

## Posting Flow

Current modal approach is correct.

Keep modal.

Do not replace page.

Flow:

Browse
→ Post Team
→ Modal
→ Publish
→ Success
→ Return

Only visual polish needed.

Use Tinder color palette.

Remove green modal entirely.

---

## Booking Flow

Current:

Challenge
→ Immediate success overlay

Replace with:

BOOK MATCH

opens confirmation modal

---

Ready to book?

Your team:
FC Example

Opponent:
Other Team

You'll now be taken to Hattrick
to complete the booking.

[Book Match]

[Cancel]

---

Temporary implementation:

Book Match button simply opens:

- Hattrick team page
or
- Hattrick challenge page

depending on available URL.

Later this button becomes:

Auto Schedule Match

without changing UX.

---

## Team Selection

Current logic is mostly correct.

Rules:

1 team available
→ auto select

2+ teams available
→ team picker

Keep it simple.

Do not create persistent team context yet.

Do not introduce:

Current Team
Active Team
Selected Club

throughout entire application.

Too much complexity for MVP.

Choose team only when needed.

---

## All Browser Alerts Must Die

Replace every alert().

Create reusable modal system.

Variants:

- Success
- Error
- Warning
- Confirmation
- Login Required
- Team Selection

No browser alerts anywhere.

Ever.

---

## Login Dead Ends

Current:

Please sign in.

OK.

Replace:

---

Sign in required

To book or publish friendlies
you need a connected Hattrick account.

[Login with Hattrick]

[Close]

---

Every dead end needs a next action.

---

## My Teams Tab

Rename:

My Ads
→ My Teams

Statuses:

AVAILABLE
BOOKED
EXPIRED

Avoid:

OPEN
MATCHED
CANCELLED

Those are database terms.

Users think in availability.

---

## Recurring Partners

Treat as separate product mode.

One-off friendly:

Book Match

Recurring:

Request Partnership

Only recurring partnerships require:

mutual acceptance

future conversation

future automation

future tournament upsell

Everything else remains instant.

---

## Card Improvements

When data exists display:

- Team logo
- Arena image
- Team country
- Manager country
- Fan club size
- Recurring badge

Reduce emoji density.

Use badges instead.

Cleaner.
More mature.
More believable.

---

## Empty State

Replace:

No requests found

With:

No teams available right now.

Be the first manager available
for next week's 120-minute friendlies.

[Post Team]

[Start Over]

---

## Future Funnel

Remember:

Matchmaker is not the destination.

Matchmaker
→ recurring partner
→ mini-league
→ tournament

Do not add complexity that competes with tournaments.

Matchmaker should feel:

fast
lightweight
temporary

Its job is getting managers into the ecosystem.
