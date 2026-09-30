# Phase 1 generated-schedule redesign

## Summary

The generated-schedule system needs to move away from treating `single`, `double`, and four-week `recurring` schedules as the primary competition model.

The new model is calendar-first and round-count-first:

1. determine how many safe Hattrick friendly rounds remain in the current season;
2. let the organizer choose a meaningful tournament length;
3. reserve those calendar rounds;
4. materialize only the next actionable round;
5. pair teams by similar strength while avoiding rematches;
6. repair the current round without disturbing fixtures already arranged correctly;
7. generate the following round from what actually happened;
8. optionally turn the final reserved round into a Championship Final when the selected format supports it.

The crucial architectural rule is:

> A generated season reserves its calendar upfront, but materializes pairings one actionable round at a time. Current-round repair preserves already-correct arrangements, and later rounds adapt to what actually happened.

This is Phase 1 of a broader cup/playoff system.

Today's required launch cases are HFI tournaments with:

- 6 teams;
- 8 teams;
- 10 teams;
- 12 teams;
- 6 safe rounds remaining.

Those are acceptance cases, not hard-coded product rules.

The implementation should remain generic in `teamCount`, `regularRoundCount`, `postseasonRoundCount`, ranking source, and available calendar slots.

The current repo has several relevant constraints:

- `schedule-draft.ts` / `scheduler.ts` generate only `single`, `double`, or four-week recurring schedules;
- `generate_tournament_schedule` independently validates those exact round counts in SQL;
- the existing rescheduler deliberately changes dates without changing pairings;
- fixture refresh already detects booked-elsewhere / misarranged teams;
- standings currently consume tournament matches without a regular/postseason distinction;
- `rounds` has no phase or deferred-round representation;
- future rounds currently assume their pairings already exist.

Legacy generated schedules must remain readable and manageable.

The existing **No pre-made schedule** workflow remains untouched.

---

## 1. Phase 1 competition formats

Format choices are derived from team count and safe-round count.

For a complete single round robin:

```text
even number of teams: teamCount - 1 rounds
odd number of teams:  teamCount rounds
```

### Today's six-round acceptance cases

#### 6 teams

A complete round robin requires 5 rounds.

With 6 safe rounds available:

```text
R1-R5  Single round robin
R6     Championship Final: regular-season #1 vs #2
```

Meaningful UI choices:

```text
● 6 rounds     Single round robin + Championship Final
○ 5 rounds     Single round robin
○ [ 4 ]        Custom number of rounds
```

The 6-round format is the primary Phase 1 postseason case.

#### 8 teams

Full round robin = 7 rounds.

Only 6 safe rounds exist.

```text
R1-R6  Balanced regular season
```

Choices:

```text
● 6 rounds     6 rounds of balanced pairings
○ [ 5 ]        Custom number of rounds
```

#### 10 teams

Full round robin = 9 rounds.

```text
● 6 rounds     6 rounds of balanced pairings
○ [ 5 ]        Custom number of rounds
```

#### 12 teams

Full round robin = 11 rounds.

```text
● 6 rounds     6 rounds of balanced pairings
○ [ 5 ]        Custom number of rounds
```

There must be no `teamCount === 6`, `=== 8`, etc. behavior inside the scheduler.

These results must fall naturally out of generic format derivation.

Conceptually:

```ts
deriveTournamentFormats({
  teamCount,
  safeRoundCount,
})
```

Phase 1 needs to understand at least:

- partial balanced regular season;
- complete single round robin;
- complete single round robin + one Championship Final;
- custom regular-season length.

Do not build the full future cup-format engine yet.

---

## 2. Calendar-first planning

Add a length-oriented planner alongside the existing schedule logic.

It should:

- derive usable friendly slots from the selected start date;
- remain inside the current Hattrick season;
- exclude blocked cup weeks;
- exclude Week 15 weekend by default;
- include Week 16 weekend;
- preserve current start-date lead-time protections;
- never silently continue into the following Hattrick season.

For the current launch:

```text
Closest start date: Wed, 07/10/2026

W12 midweek
W13 midweek
W14 midweek
W15 midweek
W16 midweek
W16 weekend

= 6 safe friendly rounds left in HT S95
```

W15 weekend is intentionally excluded because qualification matches can occupy it.

