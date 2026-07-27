# ht-tinder, phase 3

After reading through the actual implementation, I would not ship it to forum traffic yet.

The good news: the foundation is much stronger than I expected. The bad news: there are several UX holes that real 120-minute seekers will hit within minutes.

Biggest issues I see

1. The core action doesn't actually work yet
const handleAccept = async (requestId: string, teamId: number) => {
  // Stub for handling match accept
}

This is the entire product.

A user can browse, like, select team, then nothing happens.

Before any advertising, this must become a complete flow.

1. No compatibility filtering

Current browse view shows everything.

A user who wants:

120 only
away only
international only

still sees incompatible ads.

Real users will complain:

"Why am I seeing requests I can't actually play?"

At minimum, cards should show:

Compatible ✅
Potentially compatible ⚠️
Incompatible ❌

or preferably hide incompatible entirely.

1. No duplicate protection

I can see no protection against:

Team A challenges Team B
Team B challenges Team A

simultaneously.

Result:

duplicate matches
stale ads
confusion

Need server-side lock.

1. No stale-ad cleanup after challenge

Current logic checks booking status during publishing.

But after somebody sends a challenge in HT:

ad remains visible
other people continue liking it

until refresh/re-sync.

This will annoy users quickly.

1. Current success model is unclear

User presses ❤️

What happens?

Possible outcomes:

A)

automatically opens challenge page

B)

creates internal match

C)

notifies both sides

D)

does nothing

The product must have one obvious path.

For alpha I'd use:

❤️ Like
↓
Select team
↓
System creates match
↓
Both ads immediately disappear
↓
Show:
"It's a match"
↓
Open opponent HT page
↓
One side sends challenge manually

Simple.

1. DELETED BY USER. WE DON'T MIND THAT USER SEES THE SAME AD TWICE OR MORE. WE DON'T HAVE THAT MANY.

2. Card exhaustion bug

Potential issue:

currentIndex

is never corrected when list shrinks.

After:

deleting ad
matching ad
switching tabs

you may end up beyond array bounds.

Small but annoying.

1. Edit flow looks broken

Current Edit button:

setSelectedHtTeamId(...)
setIsPosting(true)

But doesn't load:

message
location
homeAway
matchType
flags

User expects editing.

Gets blank form.

This will be reported immediately.

1. No trust indicators

Forum users care about:

active manager?
serious?
veteran?

You already have:

fanclub_size
arena_size

Show them.

Even tiny indicators help.

Example:

Arena: 78k
Fans: 12k
Posted: 2h ago

Makes cards feel alive.

1. No challenge responsibility

After match:

Who sends challenge?

Nobody knows.

Need explicit:

🏠 Home side sends challenge

or

❤️ You liked them.
You send challenge.

One rule.

Always.

What I would build before advertising

Nothing huge.

Just complete the loop.

Publish
↓
Browse
↓
Like
↓
Select team
↓
Match created
↓
Ads removed
↓
Challenge responsibility shown
↓
Done

Everything else can wait.

## The prompt I'd give Codex

### Goal

Finish Matchmaker alpha so it survives real-world testing from forum users looking for 120-minute friendlies.

DO NOT redesign UI.
DO NOT add major new features.
Focus on robustness, clarity, and completing the matchmaking loop.

------------------------------------------------------------------

1. IMPLEMENT REAL MATCH ACCEPT FLOW

------------------------------------------------------------------

Replace current handleAccept() stub with complete flow.

Requirements:

- User selects one of their available teams.
- Create a server-side match action endpoint.
- Endpoint validates:

  - request still exists
  - request status = open
  - requesting team is still available
  - target team is still available
  - challenger is not same manager
  - challenger is not same team
  - neither team already matched

- Use database transaction / equivalent lock.

On success:

- update request status to matched
- store matched_with_team_id
- store matched_at

Return matched request data.

Frontend:

- remove matched card immediately
- open existing "It's a Match!" modal
- refresh requests + myRequests

------------------------------------------------------------------

1. PREVENT RACE CONDITIONS

------------------------------------------------------------------

Protect against:

A likes B
while
C likes B

Only first successful match wins.

Later attempts receive:

"This team has already found a partner."

Refresh listings automatically.

------------------------------------------------------------------

1. COMPATIBILITY CALCULATION

------------------------------------------------------------------

Add helper:

isCompatible(myTeam, request)

Evaluate:

- location preference
- home/away preference
- match type

Expose:

compatible
partiallyCompatible
incompatible

UI:

- compatible cards first
- incompatible cards last

Alpha version:
DO NOT hide incompatible cards.

Show badge:

✅ Compatible

or

⚠ Preference mismatch

------------------------------------------------------------------

1. STALE AD REMOVAL

------------------------------------------------------------------

Whenever:

- opening page
- publishing
- matching
- refreshing own teams

Automatically remove ads whose team now has:

availabilityStatus = booked

This must happen server-side as source of truth.

Booked teams should never appear publicly.

------------------------------------------------------------------

1. PROPER EDIT MODE

------------------------------------------------------------------

Current Edit button only opens modal.

Fix:

When editing existing ad:

populate:

- matchType
- location
- homeAway
- message
- isLongTerm
- isBackAndForth

Submitting should update existing record,
not create duplicate.

------------------------------------------------------------------

1. BROWSE MEMORY

------------------------------------------------------------------

Store locally:

dismissed request ids

Current session only.

Behavior:

X button:
hide card for current session

Matched:
hide permanently

Own ads:
continue hiding as today

------------------------------------------------------------------

1. INDEX SAFETY

------------------------------------------------------------------

Whenever filteredRequests changes:

if currentIndex exceeds last item:

move to valid index automatically.

Never allow blank card due to array shrink.

------------------------------------------------------------------

1. MATCH RESPONSIBILITY

------------------------------------------------------------------

In match modal:

Show one explicit instruction.

Rule:

Manager who clicked ❤️ is responsible for sending challenge.

Text example:

"You initiated this match.
Open the opponent team page and send the friendly challenge."

Keep existing button.

------------------------------------------------------------------

1. TRUST SIGNALS

------------------------------------------------------------------

Add lightweight metadata on cards:

- fanclub size (if available)
- arena size (if available)
- posted age ("2h ago", "1d ago")

No extra API calls.

Use existing data only.

------------------------------------------------------------------

1. ALPHA TELEMETRY

------------------------------------------------------------------

Add minimal analytics events:

matchmaker_ad_published
matchmaker_card_liked
matchmaker_match_created
matchmaker_ad_deleted

Console fallback acceptable.

No external service required.

Goal is simply understanding user flow during alpha.

------------------------------------------------------------------

Success criteria:

A brand-new user can:

1. publish an ad
2. discover another ad
3. like it
4. create a match
5. know exactly what happens next

without confusion, duplicate matches,
or stale listings.
