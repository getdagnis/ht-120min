# Public data rollout: implementation state and preflight

Design: [public data architecture plan](../plans/public-data-architecture-plan.md).

## Current state

Migration 088 is applied and its branch merged **as reported by the owner on 2026-10-03**, not independently inspected live. Its applied marker remains untouched. Home now has an opt-in local snapshot path; remaining targets retain existing delivery.

- [`088_public_data_publications.sql`](../migrations/088_public_data_publications.sql) creates two server-only tables. Ordinary artifacts overwrite one row per target/contract; historical revisions are independent, immutable audit records. Retiring a delivery row cannot erase its audits.
- [`public-snapshot-store.ts`](../src/server/api/_lib/public-snapshot-store.ts) provides scoped published-payload reads and atomic dirty/approve/claim/publish/failure/withdrawal operations. Component-specific allowlisting decoders are mandatory; no source reconstruction or CHPP fallback exists in this adapter.
- New targets remain draft until explicitly approved. Re-publication after withdrawal needs a new approved generation and build. A lease cannot publish after expiry, a newer mutation, withdrawal, or token replacement; stale failure cleanup cannot release another builder's lease.
- Withdrawal acceptance persists its original 60-second deadline. Invalidation acknowledgment and withdrawal verification are separate. The private status model returns “Withdrawal pending” on failure/unverified work, flags overdue work, and preserves a breach even if verification eventually succeeds. Home's purge worker exists; **regional probes and status UI remain outstanding**.
- Home-specific DTO/build/worker/cache and six transactional dependency triggers are implemented locally. The owner-added 089 applied marker is preserved; live application was not independently verified. Additive 090 event dispatch is prepared and tested locally only. No production scheduler, read cutover, archive pointers, correction command, authentication retirement or producer switching was activated. Automatic fixture/live behavior is unchanged; **automatic producer-generation fencing remains Phase 2 work**, not a delivered guarantee.

## Home path and activation

Home's directory/activity/Weekly are built by [`home-snapshot-builder.ts`](../src/server/api/_lib/home-snapshot-builder.ts) using explicit selects and existing sorting/calculation helpers. [`home-snapshot-contract.ts`](../src/server/api/_lib/home-snapshot-contract.ts) recursively allowlists output, omitting credentials and raw join stories. Source failures abort the build rather than publishing empty success. Activity expiry, Weekly expiry and kickoff have explicit `nextRefreshAt` boundaries, not a blanket TTL. Root/nested 1,000-row bounds fail conservatively; verify actual PostgREST limits before enabling.

[`089_home_snapshot_dependencies.sql`](../migrations/089_home_snapshot_dependencies.sql) couples tournament/team/round/match/warning/news changes to Home dirtiness in their source transaction. Credentials, unchanged projections and refresh clocks do not dirty Home; chat/comments/presence have no hooks. Fixed-target empty-search-path trigger privilege elevation is needed because existing browser writers cannot access publication tables; direct execution is revoked and no target/authority is caller-supplied. Existing source grants/RLS and producer logic are untouched. Measure trigger contention before rollout.

[`home-snapshot-worker.ts`](../src/server/api/_lib/home-snapshot-worker.ts) claims/publishes with 088's generation/token fence, never approves targets, never fetches CHPP, and repairs failed invalidation without a new build. [`home-snapshot.ts`](../src/server/api/home-snapshot.ts) exposes protected POST `/api/public-data/home/refresh` through the existing consolidated route, not a new function. Database requests have five-second deadlines and no independent fetch cache. A concurrent source mutation rejects the builder's stale commit.

`PUBLIC_HOME_SNAPSHOT_ENABLED=true` selects [`home-snapshot.ts`](../src/app/_data/home-snapshot.ts)'s shared Next Data Cache read of only `home:directory`, contract 1. Missing/draft/approved/withdrawn/cold-outage publications fail closed with no source/CHPP fallback. The flag defaults off until the following checks pass. Removing inherited `force-dynamic` permits that cache; cookies still keep shell/HTML dynamic and personalized. **Cached data is not fully static HTML.** Warm hits survive a database outage until eviction/purge; cold hits do not. Home hydrates Weekly without that extra browser query. Auth/chat/presence and activity's existing live report subscription remain separate; this does not promise zero total page/network queries.

