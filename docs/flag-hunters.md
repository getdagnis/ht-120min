# Flag Hunters

Flag Hunters is the overall flag-oriented tournament pairing system. Its first
implementation is a private Forge roster and round-one playground at
`/forge/flag-hunters`. Around the World's existing admin Generate action has a
local server integration for its flag-oriented opener. A tournament collection
remains deferred.

## Existing schedule generator integration

The authorized `generate-length-schedule` handler uses the ordinary calendar-first
planner, settings, validation, frozen ranking metadata and transactional generation
RPC. For `around-the-world`, the temporary organizer-approved Round 1 input is
[`plans/round-one-manager-priority.csv`](../plans/round-one-manager-priority.csv):
73 exact matches for 146 unique Hattrick team IDs. Labels are informational;
Hattrick IDs map to current participant database IDs. A checked-in JSON conversion,
[`approved-around-the-world-opening.json`](../src/server/api/_lib/approved-around-the-world-opening.json),
is imported with the server bundle so runtime filesystem access is unnecessary.
The integration test independently reads the CSV and checks that conversion and
all 73 serialized opponents and orientations. When intentionally revising the
approved CSV, regenerate the JSON's home/away IDs and labels and rerun that test.
Other CSV columns do not affect scheduling.

Every Generate submission reads the current active non-reserve roster; the planner
excludes placeholders. Exact agreement with the approved IDs is required. Added
and removed teams are listed in an error before the save RPC; invalid or duplicate
team identities, missing manager identities and same-manager opponents also stop
generation. No automatic substitutions or BYEs replace the approved matches.
The experimental scarcity algorithm and saved flag collections are bypassed;
Generate does not load manager flag profiles or fetch CHPP. The fixed override is
intentionally scoped by tournament slug, with no reusable Flag Hunters marker.
Other tournaments retain the ordinary generator. Booking availability was not
checked by this CSV override.

The selected opener relabels the existing regular-round plan through a bijection.
This preserves complete round-robin cycles, repeat counts, alternating venues on
repeat opponents, aggregate home/away balance and BYE rotation while retaining the
exact selected first-round opponents and venues. Frozen ranking seeds remain
unchanged for season slots and playoff rules. Later rounds retain the existing
circle-plan behavior; they do not speculate about future flag gains. The existing
planner calculates country-specific kickoff estimates for the selected home team,
serializes the exact opening pairings into both fixtures and the reserved slot
plan, then the same RPC saves them atomically. Recovery can therefore reuse them.
Existing fixture refresh, booking, misarrangement detection and Repair Round paths
are unchanged. This is a Round 1 benefit choice; later rounds retain the existing
circle pairing plan.

No admin settings, start-date choices, format/round controls, Cup Rules defaults,
W15/W16 handling, manual scheduling or regeneration controls were changed. The
browser's pre-generation preview remains the standard planner; the flag opener
is selected by the server on Generate. The CSV override has passed focused local
serialization and validation tests; it is **not deployed or exercised through a
live generation RPC**. No live roster agreement is claimed. Existing dates,
settings, authorization and overwrite protections are retained.

Sources: [server adapter](../src/server/api/_lib/flag-hunters-schedule.ts),
[existing Generate handler](../src/server/api/app.ts),
[cycle planner](../src/utils/round-robin-cycles.ts),
[integration tests](../tests/flag-hunters-schedule.test.ts).

## Prototype contract

The default tournament is `around-the-world`; the organizer can enter another
slug. **Load current roster** reads admitted team rows (`active`, not reserve,
not placeholder, positive Hattrick team ID). Duplicate HT identities fail visibly.
Missing manager identity leaves a team unresolved rather than assuming ownership.

The existing `/api/testing?tool=flag-hunters` dispatcher serves admin-only GET
rosters and POST flag reads, with Forge enablement checked again in this handler.
POST accepts only a selected admitted `htTeamId`; the server derives its recorded
manager and retrieves saved credentials server-side. It requests
`teamdetails&version=3.9&teamID=…&includeFlags=true`. On success it writes only
the manager's existing profile team collection fields and fetch timestamp;
it does not write tournament or fixture rows. No challenge-management scope is
required for this read.
Recorded ownership is used to choose a token, not asserted as freshly verified
ownership; this endpoint grants no challenge authority.

