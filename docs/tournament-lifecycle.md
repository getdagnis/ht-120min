# Tournament Planning and Recruiting

## Product contract

Real tournaments start in **Planning**. They are shareable, can accept registrations,
and remain visible in personal lists and collection directories. Homepage promotion,
ordinary homepage displays and public activity exclude them. Explicit admin featuring
overrides the Planning exclusion on the homepage and in collections. **Publish tournament** moves to
**Recruiting**, commits the registered roster, and enables scheduling. Recruiting
leads homepage listings and featured/collection previews. Publication preserves the
existing private/public visibility setting: private cups do not become public.

A team can register in multiple Planning lists only while uncommitted elsewhere.
Committing by publication, joining Recruiting, auto-start, or reserve promotion
withdraws it from other Planning rosters. Withdrawals deactivate registrations and
clear re-application suggestions; they do not delete identities, credentials, earlier
fixtures, or history. Leaving a committed tournament does not resurrect former lists.
Publication and auto-start drop stale conflicting participants and report their names.
Paused real tournaments remain exclusive. Finished/stopped/archived tournaments and
test/sandbox tournaments do not claim exclusivity. Unrecognized nonterminal legacy
statuses remain conservatively exclusive.

Returning to Planning keeps the roster and tournament settings, clears the current
season's rounds, fixtures, assignments, ranking/pairing plans and champion metadata,
resets lifecycle dates, and reopens registration. Existing reset guards reject played,
started, scored or past-kickoff fixtures. Older seasons remain intact. Application
modals explain that Hattrick friendlies are not cancelled by resetting the app.
Later-season re-application enters Planning; explicit Auto-start remains available.
Tests retain their legacy Open/Waiting states and existing non-exclusive behavior.

## Ownership and consistency

`tournaments.status` is the stored lifecycle. `teams` remains the existing
*tournament-scoped* registration/credential record; Planning registrations express
interest, and Recruiting/Active/Paused participation is committed. This is not a
canonical global team identity redesign. Existing season slots continue to own
scheduled positions and historical fixture identity.

[Migration 113](../migrations/113_tournament_planning_and_recruiting.sql) adds no
new tables. Statement triggers and mutation RPCs share a short transaction advisory
lock `(120,113)` before taking roster/status row locks. This serializes membership
changes, including legacy browser writes, and prevents concurrent double commitment.
Migration patching requires all 12 exact RPC signatures, rejects unexpected overloads,
checks each required guard replacement, and verifies the advisory lock is the first
outer-block statement in each installed function. Any mismatch aborts the transaction.
Metadata-only updates and normal reads do not acquire the lock. Registration/publication
withdrawals run within the same transaction; there are no per-team network calls or
snapshot writes for this feature.

The existing consolidated `/api/app` dispatcher gains `tournament-publication`,
`creation-roster` and `start-tournament-season` handlers. Publication/new-season actions
accept verified organizer/delegated operational access or the existing legacy password.
Creation roster writes require the verified original organizer or site administrator.
The deliberate site-administrator creation exception is preserved only through a
service-only RPC; browser requests cannot supply the membership bypass setting.
OAuth enrollment also uses that service-only RPC after the existing ownership checks.
RLS policies are unchanged. Slot RPCs retain their algorithms and guard predicates,
with only shared commitment-status checks and lock acquisition updated.

Successful writes expire affected tournament caches. The existing Home dependency
triggers dirty its publication. Planning cards remain in the Home directory payload
for collection pages, but its homepage selectors exclude them. The membership event
refreshes the current visitor's personal menu only after an explicit lifecycle change.

## Rollout and validation

Migration 113 is **prepared, not applied by the agent**. Run the
[read-only preflight](tournament-lifecycle-preflight.sql), review the affected real
Open/Waiting rosters and live RPC definitions, then apply before deploying the code.
An existing Open/Waiting real cup with current-season rounds is a hard stop, not an
invitation to erase data. Applied migration markers remain owner bookkeeping.
The migration is transactional: errors roll back the conversion and function changes.
Older browser tabs should reload after rollout. No live Supabase or CHPP validation
is implied by a successful local build.

Manual acceptance with real authorized managers:

- Register one team in two Planning cups; verify direct/collection/personal visibility
  and exclusion from ordinary homepage/activity listings; explicitly featured Planning
  cups remain visible in featured sections.
- Publish one; verify Recruiting precedence, exclusive participation, withdrawal from
  the other planning roster, and cache/menu refresh. Joining Planning while committed
  must fail. Leaving must not resurrect withdrawn registrations.
- Publish competing rosters concurrently or attempt simultaneous committed joins;
  at most one real commitment may survive. Publication reports stale teams it drops.
- Generate a schedule only after publishing. Return to Planning before play through
  the application modal; verify roster retained, current schedule cleared, and older
  seasons untouched. Verify resetting started/finished/past-kickoff fixtures fails.
- Finish a season and exercise both next-season choices; check withdrawals for
  Auto-start, and re-application without exclusivity for Planning.
- Exercise reserve admission and test/sandbox flows. Check unauthorized publication,
  creation-roster and new-season requests fail without changing any data.

Automated tests were not added or run for this task. Migration application, concurrency,
real OAuth/CHPP behavior and browser interaction remain owner verification steps.
