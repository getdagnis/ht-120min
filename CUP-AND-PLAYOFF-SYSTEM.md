# CUP-AND-PLAYOFF-SYSTEM

Status: product design / implementation target  
Project: HT-120min

## 1. Purpose

Replace the old generated-schedule assumption of **single round robin / double round robin / recurring schedule** with a season planner built around the actual remaining Hattrick calendar.

The organizer should primarily decide:

1. how many **safe friendly rounds** remain in the current Hattrick season;
2. how many of those rounds this tournament should use;
3. whether the season ends in the standings or reserves its final round(s) for a playoff.

The pairing system should favor matches between teams of similar current strength while avoiding rematches for as long as possible.

This document covers generated schedules. The existing **No pre-made schedule** mode remains a separate workflow.

---

## 2. Calendar-first season planning

The schedule UI should lead with the calendar, not with round-robin terminology.

Example:

```text
12 team tournament

Closest start date: Wed, 07/10/2026 (7 days)
6 safe friendly rounds left in HT S95
```

For the current end-of-season case, the six usable slots are:

```text
W12 midweek
W13 midweek
W14 midweek
W15 midweek
W16 midweek
W16 weekend
```

The W15 weekend slot is deliberately not counted as safe because qualification matches can block teams.

The headline **safe rounds** count must come from calendar rules. Risky or exceptional slots must not be silently included in it.

---

## 3. Tournament-length UI

Only show generated options that make product sense for the current:

- team count;
- safe-round count;
- regular-season length;
- possible playoff depth.

Always also provide a custom round count.

Do not expose every mathematically possible combination.

### Example: 12 teams, 6 safe rounds

A full round robin would require 11 rounds, so there is not enough season left to build a meaningful full-league-plus-playoff format.

```text
TOURNAMENT LENGTH

● 6 rounds     6 rounds of balanced pairings
○ [ 6 ]        Custom number of rounds (6 or less)
```

### Example: 8 teams, 9 safe rounds

A single round robin requires 7 rounds.

```text
TOURNAMENT LENGTH

● 9 rounds     Single round robin + 2 playoff rounds
○ 7 rounds     Single round robin
○ [ 6 ]        Custom number of rounds
```

### Example: 10 teams, 10 safe rounds

A single round robin requires 9 rounds. Two different 10-round competition structures are meaningful:

```text
TOURNAMENT LENGTH

○ 10 rounds    9 single round-robin rounds + 1 playoff round
○ 10 rounds    8 balanced rounds + 2 playoff rounds
○ 9 rounds     Single round robin
○ [ 6 ]        Custom number of rounds
```

It is acceptable for two named formats to have the same total number of rounds when the competition structure is materially different.

The default-selection priority between multiple equally long meaningful formats is not yet fixed.

---

## 4. Regular-season round counts

For a full single round robin:

```text
even number of teams: n - 1 rounds
odd number of teams:  n rounds
```

Odd-team regular seasons use BYEs rather than fake opponents. BYEs should be distributed as evenly as possible before any team receives a second one.

A custom round count is a **regular-season-only** schedule unless the organizer explicitly chooses a named playoff format.

---

## 5. Strength-based pairing

The new generated-schedule default is **balanced pairing**, not random seeding and not forced strongest-vs-weakest pairing.

The objective is:

> Pair each team with the closest-strength opponent it has not already played, while keeping the complete schedule valid.

The system should optimize the schedule as a whole rather than use a naive per-match greedy rule that creates avoidable bad pairings later.

### Ranking source

For a league-limited tournament:

```text
team_rank
```

Use the team's position within that Hattrick league system.

For a multi-league tournament:

```text
Power Rating
```

Use the globally comparable Hattrick strength measure rather than league rank.

The relevant ranking/Power Rating snapshot should be refreshed before schedule generation and then treated as the scheduling seed for that generated season. Already-generated pairings should not shift underneath the tournament because a live ranking later changes.

### Pairing priorities

In order:

1. each active team plays at most once per round;
2. no self-match;
3. avoid rematches while unused opponents exist;
4. minimize strength distance across the regular-season schedule;
5. distribute BYEs fairly for odd fields;
6. preserve sensible home/away balance.

As nearby opponents are exhausted, pairings naturally move progressively farther apart.

There is **no forced inverted round**.

The previously discussed strongest-vs-weakest "stress-test" round is dropped. It adds complexity without a strong enough tournament reason.