The UI should communicate:

```text
12 team tournament

Closest start date: Wed, 07/10/2026 (7 days)
6 safe friendly rounds left in HT S95
```

The organizer then chooses tournament length.

Safe-round count is a calendar fact. Tournament format is derived separately.

---

## 3. Ranking snapshot

Phase 1 HFI scheduling uses `team_rank`.

Before schedule generation:

1. require a valid positive rank for every active, non-placeholder participant;
2. if ranks are missing, direct the organizer to the existing HFI rank-refresh action;
3. snapshot the ranking used for this season;
4. use that frozen ranking throughout staged regular-season generation.

A later CHPP rank change must not change the strength ordering underneath an already-running tournament.

Power Rating remains stored but is not used for Phase 1 scheduling.

The architecture may leave room for another ranking source later, but do not expand today's implementation into multi-league Power Rating scheduling.

---

## 4. Balanced regular-season pairing

The default HFI pairing principle is:

> Prefer the closest-strength legal opponent that has not already been played, while keeping the round and future competition viable.

This is not strongest-vs-weakest seeding.

There is no forced inverted/stress-test round.

Pairing priorities:

1. each active participant appears at most once per round;
2. no self-match;
3. avoid rematches while unused opponents remain;
4. minimize strength/rank distance;
5. distribute BYEs fairly for odd fields;
6. preserve sensible home/away balance.

Do not rely on a naive greedy:

```text
#1-#2
then #3-#4
then...
```

if that can create an avoidably poor remainder.

Use deterministic bounded search / matching / lookahead capable of evaluating the round as a whole.

The existing Circle Method can remain a guaranteed-valid baseline/reference.

### Complete round robin

If enough regular rounds exist for a full round robin, every opponent must eventually be played exactly once.

Ranking then influences ordering, not the opponent set.

### Partial regular season

If fewer rounds exist than required for a full round robin, select the subset of opponents that minimizes rank distance while respecting the constraints above.

---

## 5. Generate one regular round at a time

Do not persist all regular-season pairings at initial generation.

At season creation:

```text
Reserve calendar:

R1  W12
R2  W13
R3  W14
R4  W15
R5  W16 midweek
R6  W16 weekend
```

But materialize:

```text
R1 only
```

The others remain pending rounds with reserved calendar slots.

For a 12-team six-round tournament:

```text
R1  regular      materialized
R2  regular      pending
R3  regular      pending
R4  regular      pending
R5  regular      pending
R6  regular      pending
```

For the 6-team 5+1 format:

```text
R1  regular      materialized
R2  regular      pending
R3  regular      pending
R4  regular      pending
R5  regular      pending
R6  postseason   pending
```

This allows subsequent rounds to reflect:

- opponents actually played;
- fixtures genuinely committed;
- missed/misarranged rounds;
- repaired-away pairings;
- BYEs;
- active season slots.

A pairing that existed temporarily but was repaired away must not count as opponent history.

A misarranged fixture that was never played must not automatically count as two teams having played each other.

---

## 6. Competition-phase and pending-round model

Add enough structure to represent staged generation.

At minimum:

```text
round.phase

regular
postseason
```

and:

```text
round.phase_status

pending
materialized
completed
```

Also add:

- `phase_round_number` if useful for future postseason/bracket work;
- authoritative reserved calendar-slot metadata on the round itself;
- a season-level generated schedule plan;
- frozen ranking snapshot;
- champion / advancing result metadata only where actually needed.

Existing historical rounds should default safely to:

```text
phase = regular
```

### Pending rounds

A pending round has:

- tournament/season identity;
- round number;
- phase;
- reserved Hattrick calendar slot;
- no fixture rows.

Do not create:

```text
TBD vs TBD
```

fake fixtures.

Today the calendar slot largely belongs to generated match rows, so pending rounds require an authoritative place to retain their reserved date/slot before matches exist.

---

## 7. Current-round arrangement repair

Misarrangement is expected operating input, especially during the first round of six newly launched HFI tournaments.

The system should distinguish three participant states in the current actionable round.

### Locked

The intended tournament fixture has been arranged correctly / linked.

Example:

```text
A-B  arranged correctly
```

That fixture must not move.

### Unavailable