Flag snapshots contain HT team and manager identifiers, actual team CountryID,
competition LeagueID, manager-profile CountryID, a canonical `flagCountryId`,
home/away country flag key arrays, and a successful-fetch ISO timestamp.
`flagCountryId` is the regular CHPP LeagueID corresponding to the actual CountryID;
it is a country identity encoded in CHPP's flag-key namespace, not competition
membership. For example, Homegrown (`leagueId=1003`) Barbados CountryID 130 maps
to flag key 124; Nicaragua CountryID 121 maps to flag key 111. No global LeagueIDs
or stored team records are rewritten.

Incoming collected flag LeagueIDs are explicitly normalized through the same
worlddetails country mapping. Special or unrecognized flag entries set a
per-direction unknown indicator. A known collected match still proves no new
flag; otherwise unresolved entries prevent claiming a flag is missing.
Missing actual CountryID mappings likewise yield unknown opponent benefits.
Omitted collections remain unknown; explicitly returned empty collections are
confirmed empty. The shared CHPP parser and normal login refreshes are unchanged.

The list prefixes team and country names with their actual country flags, and
manager names with their own profile-country flags. Unresolved countries display
a globe. Competition membership remains visible separately below the country.

Version-2 snapshots are saved to session storage **after each successful team
fetch**. Scans are sequential, pause after the current request, and retry/resume
only missing, failed or saved-unverified entries. A failed refresh preserves the
last successful collection and marks it unverified. Leaving the page aborts its
request and stops the scan. Session storage is tab-scoped; export JSON before
closing the tab to retain the data. Storage failure is visible, not a fetch failure.

Import first validates a bounded (1 MB) versioned payload, then reloads the current
roster. It rejects another tournament, identifies new/departed/changed teams, and
drops collections whose team slot, manager, LeagueID or known actual CountryID no longer matches. Arbitrary
import properties are stripped. Restored/imported data is always labeled saved
and needing live refresh, with per-team timestamps; there is no assumed freshness
TTL. Saved data can inform a provisional draft, but is not evidence of current flags.
Existing version-1 snapshots remain importable and recoverable under the same
storage key. Collected flag arrays are normalized without repeating successful
CHPP fetches; missing country metadata for special-league teams is resolved from
the freshly loaded roster. Existing v1 country metadata can be inferred for regular
leagues only. Updated snapshots use version 2 and validate country-key consistency.
Snapshots contain no OAuth credentials or raw XML. Drafts are not persisted.

## Flag-fetch failure and correction (2026-10-14)

The initial prototype sent `flags=true`, which CHPP did not use to include the
collections. Every fetch consequently failed the intentional unknown-data guard.
The request now signs and sends `includeFlags=true`. The original API mock repeated
the incorrect parameter, so its passing result did not establish the CHPP contract.
The regression now requires `includeFlags=true`, rejects the old `flags` parameter,
and parses a sanitized multi-team response with `LeagueId` casing and AwayFlags
before HomeFlags. Supplied live XML confirms those collections are available with
the correct parameter; a successful fetch through the corrected application path
still requires a live retry. No private raw response is retained.

## First-round scarcity draft

Generation reloads the **current admitted roster** before using saved flag data;
registrations can continue arriving. Roster membership, manager/country identity,
known gender, exclusions, flag refreshes and imports invalidate the previous draft.
Organizer exclusion checkboxes and roster sorting remain local playground controls.
No schedule dates, cup checks, friendly windows or challenge authorization are
verified by the pairing engine. The preview says **collection-only feasibility**
separately from **booking availability not verified**.

### Priority and collection status

A useful opponent is a distinct eligible team that supplies a confirmed missing
country flag in at least one venue. It counts once even if both venues help.
Same-manager pairs and known conflicting genders are excluded. Missing manager
identity is unresolved; unknown gender does not establish booking eligibility.
Completed collections are those covering every mapped regular country in **both**
directions. Unknown or omitted collections/countries never become assumed missing
flags. Partial unknown collections remain unknown, although an independently known
directional benefit may still be displayed.