Activation order (production-facing steps require separate authority):

1. Verify 089's actual applied definitions; verify real PostgREST joins, columns/grants, provider limits and trigger overhead in an authorized disposable tournament. Review/apply 090 only after owner-enabled pg_net, pg_cron and Vault preflight passes. Cron must use UTC. Privately confirm that public/browser roles cannot read Vault secrets or `net.http_request_queue` (its headers contain credentials); do not weaken grants or log queue contents.
2. Explicitly review/approve the Home publication: read its `source_generation` privately and call `approve_public_snapshot('home:directory', 1, <reviewed_generation>)` as service role. Null means concurrency: review again. Never autoapprove draft/withdrawn targets.
3. Configure server-only `PUBLIC_HOME_WORKER_SECRET` as a dedicated random secret of at least 32 characters. Privately configure Vault names `public_home_worker_secret` with the same secret and `public_home_worker_url` with the HTTPS production `/api/public-data/home/refresh` URL. As schema owner, call `SELECT home_publication_internal.start();`. This bootstraps pending work and installs one 15-minute **database-local** recovery check. Remove any previous ten-second Vercel dispatcher; do not run both. This task does not configure secrets, extensions, hosting or live jobs.
4. Run the worker, confirm public exposure, source/published generation equality and invalidation acknowledgment. Test source changes, build races, failures, time boundaries and recovery. Measure source-to-directory scheduling/build/purge latency; healthy-operation goal is **60 seconds**, not a proven production SLO.
5. Enable `PUBLIC_HOME_SNAPSHOT_ENABLED=true` only after production-mode parity and the plan's **60-second regional withdrawal coverage** checks pass. Worker repeatedly purges withdrawals and records purge failures but never verifies without regional probes; status therefore remains “Withdrawal pending”. Full probe/status UI remains outstanding. No downloaded browser copies can be recalled.
6. Roll back Home reads by disabling the flag; match producers stay untouched. If retiring dispatch, remove the two Home Vault entries and unschedule only `home-publication-wake` and `home-publication-recovery`; leave unrelated jobs alone. Retain any pending withdrawal repair obligation. Do not undo migrations, discard audits or republish withdrawn/restricted content.

### Event-driven Home dispatch (090)