The team booked another Hattrick friendly for that slot.

Example:

```text
G  booked elsewhere
```

It cannot participate in a valid tournament fixture this round.

### Free

The team has not booked elsewhere and its current pairing is still uncommitted.

Its pairing may be repaired.

---

## 8. Repair Round operation

Provide one server-authorized **Repair Round** operation.

Full manual pairing controls and polished UI are not required for Phase 1.

The repair operation must:

- freeze every correctly arranged/linked fixture;
- never modify ongoing or completed fixtures;
- never modify another otherwise committed fixture;
- operate only on the unresolved portion of the current round;
- contain unavailable teams together as far as possible;
- re-pair remaining free teams;
- maximize the number of playable tournament fixtures;
- minimize the number of otherwise available teams damaged by unavailable teams;
- preserve rank-distance quality where multiple valid repairs exist;
- preserve round validity.

This is different from the existing rescheduler.

Existing rescheduling means:

> move future fixture dates while preserving pairings.

Repair means:

> change only current unresolved pairings while preserving committed fixtures.

Do not merge those responsibilities.

---

## 9. Repair example: 3 correct pairs + 2 unavailable + 4 free

12-team Round 1:

```text
LOCKED

A-B
C-D
E-F

UNAVAILABLE

G
H

FREE

I
J
K
L
```

The organizer refreshes fixture status and chooses **Repair Round 1**.

Result:

```text
A-B  unchanged
C-D  unchanged
E-F  unchanged

G-H  contained as the round's unplayable/misarranged pairing

I-J  repaired valid fixture
K-L  repaired valid fixture
```

The exact I/J/K/L combination should follow the balanced-pairing objective.

G-H must not later count as a played opponent relationship merely because they were grouped together for round bookkeeping.

---

## 10. Repair example: 3 correct pairs + 3 unavailable + 3 free

```text
LOCKED

A-B
C-D
E-F

UNAVAILABLE

G
H
I

FREE

J
K
L
```

The three locked fixtures stay untouched.

The repair system should:

1. contain two unavailable teams together;
2. make the best valid pairing among free teams;
3. minimize the unavoidable effect caused by the odd unavailable/free remainder.

There is no way to create three valid tournament fixtures among these six participants because three cannot play.

The algorithm should maximize valid matches rather than destroying correctly arranged fixtures to make the round look symmetrical.

The exact Phase 1 bookkeeping for the unavoidable final unavailable/free pair can stay minimal, but it must be represented truthfully enough that later scheduling does not treat an unplayed fixture as opponent history.

---

## 11. Event-driven next-round generation

When the current regular round becomes resolved:

```text
current round resolved
↓
collect actual competition history
↓
materialize next pending regular round
```

Use:

- frozen season ranking;
- opponents actually played;
- currently committed opponent history where relevant;
- previous BYEs;
- current active season slots.

For a six-round regular season:

```text
initial generation → materialize R1

R1 resolved → generate R2
R2 resolved → generate R3
R3 resolved → generate R4
R4 resolved → generate R5
R5 resolved → generate R6
```

For the 6-team 5+1 competition:

```text
initial generation → materialize R1

R1 resolved → generate R2
R2 resolved → generate R3
R3 resolved → generate R4
R4 resolved → generate R5

R5 resolved
→ calculate final regular standings
→ materialize Championship Final #1 vs #2
```

---

## 12. What counts as a resolved round

The progression helper must distinguish between:

- completed/finished fixtures;
- finalized misarranged fixtures;
- BYEs;
- arranged fixtures still awaiting play;
- ongoing matches;
- unresolved/unarranged matches.

A detected misarrangement must not prematurely generate the following round while the current round can still be repaired.

The repair window and round-completion state are separate concepts.

Once the round is genuinely final, finalized misarranged fixtures may count as resolved for progression even though they contributed no played match.

---

## 13. Shared progression hook

Introduce one shared server-side progression/finalization operation.

It must be reachable from every path capable of making a round complete:

- CHPP/live match refresh;
- server-side fixture refresh/backfill;
- organizer/manual result updates;
- bulk result updates;
- CSV/import paths;
- any other current result-completion path discovered during implementation.

Do not let one browser-only result workflow bypass progression.

The operation must be:

- idempotent;
- transaction-safe;
- concurrency-safe;
- safe to call repeatedly;
- unable to generate the same next round twice.

---

## 14. One-round Championship Final

One postseason round is a complete and useful format.

For six teams:

```text
R1-R5  single round robin

Regular standings:
#1
#2
#3
#4
#5
#6

R6
#1 vs #2 — Championship Final
```

The playoff gives the regular-season runner-up one direct opportunity to win the tournament.

The regular-season standings remain intact.

Example:

```text
Regular season:
1. Team A
2. Team B

Championship Final:
Team B wins under playoff rules

Champion:
Team B
```

Do not rewrite the standings table to put Team B first.

---

## 15. 120-minute playoff advancement

Generic HT-120min playoff rules are independent from the English APPG-specific OPW rule.

### Regulation-time win

If one team wins during regulation:

```text
regulation winner
→ failed to reach the 120-minute objective
→ eliminated

regulation loser
→ advances
```

It does not matter how the decisive goal was scored:

- open play;
- set piece;
- special event;
- another valid Hattrick goal source.

Managers are responsible for minimizing all scoring risks through lineup/tactical choices.

### Level after regulation

If the teams are level:

```text
120-minute objective achieved
→ proceed normally
```

Then:

```text
extra-time winner → advances

still tied
→ penalty-shootout winner advances
```

The relevant regulation-time event is the final **game-winning / decisive goal**, not simply the first goal scored.

A lead that is later cancelled does not eliminate anybody.

Do not derive generic playoff advancement from APPG `OPW`, `RT0`, or open-play classification.

Implement this as a separate pure competition helper.

---

## 16. Standings

Regular-season standings must exclude postseason matches.

The current standings pipeline broadly consumes completed tournament matches, so phase must become part of the relevant standings input/filter.

For qualification:

```text
phase = regular
```

only.

Postseason fixtures must not affect:

- regular-season points;
- APPG/120-minute regular standings;
- qualification order;
- regular-season table;
- regular-season history standings.

The final/champion should be displayed separately.

The playoff engine should consume the resolved standings generated by the tournament's scoring mode rather than duplicate ranking logic.

---

## 17. Season slots and participant identity

New generated seasons should use current season-slot / assignment identity from the beginning where the existing model supports it.

This matters because:

- canonical team identity can change through replacements;
- standings already have season-slot-aware behavior;
- future rounds should use the current occupant of a competition slot;
- completed fixture identity must remain historically stable.

At initial schedule creation:

- initialize the current season slots if they do not already exist;
- create/confirm the current slot assignments;
- attach materialized generated fixtures to the appropriate season slots;
- use season slots when materializing later regular and postseason rounds.

Do not put temporary competition state such as:

- playoff seed;
- qualified status;
- current bracket position;

onto canonical `teams`.

Competition state belongs to the tournament season / round / season-slot model.

---

## 18. Actual opponent history

Staged scheduling needs a clear distinction between:

1. **played opponent**
2. **currently committed opponent**
3. **discarded planned opponent**
4. **misarranged/unplayed bookkeeping pair**

Only real competition history should constrain future no-rematch scheduling.

### Played

A completed tournament fixture:

```text
A vs B played
→ A-B counts as previous opponent
```

### Committed

A correctly arranged upcoming tournament fixture:

```text
A vs B correctly linked/arranged
→ pairing is frozen for current round
```

It should be treated as committed while repairing that round.

### Repaired away

```text
A originally scheduled vs B
pairing repaired before play
→ A-B does NOT count as previous opponents
```

### Misarranged containment

```text
G and H both booked elsewhere
system groups G-H for bookkeeping
→ G-H does NOT count as previous opponents
```

This distinction is essential so later balanced rounds are not distorted by matches that never happened.

---

## 19. Scheduling state versus match status

Do not overload existing match `status` beyond what it currently represents.

Current statuses such as:

- `not_arranged`
- `arranged`
- `ongoing`
- `misarranged`
- `finished`

describe fixture execution.

Round-level state such as:

- pending;
- materialized;
- completed;

describes schedule progression.

Keep these responsibilities separate.

Likewise, `fixture_warnings` can continue to represent booking violations/warnings. It should not become the canonical schedule-plan or round-progression model.

---