---

## 6. Full round robin versus partial balanced season

If the selected regular-season length is enough for a full round robin, every team should meet every opponent once.

At that point the ranking metric no longer changes *which* opponents are played; it can still influence the order in which those opponents are encountered.

If there are fewer rounds than required for a full round robin, use the balanced-pairing system to choose the best subset of opponents.

If the tournament runs beyond one complete round robin without a playoff format, additional regular rounds may become balanced rematches.

---

## 7. Playoffs are valid in 120-minute competition

A playoff does **not** need to behave like a conventional football knockout.

The core HT-120min objective remains:

> Avoid deciding the match during regular time. Reach extra time.

The playoff advancement rule must therefore reflect that objective.

### Regulation-time rule

If the match finishes level after regular time:

```text
objective achieved
→ continue to extra time
```

If one team wins during regular time:

```text
that team failed the 120-minute objective
→ the regulation-time winner is eliminated
→ the regulation-time loser advances
```

The relevant failure event is the **game-winning / decisive goal**, not simply the first goal of the match.

A temporary lead that is later cancelled does not eliminate anyone.

Examples:

```text
1–0 → 1–1 after 90'
No elimination. The match reached extra time.
```

```text
3–2 after 90'
The team that won 3–2 is eliminated.
The 2-goal team advances.
```

### Goal source does not matter

For the general cup/playoff system, the decisive regulation-time goal may come from:

- open play;
- a set piece;
- a special event;
- any other valid Hattrick scoring source.

The manager is responsible for managing the risk of all of them: weaker set-piece takers, less SE-optimized selections, tactics, lineup choices, etc.

There is **no generic playoff exception for set pieces or special events**.

---

## 8. Separation from the English APPG-120 ruleset

The existing APPG-120 implementation contains rules inherited from the English tournament, including the distinction between:

```text
OPW — regulation open-play winner
RT0 — other regulation-time ending
```

That distinction was an organizer-specific scoring rule.

It must **not** become the universal HT-120min playoff rule.

For generic playoffs:

> Any regulation-time win eliminates the winning team, regardless of how the decisive goal was scored.

The current APPG outcome classifier may still retain its English-tournament-specific classifications for that scoring profile. Playoff advancement is a separate competition rule.

---

## 9. Extra time and penalties

Once both teams successfully reach extra time, conventional football progression resumes.

```text
Level after regular time
→ both teams succeeded at the 120-minute objective

Extra-time winner
→ advances

Still level after extra time
→ penalty-shootout winner advances
```

At this point the better result decides progression normally.

This produces the defining playoff inversion:

```text
Before extra time:
winning the match in regulation eliminates you.

After reaching extra time:
winning the match advances you.
```

The same rule determines the champion in the final.

---

## 10. One playoff round is a complete format

A single playoff round is not incomplete or awkward.

It gives the regular-season runner-up one final opportunity to challenge the regular-season leader.

Example:

```text
Regular season complete

#1 vs #2 — Championship Final
```

If no playoff is selected, the regular-season standings determine the champion.

If one playoff round is selected, the regular season determines the finalists and seeding, while the playoff final determines the champion under the 120-minute playoff rules.

---

## 11. Two or more playoff rounds

Two playoff rounds naturally support a top-four bracket:

```text
Playoff Round 1 — Semifinals

#1 vs #4
#2 vs #3

Playoff Round 2 — Final

SF winner vs SF winner
```

The same concept can later extend to deeper brackets:

```text
1 playoff round  → top 2
2 playoff rounds → top 4
3 playoff rounds → top 8
```

The exact UI for brackets beyond the first two rounds is future work, but the underlying phase model should not prevent it.

---

## 12. Playoff qualification

Playoff qualification is based on the final regular-season standings produced by that tournament's scoring mode.

Examples:

- 120-minute scoring uses its own standings order;
- APPG uses APPG standings;
- future scoring profiles use their own standings logic.

The playoff engine should consume the resolved standings rather than duplicate ranking logic.

The preseason strength metric used for schedule pairing does **not** determine playoff qualification.

---

## 13. Event-driven postseason generation

Playoff pairings must not be generated before the teams are known.

At initial schedule generation:

```text
regular rounds
→ pairings generated now

postseason rounds
→ calendar slots reserved
→ opponents TBD
```

Example:

```text
8 teams / 9 rounds

R1–R7   regular season
R8      postseason slot — TBD
R9      postseason slot — TBD
```

When the final required regular-season result becomes complete and the standings are resolvable:

```text
regular season completes
↓
calculate final regular-season standings
↓
materialize first playoff round
```

When that playoff round completes:

```text
resolve advancement
↓
materialize next playoff round
```

This is event-driven. It should not require polling or a cron job.

### Server-side requirements

The progression operation must be:

- idempotent;
- authorized;
- safe to retry;
- unable to create the same postseason round twice;
- based on finalized/resolvable results;
- aware of the reserved calendar slot;
- able to create the next round only when the previous phase is complete.

If a result that determined qualification is later edited after the next phase has already been generated, the system must not silently rewrite the bracket. That requires an explicit organizer repair/rebuild flow.

---

## 14. Data-model direction

Competition phase belongs to the tournament season / round structure, not to canonical teams.

Conceptually:

```text
Tournament Season
├── regular phase
│   ├── Round 1
│   ├── Round 2
│   └── ...
└── postseason phase
    ├── Semifinal / Final / etc.
    └── generated participants
```

At minimum the system needs to be able to distinguish:

```text
regular
postseason
```

Do not add playoff state such as `qualified`, `seed`, or `playoff_position` to the canonical `teams` entity.

Where season slots are available, competition progression should ultimately follow the season slot / season participation model rather than mutable canonical-team identity.

---

## 15. Schedule persistence direction

The current generated scheduler assumes that the complete competition is known in advance.

Postseason support introduces a new generic capability:

> Reserve future competition slots, then safely materialize the next round when the previous phase resolves.

That capability should be reusable for future formats such as:

- groups → playoffs;
- qualification → championship phase;
- staged Swiss-like rounds;
- other event-driven cups.

The existing rescheduler can continue to move eligible future fixtures, but changing or generating postseason participants is a separate operation from rescheduling dates.

---

## 16. Schedule preview

The admin schedule preview should make unresolved postseason rounds explicit.

Example:

```text
Round 7
Team A – Team B
Team C – Team D
...

Round 8 — Playoff Semifinals
TBD — generated after Round 7

Round 9 — Championship Final
TBD — generated after Round 8
```

Do not create fake placeholder opponents merely to make future playoff rounds look populated.

---

## 17. Current product decisions

Decided:

- calendar-first tournament length replaces single/double/recurring as the primary generated-schedule decision;
- UI shows only meaningful format options plus a custom round count;
- safe rounds are calculated from the remaining Hattrick calendar;
- W15 weekend is not part of the default safe count;
- balanced closest-strength pairing is the default regular-season pairing logic;
- league-limited tournaments use league rank;
- multi-league tournaments use Power Rating;
- rematches are avoided while possible;
- the forced inverted round is dropped;
- rankings are refreshed before generation and then frozen as the schedule seed;
- a full round robin remains a meaningful named option when it fits;
- playoffs are optional;
- one playoff round is valid and meaningful;
- one playoff round means regular-season #1 vs #2 for the championship;
- two playoff rounds naturally mean top-four semifinals followed by a final;
- playoff pairings are generated event-by-event, not upfront;
- a regulation-time winner is eliminated from a 120-minute playoff;
- the decisive regulation-time goal may come from any goal source;
- if the match reaches extra time, the extra-time or penalty winner advances normally;
- the English APPG open-play distinction is not the generic playoff rule;
- postseason state belongs to season/round competition structure, not canonical teams.

Still to decide during implementation/product review:

- default-selection priority when two meaningful formats use the same maximum number of rounds;
- exact labels/copy for the generated options;
- how many playoff depths the first UI exposes beyond 1 and 2;
- organizer repair flow if a qualifying result is corrected after a playoff round has already been materialized.

---

## 18. Immediate implementation scope

For the upcoming HFI launches, the important first step is the regular-season generator:

1. calculate safe remaining slots;
2. let the organizer choose a meaningful tournament length;
3. refresh rank/Power Rating;
4. generate balanced, no-rematch pairings;
5. preserve existing calendar, home/away and BYE protections;
6. persist the chosen format clearly enough that future postseason support can build on it.

Do not delay the immediate ranked-schedule rollout on full playoff UI if the upcoming tournaments do not have enough rounds for a meaningful postseason.

The phase/event-driven foundation should, however, avoid painting the later playoff implementation into a corner.