Committed source changes, explicit approval and withdrawal queue the protected worker through [pg_net's transactional queue](https://supabase.com/docs/guides/database/extensions/pg_net): HTTP starts after commit, and rollback cancels the wakeup. Multiple changes in one transaction coalesce to one request; distinct transactions can still overlap and the existing build lease/generation fence protects publication. No new durable job table or API function is introduced.

One named `home-publication-wake` cron slot is replaced/removed as the actual `nextRefreshAt`, build lease or invalidation retry changes. Its five-field UTC expression rounds up to a minute; it is not a native one-shot timer (cron can repeat annually), so each execution checks the actual due timestamp and replaces/removes the slot. Time-driven Home changes may incur up to a minute of scheduling delay plus worker time. This is **not** the match scheduler and does not alter its 4–30-second updates.

A clean recovery check performs only database-local reads: no HTTP queue insertion, Vercel invocation or Supabase API request. At 15-minute intervals this is 2,880 local checks per 30 days, rather than 259,200 Vercel invocations and approximately 1.04 million API requests. Real mutations/due boundaries still incur worker work; cron run metadata still needs bounded retention (seven days successful, thirty days failed).

Dispatch infrastructure failures never abort valid tournament/match writes: dirty state survives for sparse recovery. A lost immediate dispatch can therefore wait up to fifteen minutes. The **60-second withdrawal target is unchanged**: overdue/unverified withdrawal stays pending with a recorded breach, not falsely successful. Successful purge alone does not verify propagation or recall visitors' downloaded copies. Missing/invalid configuration prevents explicit activation; hooks remain dormant without Vault entries. Measure actual pg_net delivery, cron precision, retries and source-to-cache latency before enabling reads.

Hiding/removing a tournament or deleting news closes admission of the old Home origin artifact (`approved`, not public). The worker purges **before** rebuilding, including failed rebuilds. Whole-target withdrawal uses 088's tombstone/deadline and requires explicit approval before re-publication. Invocation acknowledgment never proves regional propagation.

Local verification:

```sh
node --import tsx --test tests/home-snapshot.test.ts
node --import tsx --test tests/public-tournament-loader.test.ts
npm run build
node --import tsx scripts/verify-home-snapshot.mjs
```

The production-mode script starts/stops only loopback fake PostgREST and Next servers. It checks one cold snapshot request, zero warm HTML/RSC requests across locales, outage survival, refresh purge, withdrawn cold denial and worker authentication. It does not execute a browser or prove real Supabase/CHPP/regional propagation/deployed function counts. The two-calendar-month Weekly cutoff uses UTC and end-of-month clamping to prevent overflow/stale expiry.

Cache choice follows [Next's persistent Data Cache contract](https://nextjs.org/docs/app/api-reference/functions/unstable_cache); hard expiry uses [the documented `revalidateTag` API](https://nextjs.org/docs/app/api-reference/functions/revalidateTag). Installed Next 16.2.12 code and production-mode requests, not documentation alone, verified inherited dynamic configuration and cache reuse. Source hooks follow [Postgres trigger semantics](https://supabase.com/docs/guides/database/postgres/triggers).

For a completely empty **disposable** PostgreSQL cluster, apply `tests/sql/home-snapshot-dependencies.sql`, 088, 089, then `tests/sql/home-snapshot-assertions.sql`. The first file creates synthetic roles/source tables; never run it against an existing/production database. Rollback-only assertions cover transactional dirty coupling, no-op/credential/clock exclusions, rollback, stale builds, time-boundary idempotence, hidden-content admission and public-role denial. Simplified tables do not prove production constraints/trigger ordering/PostgREST.

For dispatch logic in that disposable cluster only, apply `tests/sql/home-dispatch-fakes.sql`, 090 and `tests/sql/home-dispatch-assertions.sql`. These extension API-shape stubs prove coalescing, rollback, lease suppression, no HTTP during 100 clean recovery checks, due-boundary dispatch, failure recovery and private-role denial. They do **not** prove real pg_net HTTP, Vault permissions or cron clock execution. Never install these fakes in an existing database.

The exact pushed base `13ad281b95cf7b349bee9adf26a76fdf4a8b8545` passed build and 362 tests but failed a real tournament-loader invocation with Home snapshots disabled: extraction had dropped the `getMatchDateForRound` import. The restored import is protected by an actual-loader regression (Node 22.15+/24, with Next's server-only alias). Root `tsconfig.json` has no source files and only project references: Next build/root `tsc --noEmit` do not prove referenced application sources typecheck. `tsc --noEmit -p tsconfig.app.json` exposes existing unrelated application errors; the import fix removes this loader's missing-name error, not those other errors.

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

**UI inspection:** compare Home cards/order/counts/activity/Weekly in English/Latvian with the flag off and on after authorized integration setup. Inspect mobile and authenticated states, and confirm Weekly/main directory hydration queries are absent. No browser/visual inspection was performed; the loopback production-mode HTTP check is not UI proof. Current/historical tournament tabs and automatic refresh remain unchanged.

**Real integration:** before enabling Home, verify real Supabase/PostgREST projections/grants, committed mutation coupling, worker scheduling/overlap/latency, and regional purge with an authorized disposable tournament. Warm query reduction is proven only against local fake PostgREST. Withdrawal UI/regional probes and CHPP scheduling/deployment remain unverified. The fenced shared producer is required for the later match cutover, not for this Home-only path that preserves its producer.