## 20. Length-based schedule mode

Preserve current legacy schedule modes for already-created schedules.

Introduce a new generated schedule representation for new length-based tournaments.

Conceptually:

```text
schedule_mode = length
```

with an explicit stored plan containing things such as:

```json
{
  "total_rounds": 6,
  "regular_rounds": 5,
  "postseason_rounds": 1,
  "ranking_source": "team_rank",
  "format": "round_robin_plus_final"
}
```

For a 12-team partial season:

```json
{
  "total_rounds": 6,
  "regular_rounds": 6,
  "postseason_rounds": 0,
  "ranking_source": "team_rank",
  "format": "balanced"
}
```

The exact physical schema can differ if a typed-column design is cleaner.

The important requirement is that the season's competition intent is explicit and not reconstructed later from unrelated match rows.

Do not disguise a six-round partial schedule as `single`.

Do not redefine the meaning of existing legacy `single`, `double`, or `recurring` records.

---

## 21. Generation transaction

Initial generation should atomically own the creation of the season plan.

Within one protected operation it should establish:

- tournament schedule metadata;
- season state;
- season slots/assignments where required;
- ranking snapshot;
- complete set of reserved rounds;
- each round's phase and reserved calendar slot;
- Round 1 pairings;
- Round 1 fixture rows;
- registration closure / schedule lock where current behavior requires it.

If generation fails halfway, it must not leave:

- some rounds without a plan;
- schedule metadata without rounds;
- partially initialized season slots;
- an active tournament without its first actionable round.

---

## 22. Current generation RPC

The current `generate_tournament_schedule` SQL logic independently enforces exact round counts for:

- `single`;
- `double`;
- `recurring`.

Retain those branches for backward compatibility.

Add a new length-based branch rather than weakening all validation.

The new branch should validate:

- explicit total round count;
- explicit regular/postseason counts;
- team count;
- calendar slots;
- phase ordering;
- season boundary;
- ranking snapshot presence where required;
- exactly one materialized current round at initial creation;
- zero fixtures in pending future rounds.

Conceptually:

```text
materialized current round
→ full valid fixture set required

pending future round
→ zero fixtures required
→ valid reserved round slot required
```

The RPC must not reject a valid future pending round simply because it has no `matches` array.

Do not replace the existing public generation boundary with a parallel API unless the current RPC cannot be extended safely.

---

## 23. Round materialization operation

Create one generic next-round materialization capability.

It should be capable of materializing:

### Regular round

Input comes from:

- frozen season ranking;
- current season-slot occupants;
- actual opponent history;
- BYE history;
- home/away history;
- reserved calendar slot.

Output:

- valid pairings;
- fixture rows;
- appropriate slot identities;
- `phase_status = materialized`.

### Postseason round

Input comes from:

- resolved regular standings or previous postseason result;
- tournament scoring profile;
- reserved postseason slot.

For Phase 1:

```text
regular #1
vs
regular #2
```

Output:

- one Championship Final fixture;
- `phase_status = materialized`.

The same operation should not materialize an already-materialized round twice.

Use DB locking/constraints appropriate to the existing architecture so concurrent refresh/result requests cannot generate duplicates.

---

## 24. Current-round repair persistence

Repair must be performed through a server-authorized transactional boundary.

It should:

1. lock the current materialized round;
2. reload current fixture state;
3. classify fixtures/participants as locked, unavailable, or free;
4. verify that the round is still repairable;
5. preserve locked fixture rows exactly;
6. replace/delete/update only uncommitted fixture rows as appropriate;
7. persist the repaired unresolved pairings;
8. leave warning/history semantics coherent;
9. return the repaired round.

If state changed between the UI preview and repair execution — for example a free team arranged its correct fixture meanwhile — the server must use current state and protect the newly committed fixture rather than blindly applying the stale browser plan.

Full manual per-team editing is outside Phase 1.

---

## 25. Interaction with fixture warnings

Existing fixture detection already understands:

- correct arrangement;
- booked elsewhere;
- misarranged fixtures.

Reuse that source of truth where possible.

Do not create a second competing definition of "booked elsewhere."

After repair:

- warnings should remain associated with the actual offending team;
- a blameless opponent whose original pairing was repaired should not become an offender;
- discarded pairings should stop behaving like active expected fixtures;
- repaired fixtures should become the new expected fixtures.

