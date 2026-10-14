# Flag Hunters

Flag Hunters is the overall flag-oriented tournament pairing system. Its first
implementation is a private Forge roster and round-one playground at
`/forge/flag-hunters`. A tournament collection and production pairing integration
are future work, not concepts owned by the playground.

## Prototype contract

The default tournament is `around-the-world`; the organizer can enter another
slug. **Load current roster** reads admitted team rows (`active`, not reserve,
not placeholder, positive Hattrick team ID). Duplicate HT identities fail visibly.
Missing manager identity leaves a team unresolved rather than assuming ownership.

The existing `/api/testing?tool=flag-hunters` dispatcher serves admin-only GET
rosters and POST flag reads, with Forge enablement checked again in this handler.
POST accepts only a selected admitted `htTeamId`; the server derives its recorded
manager and retrieves saved credentials server-side. It requests
`teamdetails&version=3.9&teamID=…&includeFlags=true`. It does not write teams, profiles,
fixtures or tournaments. No challenge-management scope is required for this read.
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

## Randomized baseline

Teams are sorted by HT ID, grouped by manager, and shuffled with a recorded seed.
At each step the two largest remaining manager groups supply opponents; seeded
tie-breaking provides variation. This achieves maximum match cardinality for the
complete cross-manager candidate graph; it is a randomized **baseline**, not a
uniform random draw or flag-optimized opponent recommendation.

For A hosting B, the two independent potential benefits are:

- A adds **B's country flag key to A's home collection** if absent.
- B adds **A's country flag key to B's away collection** if absent.

Compare both orientations, maximize confirmed gains (0–2), and break ties using
the seed. Unknown data contributes no confirmed gain but is displayed as unknown,
not as a confirmed zero. A normal single parity leftover is a BYE; multiple
same-manager leftovers or missing identities are unresolved. Neither receives a
potential flag benefit in the metrics.

Metrics report gaining teams, mutually benefiting matches, confirmed no-gain
teams and unknown-benefit teams among paired participants; BYE/unresolved teams
are displayed separately. Venue swaps recalculate metrics. Flag changes recalculate
existing draft benefits; roster identity/manager/league changes clear the draft.
The edited seed affects the next generated draft; the displayed draft retains its
actual generation seed. Simulation never materializes a schedule or books a match.

## Auto-arrange audit (source inspection, 2026-10-14)

| Step | Implemented behavior and trigger | Limits / verification |
| --- | --- | --- |
| Preferences | Current-season manager/team auto-arrange switches persist through the app API; absent preferences default on. Forge Match booking reads them. | Preference status is not an automation trigger. No live schema or preference write verified in this task. |
| Consent | Fixture challenge consent stores separate auto-send and auto-accept intent. | No automatic consumer of those flags found. Consent and CHPP scope are separate. |
| Inspection | Opening/reloading Forge Match booking reads pending/agreed CHPP challenges, authorization state and fresh manager team ownership. | Not a comprehensive friendly-date/cup/opponent challengeability preflight. This task made no live reads. |
| Send | A confirmed manual Forge POST rechecks fixture/round state, recorded booking state, scope, credentials, fresh ownership and exact-opponent pending/agreed challenges, then sends Cup Rules in the scheduled venue. Public fixture send is also an explicit manual POST after ownership checks. | Forge currently hardcodes midweek (`isWeekendFriendly=0`). Public send does not have Forge's exact-opponent pending precheck. No weekend execution or live send verified. |
| Accept | A confirmed manual Forge POST identifies an incoming offer from the exact fixture opponent and accepts its `TrainingMatchID`. | Midweek-only path. No background acceptance found; no live accept verified. |
| Reconcile | Forge rereads challenge state after actions; its browser calls fixture refresh after acceptance. Existing `teams/refresh-fixtures` matches Hattrick bookings to scheduled teams and reports conflicts/venue mismatches. | A displayed agreed challenge is not itself a persisted linked fixture. Refresh can fail after a successful external action; UI tells organizer to refresh again. No live reconciliation verified. |
| Retry / duplicates | Forge rejects already-arranged/misarranged fixtures and existing exact-opponent pending/agreed challenges before sending. | No durable action lease, automatic retry queue or atomic external-action deduplication found. Concurrent manual requests and timeouts after external success remain unverified. Hattrick is the final action authority. |
| Background execution | No auto-send/auto-accept worker, scheduler or cron consumer found in the inspected server callers and deployment config. | Existing enabled preferences do not establish automatic friendly booking. No new infrastructure introduced here. |
| Schedule | Existing organizer schedule generation uses `generate_tournament_schedule` and materializes round one through the app-owned scheduling flow. | Flag Hunters drafts are not connected to that RPC. Production scheduling, dates and booking need a separate accepted-draft integration and live validation. |

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
and the API with mocked Supabase/CHPP HTTP (including authorization, no writes,
no credential exposure and `includeFlags=true`). Browser interactions, session storage
recovery, real Supabase roster reads and live CHPP responses remain separate checks.

UI inspection: enable Forge locally and use an authorized Forge session. Load the
roster, inspect responsive tables, generate/reproduce a seed, swap venues, import
snapshots and inspect mismatch messages. An authorized roster connection is needed;
mock tests do not create a browser dummy route.

Real integration: explicitly refresh a few admitted teams first, verify flags
against Hattrick, then refresh all; pause/resume and export/reimport. Check timestamps
and failures before accepting a draft. No real challenge should be sent from this
playground. Decide flag-aware opponent selection using this data before designing
production snapshot persistence, draft acceptance, or a Flag Hunters collection.
