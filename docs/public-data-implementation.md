# Public data rollout: implementation state and preflight

Design: [public data architecture plan](../plans/public-data-architecture-plan.md).

## Current state

The first local persistence slice is prepared, not enabled in the application:

- [`088_public_data_publications.sql`](../migrations/088_public_data_publications.sql) creates two server-only tables. Ordinary artifacts overwrite one row per target/contract; historical revisions are independent, immutable audit records. Retiring a delivery row cannot erase its audits.
- [`public-snapshot-store.ts`](../src/server/api/_lib/public-snapshot-store.ts) provides scoped published-payload reads and atomic dirty/approve/claim/publish/failure/withdrawal operations. Component-specific allowlisting decoders are mandatory; no source reconstruction or CHPP fallback exists in this adapter.
- New targets remain draft until explicitly approved. Re-publication after withdrawal needs a new approved generation and build. A lease cannot publish after expiry, a newer mutation, withdrawal, or token replacement; stale failure cleanup cannot release another builder's lease.
- Withdrawal acceptance persists its original 60-second deadline. Invalidation acknowledgment and withdrawal verification are separate. The private status model returns “Withdrawal pending” on failure/unverified work, flags overdue work, and preserves a breach even if verification eventually succeeds. **No purge/probe worker or status UI is connected yet.**
- No normalized-source triggers, current archive-pointer writes, correction command, scheduler, public cache reads, authentication retirement, or producer switching has been activated. Automatic fixture/live behavior is unchanged. Snapshot build fencing is implemented here; **automatic producer-generation fencing remains Phase 2 work**, not a delivered guarantee.

Schema SQL was executed in an isolated PostgreSQL 16 test cluster with synthetic `anon`, `authenticated` and `service_role` roles. The rollback-only SQL assertions passed under both ordinary and deliberately permissive default grants; the migration explicitly removes inherited public privileges and audit UPDATE/DELETE/TRUNCATE privileges. A two-session claim race passed: one lease, one rejected claim. This is not Supabase/PostgREST/JWT verification, PostgreSQL 17 verification, or live migration application. No applied marker was added.

## Prerequisites before connecting public reads

| Boundary | Repository evidence / required next check |
| --- | --- |
| Publication DTOs | [`public-data.ts`](../src/app/_data/public-data.ts) still selects whole tournament/team/season rows. [`TournamentView.tsx`](../src/legacy-pages/Public/TournamentView.tsx) repeats reconstruction and has browser mutations. Implement explicit component contracts and safe source selects before these become shared snapshots; do not publish today's raw initial-data object |
| Listing versus confidentiality | Create explicitly labels `is_private` as “Unlisted tournament (accessed via link)”; Settings labels it unlisted on Home. Existing by-link access is deliberate UI behavior, not demonstrated membership privacy. Preserve it; do not infer explicit public publication approval from that flag. Unlisted targets remain excluded from new publications until delivery classification is settled |
| Administrative access | [`tournament-access.ts`](../src/server/api/_lib/tournament-access.ts) verifies organizer/delegated capabilities; legacy passwords still exist in Tournament View and some RPC callers. Verify each active organizer can use a real CHPP session before retiring password access; do not replace it with an unverified browser role |
| Database exposure | Run the read-only [metadata preflight](public-data-preflight.sql), then inspect relevant policies/privileged RPC definitions privately. Check column grants as well as row policies. Prepared publication security does not fix the legacy source-table grants |
| Mutation transaction inventory | Map every source mutation to an affected target in the same authoritative transaction; only then enable narrow dirty triggers. Direct SQL/external jobs remain a live-inventory gap |
| Shared automatic producer | Audit every write in [`live-matches.ts`](../src/server/api/chpp/live-matches.ts), [`refresh-fixtures.ts`](../src/server/api/teams/refresh-fixtures.ts) and [`length-schedule-service.ts`](../src/server/api/_lib/length-schedule-service.ts). Fence score/status/booking, warnings/stories, scheduling metadata, cleanup and progression inside DB transactions before enabling cutover |
| Hosting and withdrawal | Verify actual Vercel allowances/function count, cache layers, source of purge authority, bounded in-flight cache admission, serving/probe regions, and two clean probe rounds. A successful invalidation call is not evidence of propagated withdrawal |
| Scheduling and CHPP | Verify live extensions/jobs, second-level scheduler precision, request overlap/timeouts and provider allowances. Preserve 4–30-second match delivery and ten-minute booking reconciliation before removing browsing-triggered synchronization |
| Baseline measurements | Production-mode fixed journeys must count SSR, hydration, season navigation, authenticated overlays and CHPP work separately. Static estimates in the plan are not measured log-ingestion attribution |

Known local command/source inventory, not yet a complete transactional implementation:

- `src/server/api/app.ts`: role checks, joins/reserves/slots, lifecycle/archive, length schedule/result/recovery, news/comments and interactive commands.
- `src/server/api/_lib/auth-callback-handler.ts`, `auth/complete.ts`, `_lib/chpp-register.ts`: identity/registration writes.
- `src/legacy-pages/Create/CreateTournament.tsx`, `Public/TournamentView.tsx`: creation, settings, announcements, results/CSV, scheduling and remaining browser writes.
- `migrations/`: active schedule/lifecycle/result RPC definitions; applied definitions must be checked live without editing owner markers. The adapter's standalone `markDirty()` is for bootstrap/explicit repair only; domain mutations must call the SQL dirty operation inside their own transaction or through a source trigger, not as a separate HTTP request after commit.
- Chat/comments/reactions/presence: interactive storage only; do not create durable snapshot versions per message or tick.
- Testing/Forge/scripts/external SQL: same dependency and authorization rules if they change public facts; actual external job inventory remains unverified.

## Validation and practical checks

Adapter tests:

```sh
node --import tsx --test tests/public-snapshot-store.test.ts
```

For an **explicitly disposable** Supabase-compatible PostgreSQL database with `088` prepared/applied there, run the rollback-only persistence smoke test as the schema owner able to `SET ROLE service_role`. Do not use a production URL:

```sh
: "${HT120_DISPOSABLE_DB_URL:?Set a disposable database URL first}"
psql "$HT120_DISPOSABLE_DB_URL" -v ON_ERROR_STOP=1 -f tests/sql/public-snapshot-foundation.sql
```

The smoke file creates synthetic publication rows within a transaction, checks stale/expired leases, deadline-preserving withdrawal retries, public-role denial, immutable history and independent audit retention, then rolls back. It does not purge any cache or perform CHPP requests. Apply `088` to that disposable database separately when testing from scratch; **live migration application requires separate approval**.

For concurrency, prepare an approved dirty synthetic target in that same disposable DB, then run `claim_public_snapshot_build` for it in two concurrent sessions. Keep the winning transaction open briefly; exactly one claim should succeed, the other should return zero rows. Stop and remove the disposable test environment afterward.

**UI inspection:** no new public/admin UI is connected in this slice; Home, current/historical tabs and existing automatic refresh should retain their behavior. Do not interpret unchanged UI as proof that snapshot delivery is enabled. Runtime/browser inspection was not performed in this slice.

**Real integration:** before enabling anything, verify Supabase grants/PostgREST service-only access, genuine organizer sessions, committed mutation/dirty generation coupling, real cache purge propagation and the fenced shared producer in an authorized disposable tournament. Warm-read query reduction, withdrawal UI, CHPP scheduling and deployed behavior are still unverified and not delivered by this foundation alone.