If current warning behavior cannot cleanly follow a repaired pairing, include the smallest required adjustment in Phase 1.

Do not redesign the entire warning system.

---

## 26. Home/away behavior

Home/away balancing is lower priority than:

1. valid current-round fixture;
2. no rematch;
3. strength proximity;
4. fair BYEs.

But it should remain a scoring/tie-break objective.

Across staged generation, use the actual materialized/played fixture history rather than assuming six pre-generated rounds exist.

A repaired-away fixture must not contribute home/away history.

A misarranged fixture that never took place should likewise not falsely improve home/away balance.

---

## 27. BYEs

Odd team counts are not today's primary launch cases, but the generic scheduler must remain safe for them.

A BYE:

- occupies that participant's round;
- is not a match against an opponent;
- should be recorded explicitly enough for fairness;
- should not create fake opponent history.

When generating the next round:

- prefer teams with fewer previous BYEs;
- avoid giving a second BYE while another eligible team has had none, unless other constraints make that unavoidable.

Pending rounds should not preassign future BYEs if pairings are generated progressively.

---

## 28. Regular-season completion and Championship Final creation

For the 6-team / 6-round case:

After R5 is resolved:

1. acquire the season/progression lock;
2. verify all five regular rounds are finalized;
3. calculate standings using `phase = regular` only;
4. select #1 and #2;
5. resolve their current season slots/occupants;
6. materialize R6 in its already-reserved W16 weekend slot;
7. mark R6 materialized;
8. retain R1-R5 standings as the final regular-season standings.

Repeated calls must return/no-op safely.

If a qualifying result is edited after the final has already been generated:

- do not silently change finalists;
- expose this as an explicit repair/rebuild issue;
- full repair UX can remain future work.

---

## 29. Championship resolution

Once the final is completed, determine the champion using a pure playoff-outcome helper.

Rules:

### Regulation-time decisive result

```text
A beats B during regulation
→ A is eliminated
→ B becomes champion
```

### Extra-time result

```text
Level after regulation
A wins during extra time
→ A becomes champion
```

### Penalties

```text
Level after regulation and extra time
A wins shootout
→ A becomes champion
```

This is competition logic separate from regular standings.

Do not mutate the regular table to express the champion.

Persist champion identity only where necessary for reliable history/display rather than deriving it forever from mutable present-day team state.

---

## 30. UI scope for Phase 1

Keep UI work functional and narrow.

### Before generation

Show:

- team count;
- closest selectable start;
- safe rounds remaining;
- HT season;
- meaningful tournament-length choices;
- missing-rank blocker/action where necessary.

Example:

```text
6 team tournament

Closest start date: Wed, 07/10/2026 (7 days)
6 safe friendly rounds left in HT S95

TOURNAMENT LENGTH

● 6 rounds     Single round robin + Championship Final
○ 5 rounds     Single round robin
○ [ 4 ]        Custom number of rounds
```

### After generation

Show the reserved season structure even though only the current round has pairings.

Example:

```text
Round 1
A – B
C – D
E – F

Round 2
Pairings generated after Round 1

Round 3
Pending

...

Round 6 — Championship Final
Top 2 after Round 5
```

### Repair

Minimum admin interaction:

```text
Refresh fixtures

3 fixtures arranged correctly
2 teams booked elsewhere
4 teams still available

[ Repair Round 1 ]
```

No need today for:

- drag-and-drop pairing;
- manual lock toggles;
- detailed optimizer visualization;
- elaborate repair preview;
- polished bracket UI.

---

## 31. Existing behavior that must stay intact

Do not regress:

- legacy `single` schedules;
- legacy `double` schedules;
- legacy `recurring` schedules;
- No pre-made schedule/manual tournaments;
- existing fixture linking;
- CHPP refresh;
- warnings;
- reserve-team flow;
- slot-safe team replacement/removal;
- historical season snapshots;
- existing rescheduling of dates;
- tournament lifecycle rules;
- existing schedule start-date protections.

The new generated model should coexist with legacy schedules rather than forcing an immediate migration of every historical tournament.

---

## 32. Database and deployment order

Use the next migrations after the current rank/sandbox migrations.