Only known incomplete collections with at least one useful opponent receive a
priority number. Order is:

1. Fewest useful opponents, above zero.
2. Highest manager collection total: the maximum home + away count across that
   manager's included teams, never the sum across teams.
3. Rarer own-country contribution using the existing active-team population
   snapshot; unknown populations follow known values and are visibly unknown.
4. Seeded tie-break.

Complete collections, incomplete collections with no useful opponent, and unknown
data remain separate statuses. All can supply opponents **where eligible**. A
completed donor never counts as a failed collecting opportunity.

A hosts B means A can gain **B's country at home**, while B can gain **A's country
away**. Country keys remain the canonical flagCountryIds defined above.

### Selection rules and practical limits

Both algorithms start with a maximum-cardinality matching over the same eligibility
graph, minimizing unpaired teams. The general matching helper uses alternating
paths and odd-cycle contraction (see the [Stanford matching notes](https://web.stanford.edu/~ashishg/cs261/win21/notes/lec6_roughgarden.pdf)). Small manager/gender graphs are checked against exhaustive matching in tests.
This structural matching is distinct from optimizing flag benefits.

The **random comparison** uses seeded edge ordering and chooses the better venue
for each selected pair. It is reproducible, not a uniform sample of all schedules.

The **scarcity heuristic** revisits pairings and venues rather than permanently
locking greedy choices. It compares drafts in strict order:

- Earlier collecting-team gains, represented as an exact lexicographic bit vector.
- More managers receiving at least one confirmed new flag.
- More total team gains, including mutual gains.
- Rarer missing flags (sum of inverse available country populations; unavailable
  populations contribute no claimed rarity).
- Prefer unpaired teams whose manager has another included team, then fewer lost
  useful opportunities, then seeded tie-breaking.

There are no adjustable score weights that can reverse the first three criteria.
Two-match reassignments can replace opponents or venues and swap a BYE. If those
stall, three-match reassignments search around unsatisfied collectors. Search is
bounded at 60,000 candidate evaluations and reports when it hits that limit. It
can miss larger rearrangements and is **not a proven optimum for flags or manager
coverage**. Structural matching cardinality is preserved during reassignment.

Shared-shortage detection uses alternating sets in the collector-to-useful-opponent
capacity graph. A group of three collectors sharing only two useful opponents is
shown as requiring at least one missed gain. These are necessary shortage bounds,
not a proof that every group without a warning is jointly satisfiable: venues and
physical matching can introduce further conflicts.

With an odd roster the automatic BYE avoids lost collecting gains and, among
otherwise equivalent choices, leaving a manager's only team out. Its reason is
shown. The organizer can force an included team to take the BYE; if that constraint
reduces feasible matching, the additional unresolved teams remain visible. Odd
structurally blocked rosters still show one parity BYE when an identified team is
available, plus all additional unresolved teams; missing manager identity remains
an explicit blocker.

### Review and export

The preview shows initial priority, team/manager/country, collection counts,
distinct useful opponents, selected opponent and venue, exact gained flag or
complete/unavailable/unknown/BYE status, and a reason for every missed collector.
Manager summaries show included teams and gains this round. Summary counts keep
completed collections and unknown data separate from missed collecting teams.
The same-roster random result is always available for comparison.

Manual venue swaps update the review and are labeled organizer changes. Draft JSON
exports contain the priority analysis, pairings, review, exclusions and random
comparison; they do not create an accepted schedule. The Forge browser cache is
still used for its draft review. A successful fresh CHPP fetch also saves the
collection in the manager profile for the existing admin Generate flow.

## Auto-arrange audit (source inspection, 2026-10-14)

| Step | Implemented behavior and trigger | Limits / verification |
| --- | --- | --- |
| Preferences | Current-season manager/team auto-arrange switches persist through the app API; absent preferences default on. Forge Match booking reads them. | Preference status is not an automation trigger. No live schema or preference write verified in this task. |
| Consent | Fixture challenge consent stores separate auto-send and auto-accept intent. | No automatic consumer of those flags found. Consent and CHPP scope are separate. |
| Inspection | Forge Match booking first loads the fixture list without CHPP, then checks each fixture's two button sets in bounded batches. Individual failures remain beside their fixture, with a retry. Manual Refresh data rechecks the round. | Not a comprehensive friendly-date/cup/opponent challengeability preflight. No live read was made for this change. |
| Send | A confirmed manual Forge POST rechecks fixture/round state, recorded booking state, scope, credentials, fresh ownership and exact-opponent pending/agreed challenges, then sends Cup Rules in the scheduled venue. Public fixture send is also an explicit manual POST after ownership checks. | Forge currently hardcodes midweek (`isWeekendFriendly=0`). Public send does not have Forge's exact-opponent pending precheck. No weekend execution or live send verified. |
| Accept | A confirmed manual Forge POST identifies an incoming offer from the exact fixture opponent and accepts its `TrainingMatchID`. | Midweek-only path. No background acceptance found; no live accept verified. |
| Reconcile | Forge rereads only the affected fixture's challenge state after an action; its browser calls fixture refresh after acceptance. Existing `teams/refresh-fixtures` matches Hattrick bookings to scheduled teams and reports conflicts/venue mismatches. | A displayed agreed challenge is not itself a persisted linked fixture. Refresh can fail after a successful external action; UI tells organizer to refresh again. No live reconciliation verified. |
| Retry / duplicates | Forge rejects already-arranged/misarranged fixtures and existing exact-opponent pending/agreed challenges before sending. | No durable action lease, automatic retry queue or atomic external-action deduplication found. Concurrent manual requests and timeouts after external success remain unverified. Hattrick is the final action authority. |
| Background execution | No auto-send/auto-accept worker, scheduler or cron consumer found in the inspected server callers and deployment config. | Existing enabled preferences do not establish automatic friendly booking. No new infrastructure introduced here. |
| Schedule | The existing calendar-first Generate flow reads Around the World's live admitted roster and persisted manager team flag collections, then sends exact fixtures and slot pairings to `generate_length_tournament_schedule`. | Local integration verified; no live generation, deployment or automatic booking performed. The legacy/manual flow is unchanged. |

Sources: [Forge booking API](../src/server/api/forge/matches.ts),
[Forge booking screen](../src/legacy-pages/Forge/ForgeMatches.tsx),
[public manual challenge and consent](../src/server/api/app.ts),
[CHPP challenge actions](../src/server/api/_lib/chpp-challenges.ts),
[fixture refresh](../src/server/api/teams/refresh-fixtures.ts), and
[scheduling rules](scheduling.md).

## Verification and next milestone

Automated tests cover flag direction, unknown/empty data, orientation metrics,
seed reproducibility, exhaustive small manager distributions, duplicate identity,
BYEs/unresolved teams, snapshot reconciliation/validation, omitted CHPP fields,
Homegrown country mapping, unresolved mappings, legacy snapshot upgrades,
scarce donors, shared shortages, manager maxima/coverage precedence,
three-match reassignment, BYE choices/overrides, and the API with mocked Supabase/CHPP HTTP (including authorization, scoped profile writes,
no credential exposure and `includeFlags=true`). A read-only live Supabase roster and the owner's latest exported collections were
used to generate an inspectable draft; its aggregate results and private artifacts
are in the task handoff, not frozen as current production state here. Browser
interactions, session-storage recovery and fresh live CHPP responses remain separate
checks. No fixture, challenge, booking or database mutation was performed.

UI inspection: enable Forge locally and use an authorized Forge session. Load the
roster, inspect responsive tables, generate/reproduce a scarcity seed, compare the random result, inspect priority and
manager coverage, override the BYE, swap venues, import
snapshots and inspect mismatch messages. An authorized roster connection is needed;
mock tests do not create a browser dummy route.

Real integration: explicitly refresh a few admitted teams first, verify flags
against Hattrick, then refresh all; pause/resume and export/reimport. Check timestamps
and failures before accepting a draft. No real challenge should be sent from this
playground. Decide flag-aware opponent selection using this data before designing
production snapshot persistence, draft acceptance, or a Flag Hunters collection.