### Migration / deployment sequence

1. Add backward-compatible round progression fields:
   - `phase`;
   - `phase_round_number` if required;
   - `phase_status`;
   - reserved schedule slot/date metadata.

2. Add season-level schedule-plan / frozen ranking metadata in the most appropriate current season owner.

3. Ensure existing rounds receive safe defaults:
   - regular phase;
   - materialized/completed state inferred conservatively where appropriate.

4. Extend `generate_tournament_schedule`:
   - preserve legacy branches;
   - add length-based generation;
   - reserve all selected rounds;
   - materialize only R1;
   - initialize slot/assignment identity where required;
   - persist ranking snapshot and schedule plan transactionally.

5. Add generic next-round materialization operation.

6. Add transactional current-round repair operation.

7. Wire round progression into every result-completion path.

8. Update schedule-loading/types so matchless pending rounds are valid.

9. Update standings to distinguish regular/postseason matches.

10. Add minimal schedule/admin UI for:
    - length planning;
    - pending rounds;
    - current-round repair;
    - Championship Final/champion.

Do not require unrelated database restructuring for today's release.

---

## 33. Focused scheduler tests

Add tests for calendar behavior:

- safe slots are bounded to the current HT season;
- 7 October 2026 exposes six safe rounds;
- W15 weekend excluded by default;
- W16 weekend included;
- no silent S96 spillover.

Add format derivation tests:

- 6 teams + 6 safe rounds → 5 regular + 1 postseason option;
- 6 teams + 5 rounds → complete single round robin;
- 8 teams + 6 rounds → six balanced regular rounds;
- 10 teams + 6 rounds → six balanced regular rounds;
- 12 teams + 6 rounds → six balanced regular rounds;
- results arise from generic logic rather than team-count-specific branches.

Add pairing tests:

- no self-match;
- each participant at most once per round;
- no rematches while avoidable;
- deterministic output;
- rank-distance objective beats or matches the chosen valid baseline;
- fair BYEs;
- sensible home/away balance;
- full round robin eventually contains every pair exactly once;
- partial schedules favor similar-ranked opponents.

---

## 34. Staged-generation tests

Add tests that:

- initial generation materializes Round 1 only;
- all future selected calendar rounds are reserved;
- pending rounds contain no fake fixtures;
- resolving R1 materializes R2 exactly once;
- resolving R2 materializes R3, etc.;
- the next round uses actual prior opponent history;
- a repaired-away pairing does not count as opponent history;
- a finalized misarranged non-match does not count as opponent history;
- frozen season ranking remains unchanged if live `team_rank` later changes.

For a 6-team 5+1 season:

- R1-R5 are regular;
- R6 is pending postseason;
- R6 is not materialized before R5 resolves;
- R5 completion materializes #1 vs #2 exactly once.

---

## 35. Repair tests

Test:

### 3 locked pairs + 2 unavailable + 4 free

Verify:

- the 3 locked fixtures remain byte-for-byte/identity unchanged where applicable;
- unavailable teams are contained together;
- four free teams receive two valid repaired fixtures;
- no locked/free team appears twice;
- discarded pairings no longer remain active expectations;
- unavailable containment does not become opponent history.

### 3 locked pairs + 3 unavailable + 3 free

Verify:

- locked fixtures remain unchanged;
- maximum possible number of valid fixtures is retained;
- unavailable teams are contained as far as possible;
- only the mathematically unavoidable number of free teams is affected;
- the repair is deterministic for identical input.

Also test:

- arranged fixture cannot be rewritten;
- linked fixture cannot be rewritten;
- ongoing fixture cannot be rewritten;
- completed fixture cannot be rewritten;
- repair uses current server state rather than trusting stale browser state;
- repair after the round is no longer actionable is rejected.

---

## 36. Progression/result-path tests

Add integration coverage showing that each relevant completion path reaches the same progression operation:

- manual organizer result update;
- bulk result update;
- CHPP refresh;
- server fixture refresh/backfill;
- CSV/import where applicable.

Verify:

- incomplete current round does not materialize next round;
- ongoing match blocks progression;
- merely detecting an early misarrangement does not prematurely progress;
- finalized misarrangements can allow the round to resolve;
- concurrent/repeated progression requests create one next round only.

---

## 37. Standings/postseason tests

Verify:

- regular standings use only `phase = regular`;
- postseason final does not change regular points;
- postseason final does not change regular APPG averages;
- postseason final does not change qualification ranking;
- final can produce a champion different from regular-season #1.

Playoff helper tests:

- regulation winner is eliminated;
- regulation loser advances;
- ET winner advances;
- penalty winner advances;
- goal source has no effect on regulation elimination;
- APPG `OPW` classification does not determine generic playoff advancement.

---

## 38. Manual real-data verification

Use disposable/current HFI tournaments against the real database/CHPP flow.

### Schedule creation

1. Refresh all HFI ranks.
2. Confirm every active participant has a valid `team_rank`.
3. Confirm planner reports HT S95 and six safe slots from 7 October.
4. Test 6-team generation.
5. Confirm:
   - R1 materialized;
   - R2-R5 pending regular;
   - R6 pending postseason;
   - no fake future matches.
6. Test 8-team generation.
7. Test 10-team generation.
8. Test 12-team generation.
9. Confirm each has R1 only materialized and six calendar rounds reserved.

### Arrangement repair

Create/observe a state equivalent to:

```text
3 correct pairs
2 teams booked elsewhere
4 teams free
```

Then:

1. refresh fixtures;
2. verify the three correct pairs are recognized as committed;
3. run Repair Round;
4. verify those three remain untouched;
5. verify unavailable teams are contained;
6. verify free teams are re-paired;
7. verify fixture warnings still identify the real offending teams;
8. verify repaired-away opponents are available to meet in future rounds.

Repeat with:

```text
3 correct pairs
3 teams booked elsewhere
3 teams free
```

Verify the system preserves all correct fixtures and minimizes unavoidable damage to free teams.

### Progression

1. Complete/finalize Round 1.
2. Verify Round 2 appears exactly once.
3. Verify Round 2 pairings account for what actually happened in R1.
4. Continue enough rounds to confirm staged generation works.
5. Change a team's live HFI rank and verify generated behavior continues using the frozen season ranking.

### Championship Final

For a 6-team tournament:

1. resolve R1-R5;
2. verify final regular standings;
3. verify R6 materializes exactly once with #1 vs #2;
4. verify R6 does not alter the regular standings;
5. test a regulation-time final winner and confirm the other team becomes champion;
6. test an ET/penalty result and confirm the actual ET/penalty winner becomes champion.

---

## 39. Explicitly out of Phase 1

Do not expand today's work into:

- two-round playoffs / semifinals;
- larger knockout brackets;
- group stages;
- Swiss format;
- promotion/relegation;
- multi-league Power Rating scheduling;
- automatic repair without organizer confirmation;
- manual drag-and-drop fixture editing;
- elaborate bracket UI;
- complete fixture-warning redesign;
- historical schedule migration;
- broad data-model refactor;
- unrelated standings visual redesign;
- tournament activity redesign;
- general architecture cleanup.

The system should not prevent those future features, but today's implementation must remain launchable.

---

## 40. Existing uncommitted UI work

The existing uncommitted standings-related changes in:

- `StandingsView.tsx`
- `TournamentView.tsx`

must not be overwritten or casually reformatted.

Only touch overlapping code where required for this feature, and preserve unrelated user changes.

---

## 41. Phase 1 success criteria

Phase 1 is ready when the organizer can launch today's HFI tournaments and operate them through the following real-world flow:

```text
Create tournament
↓
refresh HFI ranks
↓
see 6 safe remaining rounds
↓
choose tournament length
↓
generate season
↓
only Round 1 pairings become actionable
↓
teams arrange friendlies
↓
refresh status
↓
correct fixtures freeze
↓
misarrangements detected
↓
Repair Round handles only unresolved teams
↓
Round 1 happens
↓
Round 2 generated from actual history
↓
repeat
```

For a 6-team tournament:

```text
R1
↓
R2
↓
R3
↓
R4
↓
R5
↓
regular standings finalized
↓
#1 vs #2 Championship Final generated
↓
120-minute playoff rule resolves champion
```

The implementation should solve today's 6/8/10/12-team, six-round HFI launch cleanly while establishing only the minimum reusable architecture needed for future cup and playoff formats.