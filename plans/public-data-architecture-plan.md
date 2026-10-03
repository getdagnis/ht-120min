# HT-120min public data architecture implementation plan

Status: owner reports 088 applied and branch merged on 2026-10-03. Home's snapshot builder/contract/worker/cache path is implemented locally and opt-in; 089's owner-added applied marker is preserved, not independently verified live. Prepared 090 replaces idle ten-second worker polling with post-commit mutation/due-boundary dispatch and a fifteen-minute database-local recovery check. Local extension-stub tests are not actual pg_net/cron integration proof. No Home scheduler/read cutover, automatic-producer cutover or deployment performed. See [implementation state and activation order](../docs/public-data-implementation.md).

Investigation date: 2026-10-03.

Planning brief: [public data architecture investigation prompt](ht-120min-data-architecture-planning-prompt.md).

Revision: addresses automatic-update continuity, selective access checks, publication complexity, retention, historical correction authority, bounded public withdrawal, and in-flight producer fencing. Cached delivery for explicitly published public archives is confirmed; product decisions from the review supersede the earlier release split.

## 1. Recommendation and verified starting point

Adopt a simpler durable-snapshot hybrid: Supabase remains authoritative; public pages consume focused snapshots through Vercel's shared Data Cache. Keep one last-successful snapshot per component/contract, reuse existing season archives, and retain append-only versions only for finalized history and audited corrections. Build snapshots after meaningful mutations, rather than reconstructing tournament data for visitors.

First release: public reads, historical publication, safe mutation boundaries, reliable invalidation, **and a minimal shared automatic match worker before changing the existing automatic update mechanism**. The cutover must preserve automatic fixture booking detection, ongoing scores/events, completion/results, APPG reconciliation before finalization, and staged schedule progression. Presence improvements remain a separate follow-up.

**Release hard stop:** do not disable existing automatic synchronization, switch public match GETs to read-only, or substitute manual refresh until the replacement passes the continuity tests in Section 7. Retrofit both producers with the transactional generation fence before switching producer and consumer together. A selector alone cannot stop an old request already running. If the deployment cannot sustain existing timing, keep the current mechanism and postpone that cutover; do not claim the public-read invariants are fully delivered on that path.

### Verified repository evidence

| Area | Current evidence | Implication |
| --- | --- | --- |
| Framework | Installed Next.js **16.2.12**, React **19.2.6**, Supabase JS **2.107.0**; webpack builds; Cache Components disabled | Use the existing caching model initially; avoid coupling this redesign to a framework migration |
| Server reads | [`public-data.ts`](../src/app/_data/public-data.ts) wraps loaders in React `cache()` | Request memoization exists, but persistent public data caching does not |
| Home | Server loader performs up to three Supabase requests, including deeply nested tournament data | Ordinary visits repeat substantial reconstruction |
| Tournament | Server loader performs up to thirteen conditional Supabase requests | Query count depends on roster, rounds, slots, assignments, and organizer |
| Hydration | [`TournamentView.tsx`](../src/legacy-pages/Public/TournamentView.tsx), initialization effect around line 2463, calls `fetchData()` even when initial data exists | Hydration repeats approximately thirteen anonymous or fourteen authenticated reads on populated paths |
| Home hydration | Home skips its main reconstruction when initial data exists, but separately fetches Weekly posts and chat | Do not attribute the tournament's duplicate-load behavior to Home |
| Authentication | [`useAuth()`](../src/hooks/useAuth.ts) independently fetches profile, participation, warnings, organizer data, and managed tournaments; both Layout and Home consume it | Authenticated Home visits can duplicate the same personalized work |
| Browsing writes | Fixtures tab automatically calls fixture refresh; [`useLiveMatches()`](../src/hooks/useLiveMatches.ts) invokes a handler that calls CHPP, updates matches, and advances length schedules | Public browsing currently drives synchronization and domain writes |
| Interactive data | News, standings, activity, comments, and chat have additional reads/subscriptions and author enrichment | Caching the main loader alone is insufficient |
| History | Existing `tournament_seasons.snapshot_json`, `fixtures_snapshot_json`, and assignment identity snapshots already support historical views | Preserve and adopt this history rather than introducing a competing archive |
| Security | Public loaders use whole-row selects; team/profile schema contains OAuth fields; client code compares `admin_password` | Shared publications require explicit field allowlists and removal of client-side authorization |
| Deployment | One consolidated App Router API; repository documents Hobby and a full function budget; no cron configured in `vercel.json` | Extend the existing dispatcher; verify actual deployed function count before rollout |

These are **static request estimates**, not measured production traffic or database execution plans. They do not establish which subsystem produced the observed log-ingestion bytes.

Live schema, grants, deployed commit, hosting allowances, CHPP usage, cache hit rates, and log attribution remain unverified. Project documentation contains stale checkout/test/migration summaries; inspect actual files and live migration history before implementation.

### Journey map

| Journey | Server work | Hydration and interaction work |
| --- | --- | --- |
| Anonymous Home | Force-dynamic page/layout; Home loader reconstructs directory, summaries, activity | Main directory reconstruction is skipped when SSR data exists; Weekly posts, global chat, author profiles, and activity subscription remain separate |
| Authenticated Home | Same public server load; session-cookie handling in locale layout | Independent Layout/Home `useAuth()` consumers load overlapping personalized data; presence heartbeat and authenticated chat remain separate |
| Tournament overview/current standings | Force-dynamic route reconstructs current season, roster, standings, announcements, and history metadata | Initialization repeats `fetchData()`; standings/chat/news/comments introduce additional reads and subscriptions; APPG can enable live polling |
| Current fixtures | Same tournament reconstruction | Automatic fixture reconciliation on entry and ten-minute checks; live polling calls CHPP-backed endpoint; completion can reload fixtures |
| Historical fixtures/standings | Server loader still loads current-season normalized data and all season rows | Existing season selection restores fixture archives and historical standings; hydration still reconstructs current data; interactive yearbook/news/comment reads remain independent |
| Navigation/prefetch | App Router requests can execute the same dynamic loaders | Client state and effects can refetch or resubscribe; quantify actual prefetch behavior with production-mode network captures |
| Hidden/background tab | No new server render merely from hiding a tab | Presence heartbeat pauses; automatic fixture checks consult visibility; live hook has no visibility guard; subscription/reconnect and other timers require journey measurement |

Representative evidence: public App Router pages/layout, `public-data.ts`, Home, Tournament View, `useAuth.ts`, `useLiveMatches.ts`, `usePresenceHeartbeat.ts`, and tab/widget subscription effects. Counts across an entire journey remain unknown until measured.

## 2. Read models, ownership, and freshness

Public contracts must use explicit typed fields, replacing `Record<string, unknown>` and whole-row serialization.

| Read model | Authoritative sources | Publication rule | Separate fresh layer |
| --- | --- | --- | --- |
| Home directory/activity/Weekly | Public tournaments, relevant participation, rounds/results, warnings, news | Publish on affected mutations; schedule activity expiry | Login/menu state and global chat |
| Tournament shell | Tournament metadata, public roster, public announcements, season summaries | Until metadata, participation, assignment, announcement, or lifecycle mutation | Permissions, participant announcements, dismissals, admin configuration |
| Season fixtures/standings | Season-scoped rounds, matches, slots, assignments; existing calculation helpers | Until relevant mutation; finalized facts frozen | Current live observations |
| Historical season | Existing archived fixtures/yearbook and recorded identity | Immutable publication; explicit correction creates a new revision | Comments, reactions, viewer notices |
| Current public identity | Allowlisted team/profile metadata | CHPP refresh only during re-login or explicit authorized admin refresh | Credentials, ownership verification, authorization |
| Public news | Posts and public author metadata, scoped by tournament/season | Publish/edit/delete | Viewer reactions, comments, publishing permissions |
| Chat/comments | Existing message/comment tables | Bounded paginated initial reads and optional disposable cache; no durable publications or version per message | Realtime updates, moderation, fresh private access, authenticated submissions |
| Live match state | Current match observations, scheduling/result state | Automatic shared refresh in release one; overwrite only changed latest observation | Separate read-only delivery; never embedded in historical publications |
| Presence | Ephemeral online state and sparse `last_seen_at` | Existing behavior continues; improved semantics are a follow-up | Never dirties public snapshots |
| Auth/private data | Verified application session and authorized server queries | Request/user scoped | Never shared-cache output |

Use small projection components, not a tournament object containing every season, message, dismissal, and admin field.

Preserve `?season=N` and current tab URLs. Server loading must select the requested season; switching seasons retrieves that publication without loading the current season's normalized tables. Invalid season input retains current selection behavior.

Separate reusable boundaries inside Tournament View: published tournament data, viewer/admin state, and interactive widgets. Keep its visual layout and existing design components.

Time-dependent Home activity windows and next-match presentation need explicit handling: preserve source timestamps, calculate presentation from the small published payload where possible, and schedule a dirty target at the next required expiry boundary. Do not use a blanket TTL or leave time-filtered lists permanently stale.

### Historical finalization

A fixture is publication-finalized only when:

- CHPP confirms completion through MatchDetails, or an authorized operational organizer/admin records a terminal outcome for a fixture that has not yet been finalized.
- Required score, duration, event, shootout, and APPG classification data are reconciled; legitimate unavailable data is explicitly recorded.
- A BYE or unplayed fixture has an explicit terminal resolution.
- No postponement, unresolved match link, pending reconciliation, or required staged-round/champion decision remains.

Kickoff passing, `status='finished'`, or an elapsed time window alone is insufficient.

Finished seasons stop routine synchronization. Incomplete legacy archives remain visibly incomplete until an authorized reconciliation action; they are never silently fixed during browsing.

**Recording an unfinished outcome and correcting finalized history are different commands.** Operational result entry/BYE/unplayed resolution can complete an unfinished fixture; it cannot reopen or overwrite a finalized record. Historical correction requires a separate server-checked `canCorrectFinalizedHistory` capability, a reason, and the expected historical revision. Map that capability explicitly to verified tournament administrative authority (original organizer, co-organizer, tournament admin, or site superadmin); press officers and participants are excluded. An organizer can correct history only when authorized as an administrator through that separate check, never merely because the caller can submit an unfinished outcome. Preserve prior audited revisions and completed participant IDs.

Use recorded fixture/assignment identity first. Preserve existing historical snapshot values. When original identity is unavailable, retain unknown fields or label metadata as captured during backfill; never present current identity as verified historical identity.

## 3. Architecture and deployment compatibility

### Selected architecture

Use two additive tables, with different retention/lifecycle responsibilities:

- `public_snapshots`: one row per logical component and supported contract version, holding its last successfully published payload/checksum, source/published/cache-invalidated generations, and compact dirty/due/retry/lease metadata. Include publication exposure/tombstone state and coalesced withdrawal request/deadline/verification/error fields. A successful rebuild atomically replaces this payload; a failed rebuild leaves it untouched. There is no ordinary snapshot-version log or separate queue table.
- `historical_snapshot_revisions`: an immutable initial finalized revision and each explicitly authorized correction, with season/fixture scope, payload, revision, actor, reason, provenance, and predecessor. Keep `tournament_seasons.snapshot_json` and `fixtures_snapshot_json` as compatible current archive pointers during migration; atomically advance them with a successful historical publication.

These are first-class **publication artifacts**, not replacements for tournaments, seasons, or canonical team identity. Their source of truth remains the normalized tables and existing recorded historical facts. No durable snapshot is created for chat, comments, reactions, presence, or every live score. Their original tables/current observations remain their sources of truth.

Express the dependency matrix in one server/SQL mapping and derive affected IDs with indexed joins over existing relationships. Do not introduce `public_projection_dependencies` unless measurement demonstrates a relationship that cannot be obtained cheaply and correctly this way. Frozen history has no current-identity dependency.

Keep publication tables and operational RPCs server-only, with RLS and revoked public execution/grants. Public endpoints expose only validated DTOs. Do not put private fields into a payload and remove them afterward.

Use keys such as `ht120:public:v1:season:<season-id>` and focused tags for Home, tournament shell, season, identity, and news. Include contract/calculation versions in keys. Apply locale only where payload content differs.

Use `unstable_cache(..., { revalidate: false })` initially. It supports indefinite caching and explicit invalidation without enabling Cache Components. Remove inherited `force-dynamic`/`force-no-store` configuration that bypasses it; request-time cookies and authorization can still make rendering dynamic. Verify this in production mode against installed Next.js. [Next.js cache documentation](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)

Cache **published payload reads**, not a query of the publication table on every view. Cold cache fills may read an already-published payload; they must never run CHPP or repair normalized data.

### Cache layers

- React memoization: deduplicates work within a render/request.
- Server Data Cache: shares published payloads across requests and instances.
- Full Route Cache: caches rendered HTML/RSC where the entire route qualifies.
- CDN cache: caches HTTP responses; only safe for explicitly public responses.
- Browser/router cache: reduces navigation requests but is not an authorization boundary.
- Durable publications: survive cache eviction and deployment independently of framework cache entries.

Vercel's Data Cache is regional, persists across deployments, and can evict entries. Its item limit is **2 MB**. Set a **1 MiB serialized application limit per component**, leaving headroom; split oversized fixtures by round and news by cursor pages. Chat/comments use bounded pages without durable payload duplication. Never silently truncate fixtures or standings. Monitor existing cache allowance and eviction before adding infrastructure. [Vercel Data Cache](https://vercel.com/docs/caching/runtime-cache/data-cache)

No local-memory map is a durable or cross-instance cache. Optional in-process single-flight only reduces duplicate work within that instance; durable publications and fenced worker leases provide the cross-instance guarantees. A cold cache may still produce concurrent bounded publication reads in different regions; it must not produce concurrent normalized rebuilds or CHPP calls.

### Selective public delivery and access checks

Do not impose a Supabase gate on every public response. Classify components by actual exposure requirements:

| Content | Delivery/access rule | Supabase requirement on a warm read |
| --- | --- | --- |
| Explicitly published public tournament facts, results, fixture/standing archives, public identity and public news | Cached public snapshot; mutation-driven invalidation/withdrawal with the agreed propagation window | None for the domain payload; public archives do not receive a per-view authorization gate |
| Home directory/Weekly | Cached public-only projection; changes in listing/visibility invalidate affected lists | No universal authorization gate; entries requiring immediate revocation must be omitted from this cache or checked separately |
| Actual private/restricted tournament data, participant-only announcements, private messages | Authorized request-scoped read; no shared HTML/JSON output | Fresh session and current access checks; fail closed on outage |
| Admin configuration/actions, roles, organizer warnings, private viewer state | Authorized request-scoped overlay/command | Fresh server checks; independent of historical/public facts |
| Previously public content that must become inaccessible immediately | Explicit revocable classification; no static route/CDN delivery | A fresh batched visibility/revision check for that component until another revocation mechanism is verified |

`is_private` is not by itself a verified confidentiality contract: the current Home loader filters it, while the tournament loader and historical read policies do not consistently enforce it. Phase 0 must distinguish unlisted-by-link behavior from genuinely access-controlled data; do not silently change that product behavior or cache private content because of permissive legacy RLS.

**Confirmed delivery policy:** explicitly published public archives use cached delivery without a per-view Supabase authorization query. Withdrawal permits a measured cache-purge propagation window. Genuinely private/restricted content always uses fresh authorization and is never promoted into this cache merely because legacy RLS allows reading it. Immediate revocation, if required for another component, uses its separate fresh-check path rather than changing all public archive reads.

### Bounded public withdrawal

**Target: within 60 seconds of the authorized withdrawal transaction committing, new requests through every application-operated public delivery path stop receiving the withdrawn content.** This is an operational target to prove on the deployed hosting environment, not a promise of instantaneous revocation or a provider-backed SLA. Measure from the database-assigned request timestamp persisted in that committed transaction, conservatively including its short transaction time; never start/reset the clock when a worker eventually picks up the purge.

1. In that transaction, mark the component withdrawn, advance its exposure/source generation, and persist `withdrawal_requested_at`, `withdrawal_deadline_at = requested_at + 60 seconds`, and pending repair state. Cold reads refuse the payload; builders cannot reactivate or republish that generation. Remove affected public references from Home/discovery and dependent summaries, using withdrawal-safe omission while ordinary rebuilding catches up. Historical audit copies remain private.
2. Immediately expire affected Data Cache tags using `revalidateTag(tag, { expire: 0 })`, invalidate rendered HTML/RSC paths, and purge any separately configured CDN response cache. Cover supported contract versions, locale/slug/season aliases, public JSON endpoints and cached discovery entries. Do not use stale-while-revalidate or stale-on-error for withdrawal. An old warm copy can still be delivered during propagation; the authorized control must make that limitation explicit. [Next.js immediate tag expiry](https://nextjs.org/docs/app/api-reference/functions/revalidateTag), [Vercel cache layers](https://vercel.com/docs/caching)
3. Account for a cache fill/render that started before withdrawal and finishes after the first purge. Establish and test a bounded cache-admission/drain interval, repeat invalidation after pre-withdrawal work has drained, and verify the stale response cannot repopulate a public cache. Fit draining, final purge and verification inside the 60-second target; do not enable a cache layer whose in-flight admission or purge cannot be bounded and tested.
4. Verify with ordinary anonymous requests to warmed canonical URLs and their HTML/RSC/JSON variants from the configured serving-region/edge probe set. Direct content must return a content-free unavailable/withdrawn response; discovery/summary responses must omit it. No cache-busting query or forced-origin request may stand in for this check. Record returned revisions/cache headers and require two clean rounds at least five seconds apart after the final purge. Register the actual probe locations and supported cache layers during Phase 0; successful probes are measured coverage, not proof about every worldwide intermediary.
5. Persist `withdrawal_verified_at` only after required invalidation operations and those checks pass. Reuse current-snapshot retry metadata and the existing repair worker; no separate purge event stream or operations subsystem. Explicit re-publication requires a new authorized exposure generation, not a retry of the old builder. Withdrawal work takes priority over ordinary snapshot repair.

**Failure/UX contract:** the authorized organizer/admin view shows **“Withdrawal pending”** from acceptance until verification. On any purge/probe failure, retain that state with a sanitized failure reason, elapsed time and retry control; after 60 seconds add a target-breached warning and flag it for operational intervention. Retry immediately within the worker budget, then on the shared minute-level repair schedule. Missing probe coverage or unavailable verification also means pending, never success. Distinguish “withdrawal accepted” from “withdrawal verified” in the command response; do not report the archive as confidential or fully removed while pending. Unauthorized/public responses must not expose internal failure details.

**Scope of removal:** the target covers new delivery by caches/routes operated by HT-120min, not material already downloaded by visitors, screenshots, offline/browser/router copies, external search caches or third-party mirrors. Notify connected views to remove/refetch content and clear managed client state on reconnect/navigation, but do not wait for all visitors to acknowledge or promise remote erasure. A change from public to restricted makes future authorized origin access fresh immediately; its former public copies still follow this withdrawal contract. Content needing confidentiality from the outset must never use the public publication path.

### Static historical rendering

The locale layout currently reads a session cookie for analytics exclusion. Consequently, removing page-level `force-dynamic` does not make the full route static.

Gate-free public history can use indefinite cached data now and framework prerendering after removing the cookie dependency from its server shell. Move viewer/auth/analytics-exclusion handling into a separate uncached client-requested layer, preserving analytics exclusion before analytics starts. Static rendering must be evidenced by a production build and outage test, not inferred from removing `force-dynamic`.

`?season=N` alone does not create distinct statically prerendered season routes. Preserve those existing links; if full per-season static HTML is enabled, add a locale/slug/season-number page segment serving the same view and route the legacy query form to it without losing the selected tab. Check the deployed function budget first. Cache-data delivery at existing URLs can ship independently; the selected-season path is a small subsequent rendering slice, not an HTML export pipeline. Private/revocable views remain dynamic. [Next.js ISR](https://nextjs.org/docs/app/guides/incremental-static-regeneration)

### Alternatives

| Option | Assessment |
| --- | --- |
| Cached normalized loaders only | Smallest diff; insufficient by itself because eviction repeats reconstruction and immutable history is not protected |
| One current durable snapshot per component, post-commit invalidation, existing archives | Simplest viable baseline; bounded cold reads and stable storage. Without a persisted dirty generation it can miss invalidation after a crash/direct SQL change |
| Current snapshots plus coalesced generation/retry fields and historical correction ledger | **Recommended:** adds failure recovery within the snapshot row and preserves audited history; two tables, no dependency registry or ordinary revision stream |
| Original three-table versioned publication subsystem | Handles dynamic dependencies and per-publication auditing, but no current requirement justifies keeping every ordinary version or operating a general dependency registry |
| Snapshot files in object storage or full HTML export | Can provide another origin for cold/outage reads, but adds storage delivery, withdrawal and deployment machinery; reconsider only if cache-eviction availability measurements require it |

### Mechanisms retained, simplified, or deferred

| Mechanism | Decision and concrete reason |
| --- | --- |
| Atomic replace and generation compare-and-swap | Keep: prevents partial output and stale rebuilds overwriting a later mutation |
| Dirty/due and cache-invalidated generation | Keep as fields on `public_snapshots`: survives both commit-before-publication and publication-before-invalidation crashes |
| Source-change triggers | Keep narrow field-based triggers while direct SQL/RPC/browser writes exist; client-only invalidation cannot cover them. Do not enqueue on token/presence/unchanged refresh writes |
| Dependency tracking | Use the explicit matrix and indexed source joins; defer a persisted dependency graph |
| Leases and producer generation | Keep worker leases plus a monotonic per-tournament producer generation: leases fence competing refreshes; the generation also fences old in-flight work during cutover/rollback. No per-view lock checks or general job framework |
| Repair schedule | Reuse the release-one shared scheduler to inspect coalesced due targets; no separate publication cron subsystem |
| Webhooks | Defer: known commands publish immediately; the persisted dirty state and scheduled repair cover external writes. Add webhook wakeups only if measured latency requires them |
| Revision barriers | Only for the explicitly immediate-revocation subset; no universal gate or global barrier system |
| Invalidation/withdrawal status | Coalesced generation/status fields on the current snapshot, not a separate event log/table; invocation success and verified withdrawal are distinct |
| Admin repair | One guarded status/rebuild/retry command with bounded target scope; use existing admin surfaces, not a new operations dashboard |
| Audited versions | Only final history/corrections; ordinary snapshots and latest live observations overwrite in place |

The simplified design still needs nontrivial security and mutation work. The original estimate was 8–14 engineering days; reducing machinery does not establish a shorter delivery promise, particularly now that automatic replacement is mandatory in release one. Section 5 states the revised estimate and gates.

### Publication retention

| Data | Retention/pruning policy |
| --- | --- |
| Ordinary Home/shell/current-season/identity/news snapshots | One last-successful payload per logical component and supported contract; overwrite atomically. No immutable version per edit |
| Contract compatibility | Keep current and previous supported contracts. Previous contract removal requires rollback-window closure, no active deployment dependency, and at least 30 days after retirement |
| Final historical revisions | Keep the initial finalized version and all audited historical corrections indefinitely; superseded versions remain server/admin-only, not alternate public endpoints |
| Live scores/events | One latest shared observation; no publication-version stream. After confirmed completion/reconciliation, freeze final facts; clear transient clock/lease/feed state after 24 hours. Keep the authoritative final result/event record |
| Chat/comments/reactions | No durable snapshots. Keep original product rows according to existing retention/moderation rules; optional bounded disposable caches contain only the loaded page and expire/evict without archival retention |
| Dirty/retry/lease state | Coalesced in place; clear completed/expired state. Do not accumulate one job row per source update |
| Operational logs/job-run details | Aggregate useful counts daily; prune service-owned successful run details after seven days and sanitized failure diagnostics after 30 days. Do not alter the existing activity ledger's separate retention policy |

Prune retired ordinary payloads/worker metadata in small scheduled batches; protect active pointers and compatible rollback contracts. Audited historical revisions are never automatically pruned. Content withdrawal overrides public cache retention and removes all public delivery paths; any required erasure of private audit payloads is an explicit separately authorized operation.

No new paid service is assumed. Verify the project's actual cache allowance, function duration/count, Supabase storage/egress, and scheduled-job usage before rollout; a specific hosting bill or 100-times-capacity guarantee is not established by this investigation.

## 4. Mutation, publication, and invalidation flows

### Publication flow

1. An authorized authoritative transaction commits its domain changes and increments affected snapshot source generations/dirty state in the same transaction.
2. Known mutation handlers request a bounded immediate build; scheduled repair discovers other dirty rows, including direct SQL changes. No webhook infrastructure is required initially.
3. The builder claims a dirty row only when needed, reads its generation and allowlisted sources, and validates completeness and payload size.
4. Atomically replace the last-successful payload only if the generation and fencing token still match. Finalized history/corrections additionally append their audited revision in that transaction.
5. Invalidate affected data tags and rendered paths after publication. Advance the row's cache-invalidated generation only after the invalidation call succeeds; retain outstanding work for retry otherwise. This field tracks invocation/retry, not proof of instantaneous global propagation.

Database triggers cover browser legacy paths during transition, RPCs, admin tools, OAuth, sync jobs, and ordinary direct SQL. Compare relevant old/new fields: presence timestamps, OAuth token rotation alone, and unchanged refresh timestamps must not invalidate public tournament data.

Multi-step domain operations must become authorized transactional commands before publication rollout; otherwise a publisher could observe a partially completed join, lifecycle transition, or schedule edit.

### Dependency mapping

| Mutation family and existing entry points | Dirty outputs |
| --- | --- |
| Settings/visibility/archive: Tournament View; `handleArchiveTournament` | Shell, affected Home cards; purge/withdraw public outputs or raise a scoped barrier for immediate-revocation content |
| Join/leave/reserve/replacement: auth completion, `chpp-register`, participation/reserve/slot handlers | Roster/shell, affected current season, relevant Home summaries and viewer menus |
| Generate/reschedule/repair/reset/start/finish: schedule RPCs, length service, lifecycle controls | Selected season, shell/index, Home summaries; preserve prior frozen seasons |
| Link/booking/final-result/final-event/warning: fixture refresh, shared live worker, manual/CSV result commands | Affected season and derived standings/activity/Home statistics; terminal outcomes also trigger staged progression |
| Ongoing score/clock/event observation | Latest shared live state only; no ordinary version history or historical rebuild. Publish season facts on a semantic lifecycle/final-result change, not every live tick |
| Login/admin identity refresh: auth callback/completion, `handleUpdateHfiRanks` | Current identity and dependent active/public outputs; never frozen identity |
| News publish/edit/delete/round report: existing app handlers | Season news, latest-news panels, Home Weekly/report activity |
| Public announcements | Shell; participant announcements remain private |
| Chat/comments/reactions | Disposable page-cache invalidation and interactive delivery only; no durable publication, never season fixtures or standings |
| Roles/session/dismissals | Fresh viewer state only; access changes do not require rebuilding historical facts |
| Historical correction | Admin-authorized audited revision for that season plus necessary index/summary invalidation; purge superseded public output, preserve prior private audit revisions |
| Direct SQL/external writes | Same table/field-based dependency rules; triggers must remain enabled |

Identity-to-output dependencies must include published author identities and organizer names, not only participants.

Important source entry points:

- [`src/server/api/app.ts`](../src/server/api/app.ts): operational access, participation/reserves/slots, lifecycle, news, comments, presence, and admin actions.
- [`auth callback`](../src/server/api/_lib/auth-callback-handler.ts), [`auth completion`](../src/server/api/auth/complete.ts), and [`chpp-register`](../src/server/api/_lib/chpp-register.ts): identity, profile, and registration writes.
- [`fixture refresh`](../src/server/api/teams/refresh-fixtures.ts), [`live matches`](../src/server/api/chpp/live-matches.ts), and [`length schedule service`](../src/server/api/_lib/length-schedule-service.ts): synchronization, result persistence, and progression.
- [`TournamentView.tsx`](../src/legacy-pages/Public/TournamentView.tsx): remaining browser mutations, lifecycle/history controls, results/CSV, announcements, and schedule RPC callers.
- [`CreateTournament.tsx`](../src/legacy-pages/Create/CreateTournament.tsx): tournament creation; include it in the implementation command inventory.
- Migrations define schedule, season-transition, slot/reserve, and result RPCs; inspect actual applied definitions before adding triggers or replacing callers.
- Protected testing/Forge tools and one-off scripts must use the same source-generation mechanism if they change public facts.

No external callback or scheduled job inventory was verified live. Repository cron configuration is absent; inspect Supabase jobs/webhooks and deployed integration configuration during Phase 0.

### Concurrency and recovery

- Shared builder/repair claims use an atomic compare-and-swap or `FOR UPDATE SKIP LOCKED`, a unique fencing token, and an expiring lease. No visitor claims a build or reads a DB lock.
- Limit publication/repair worker requests to a 40-second processing budget and small batches with a 90-second lease; expired workers cannot publish. Live refresh uses its separate tighter request timeout/lease and next-due timing below. Confirm the deployed function budget before enabling either worker.
- Read source generation before and after reconstruction; reject changed generations. Publication performs a final transactional compare-and-swap.
- Coalesce repeated mutations. Duplicate notifications and worker requests are harmless.
- Separate published from cache-invalidated generation on the same row so a crash between them remains repairable; never introduce a separate ordinary delivery event stream.
- Retry failed work with capped exponential error backoff and jitter. After five failures, expose an operational error; retain retryable/manual repair state.
- Reuse a Supabase-scheduled dispatch for repair once per minute, querying only indexed dirty/due rows and avoiding Vercel invocations on empty ticks. The same worker entrypoint has a separately scheduled active-live mode. Configure dispatch secrets through server configuration/Vault.
- Vercel Hobby cron is daily and unsuitable for this repair loop. Supabase supports scheduled SQL and HTTP work; extension availability must be checked before rollout. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Supabase Cron](https://supabase.com/docs/guides/cron), [Database Webhooks](https://supabase.com/docs/guides/database/webhooks)

Normal API mutations should publish immediately when bounded; asynchronous ordinary snapshot recovery targets propagation within 60 seconds under healthy operation. Live refresh deadlines use the phase-aware schedule, not this minute-level recovery interval. Public withdrawal has the separate 60-second commit-to-verified-delivery target above; minute-level repair does not reset its deadline, and no success is claimed while a required purge is still pending.

Organizers receive committed state and publication status immediately. Their authorized fresh editor view does not wait for public publication and is never shared-cached.

Use the installed two-argument `revalidateTag` contract. Ordinary publication updates may use stale-while-revalidate; withdrawal/restriction/deletion requires immediate expiry and rendered-path invalidation, plus a fresh barrier only for the immediate-revocation subset. Route-handler invalidation does not itself refresh an already-open client view: mutation responses update the actor's state, and focused notifications/refetches refresh other affected views. [Next.js tag invalidation](https://nextjs.org/docs/app/api-reference/functions/revalidateTag)

## 5. Implementation phases and safeguards

Effort estimates are engineering estimates, not delivery commitments.

| Phase | Work and dependencies | Estimated effort |
| --- | --- | --- |
| 0. Baseline/security prerequisites | Measure representative journeys; inspect live schema/grants and hosting; verify organizer CHPP access; define public DTOs and command inventory, withdrawal paths/probe coverage and cache-drain bounds | 1–2 days |
| 1. Snapshot foundation | Add two tables and scoped generation/RPC triggers; extract builders; backfill current snapshots and adopt existing archives; implement withdrawal tombstones, purge verification/pending status and repair/retention metadata | 2–3 days |
| 2. Automatic replacement, before producer cutover | Extract shared CHPP reconciliation; retrofit both producers with transactional generation/lease checks; schedule automatic booking/live/result/progression work; implement read-only delivery and fenced rollback; prove cadence/continuity and stale-write rejection | 2–4 days |
| 3. Public-read cutover and historical guarantees | Cache safe snapshots; remove duplicate reconstruction; share auth/private overlays; finalize/correct history with retention; switch worker/consumers together and validate rollout | 3–5 days |
| Follow-ups | Improved Realtime presence, reusable idle timing, fully static public-history rendering if not included in the selected cutover | Separate bounded slices |

Revised first-release estimate: **8–14 engineering days including minimal automatic replacement**. This is conditional on usable existing CHPP access, Supabase scheduling and hosting capacity; static route restructuring is a separate 1–2-day estimate if required. Phase 0 must revalidate the estimate against the complete fenced-write inventory and deployed purge/probe capabilities; these requirements are not free, and a larger scope must be surfaced before implementation. A release-one worker is real additional work. Keep the legacy producer enabled until the relevant replacement slice passes; earlier cache-only work may ship on unaffected surfaces with that compatibility limitation explicitly documented.

The first enabled slice must eliminate ordinary Home/tournament reconstruction after warming. Do not ship a reduction that merely trims several queries.

Primary implementation surfaces: `src/app/_data/public-data.ts`, public App Router pages/layout, `TournamentView.tsx`, Home and tab/widget data hooks, `useAuth.ts`, and existing handlers/services under `src/server/api/`. Keep new server services under `_lib/` with explicit runtime `.js` imports; add dispatcher operations rather than standalone API routes.

### Authentication change agreed with the user

Retire legacy password-based admin access in favor of verified CHPP organizer/delegated roles.

Before cutover, verify every active organizer's access. Missing access blocks rollout; do not silently strand an organizer. Remove public password comparisons, password-storage hooks, and password-based authorization. All protected commands check current server-side role access.

Restrict sensitive team/profile/tournament columns at the database boundary as well as serialization. Replace affected browser whole-row reads with safe projections or authorized endpoints. Do not broaden this into the deferred canonical-team identity refactor.

### Migration and documentation rules

`088_public_data_publications.sql` is applied per owner report; `087_add_profile_language.sql` is preserved unchanged. `089_home_snapshot_dependencies.sql` owns Home-only source hooks/time boundaries; its owner-added marker is not live verification. Prepared `090_home_snapshot_event_dispatch.sql` reuses the existing snapshot row, pg_net, Vault and two bounded cron slots rather than adding job tables or idle Vercel polling. Committed mutations dispatch immediately, time boundaries use a replaced/removed minute-resolution wake, and fifteen-minute internal recovery queues HTTP only for due work. Dispatch failures preserve domain writes and dirty state; missed withdrawal dispatch can breach the unchanged 60-second target and must stay pending. Next active number is `091`. Recheck before further work and preserve existing markers/applied migrations exactly. Future producer selector/generation fields belong in existing tournament state and live lease fields in current match state, not a third publication table. The implemented snapshot-build fence is distinct from the still-unimplemented automatic producer fence. Home dispatch does not replace or slow existing match refresh.

Existing normalized tables remain authoritative. Do not rewrite completed fixture participant IDs, scheduling semantics, or legacy timestamp conventions. Preserve the named peak-season slot preflight/hard stops in [season-slot compatibility](../docs/season-slot-compatibility.md).

This document is the proposed durable decision record. During implementation, link it from `AGENTS.md` and `docs/architecture.md`. Update `PROJECT_STATE.md` only for actual architecture/migration/deployment status, clearly distinguishing proposed, prepared, applied, tested, and deployed.

Update CHPP standards to replace routine completed-match resynchronization with bounded pre-finalization reconciliation and explicit historical correction.

Proposed AGENTS invariant: public domain reads consume allowlisted snapshots and never initiate CHPP/domain writes after automatic producer replacement is verified; shared outputs exclude viewer/security state; finalized history and identity change only through admin-authorized audited corrections; ordinary snapshots/live observations are bounded, not append-only; explicitly public withdrawal targets 60 seconds with pending status on failure, without claiming removal of downloaded copies; fresh checks apply to private/restricted data rather than every public artifact. Automatic functionality must remain available during every rollout/rollback slice, and every producer mutation must be transactionally fenced by the current generation/lease.

## 6. Fallbacks, automatic match updates, and operational behavior

### Public fallbacks

- **Cache eviction/cold start:** fetch an existing compatible publication and cache it; no normalized reconstruction.
- **Publication failure:** retain the last successful permissible publication and show pending status where useful.
- **Missing publication:** show a controlled unavailable/pending state; authorized repair can create it. Never revive browser reconstruction.
- **Supabase outage:** already-cached explicitly public snapshots/static history continue to render without a gate. Private, authenticated, and immediate-revocation components fail closed; interactive/live layers show unavailable or last-verified timestamps. A truly cold cache still needs the durable origin, so do not promise cold outage availability without an independently hosted copy.
- **CHPP outage:** public reads remain unaffected; authorized synchronization retains last verified facts.
- **Incompatible payload version:** use a retained compatible version or controlled unavailable state; never interpret unknown contracts.
- **Historical correction:** create a new audited revision with reason, actor, expected prior revision, and atomic activation; preserve previous revisions.
- **Public withdrawal failure:** keep the durable tombstone, refuse cold re-publication, and show “Withdrawal pending” privately with retry/target-breach status. Never serve the retained audit payload as an outage fallback or claim existing downloaded copies have been erased.

Provide one authorized snapshot status/rebuild/retry operation through the existing app dispatcher/admin surface. Show source/published generations and pending failure privately; bound repair by tournament/season/component. A rebuild refreshes current snapshot delivery; it does not implicitly grant permission to correct finalized history.

### Minimal shared automatic match worker: release-one requirement

First extract the CHPP fixture/live/result reconciliation from existing handlers into a shared server service, preserving existing MatchDetails/live semantics and the current `getLivePollDelay()` behavior. Deploy a scheduler-only command behind the consolidated API with server-verified dispatch authorization; validate tournament/match eligibility rather than trusting caller-supplied match IDs. Public live GETs become read-only delivery **only at the verified worker cutover**. A public read must neither claim a refresh lease nor enqueue CHPP work.

Use current-match fields for latest observation, `next_live_refresh_at`, and an expiring fencing token, not an append-only job or feed table. The shared scheduler claims due matches once per interval, independent of viewer count. Persist meaningful score/status/events/final-result changes only; update narrow scheduling metadata as needed, but exclude fetch timestamps and unchanged content from domain invalidation. Confirmed final results run staged progression and dirty the affected season/Home snapshots once per resulting semantic change.

Schedule booking reconciliation independently of viewers at least as frequently as the current ten-minute eligible-fixture refresh, including automatic discovery of newly linked matches. During an eligible match window use the existing 4–30-second phase-aware refresh intervals. Do not substitute a one-minute cron for four-second penalties/late-game updates. Use second-level Supabase dispatch only while scheduled live windows are active; return to sparse repair/booking work outside those windows. Validate actual scheduler precision, overlapping function requests, provider latency, rate limits and costs before cutover. A match refresh timeout/lease must expire and recover within an observed bounded interval; start with a ten-second CHPP timeout and fifteen-second fenced lease, and make them configurable. Slow/failed provider requests preserve last state and show freshness; they do not manufacture completion.

Use server-side Realtime Broadcast over HTTP for changed revision hints, followed immediately by a cached read-only live-observation fetch; keep initial/reconnect fetch and bounded recovery. Public channel payloads are untrusted hints, not authoritative scores or commands, so spoofed hints cannot change match state or induce CHPP work. Coalesce/rate-limit hint-driven reads; a claimed revision is not permission to purge caches, choose an arbitrary cache key, or retry indefinitely. Expire the affected live cache before broadcasting; if delivery races invalidation, allow one bounded retry and then use the authoritative response's revision/freshness. Delivery must not stack a second four-second polling wait after a four-second authoritative refresh; compare end-to-end visible latency with the existing flow. Private-channel authorization remains fresh and isolated. Manual refresh uses the same shared claim/service and is an additional control, never the replacement for automatic updates. HTTP Broadcast avoids creating a database-backed message history for every live tick. [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

Shadow the worker's calculated updates without duplicate CHPP requests or duplicate domain writes: compare against captured responses/disposable fixtures first, then designate a single authoritative producer per test tournament. Verify booking, kickoff, clock/events, extra time, penalties, delayed final facts, APPG reconciliation and staged next-round/champion behavior. Remove browser-triggered synchronization only after that passes with several viewers, hidden tabs and no viewer. User count must not change authoritative CHPP refresh frequency.

Leaving the usual live window does not finalize a match or abandon reconciliation. Unconfirmed completion, postponement and missing final events remain pending on a bounded scheduled reconciliation path until resolved or surfaced for authorized intervention. Once publication-finalized, routine workers must refuse further historical changes.

### Producer switching and in-flight write fencing

Use one authoritative per-tournament `producer_mode` (`legacy` or `shared`) and a monotonically increasing `producer_generation`. These live with existing tournament state. The selector controls which producer may start; the generation and unique work token control which already-started work may commit. Publication source generations remain separate: they identify changed public facts, not producer ownership.

1. Before any CHPP request, the server acquires an authorized refresh context containing tournament/match scope, mode, generation, unique lease token and expiry. Legacy automatic refresh, shared refresh and manual refresh through the selected service must all capture it at work start. The browser cannot supply or upgrade that authority.
2. After external I/O, persist through a fenced database RPC/transaction. Lock the tournament producer row first, then affected match/lease rows in a consistent order; compare mode/generation, token, expiry, scope and finalization status **inside the same transaction as the writes**. Hold no database lock during CHPP calls. A preflight query followed by a separate raw Supabase update is not a fence. PostgreSQL row locks serialize the committing refresh with a switch on the same producer row. [PostgreSQL row-level locking](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
3. Apply the fence to every producer-owned effect: scores/events/status/booking, fixture warnings and story snapshots, refresh metadata, lease release/renewal, source-generation changes and length-schedule/next-round/champion progression. Guard synchronization-owned writes at the database boundary so missing/stale context cannot use an unfenced raw update or call a progression RPC directly. Separate authorized operational/manual commands must also respect that boundary; they cannot masquerade as producer work or bypass finalized-history rules. After a rejected commit, discard the CHPP result and any derived payload/notification; do not reuse it under a newly fetched generation.
4. Switch using a fresh-authorized compare-and-swap RPC with the expected current mode/generation. In one short transaction, lock that same tournament row, change mode, increment generation, revoke old work tokens/leases and make new-mode work due. A producer transaction already holding the lock may commit **before** the switch; one that reaches the lock after the switch is rejected without effects. Concurrent switch requests with stale expected generations fail rather than undoing each other.
5. Rollback executes the same operation in the opposite direction and increments generation again; never restore an earlier value or token. For example, `legacy/7 → shared/8 → legacy/9`: unfinished work from either generation 7 or 8 is invalid, even though the mode becomes legacy again. Token-conditional lease cleanup must not release a newer producer's lease.

**Deployment prerequisite:** deploy and verify the fenced mutation boundary for the legacy path before enabling the shared producer. Old deployed code without a generation/token must be unable to mutate protected synchronization fields; draining requests alone is insufficient. Retain a fence-aware legacy-compatible build for rollback, not a pre-fence binary. Audit the write inventory in `chpp/live-matches.ts`, `teams/refresh-fixtures.ts` and `length-schedule-service.ts`, including error/finally paths. No producer switch is enabled while one protected path remains unfenced.

If worker health fails during rollout, atomically select the prior automatic producer with a **new generation**, then restore its compatible consumer. Old worker writes are fenced even while its requests finish. Consumers tolerate the transition through last-verified observations and retryable responses; they do not start another producer. Keep transition gaps within the validated refresh-recovery bound. Never fall back to manual-only behavior. That compatibility rollback temporarily violates the intended read-only browsing invariant and must be reported as a rollback state, not completion.

### Presence follow-up

Chosen semantics: reachable when at least one tab is visible and the manager interacted within five minutes.

Evaluate Realtime Presence using `sync`, `join`, `leave`, `track`, and `untrack`; it is designed for slow-changing online state. [Supabase Presence](https://supabase.com/docs/guides/realtime/presence)

Aggregate tabs by verified manager identity. Hidden/idle tabs become away; disconnect and reconnect reconcile state. Because current auth is an application cookie, validate how to issue scoped Realtime authorization before implementation; browser-provided manager IDs are not proof of identity.

Persist `last_seen_at` sparsely, at most once per 15 minutes of actual activity, independently of online accuracy. Presence writes never dirty publications.

Add a reusable cancellable idle timer with configurable sequence `30, 30, 60, 90, 150, 240, 390, 600` seconds, optional jitter, and resets on interaction/new data/visibility/state changes. Keep error retries separate; never apply this increasing delay to live deadlines or presence accuracy.

## 7. Verification, measurement, rollout, and investigation validation

### Acceptance tests

- Compare anonymous and authenticated Home → tournament → current fixtures/standings → Season 1 → back navigation, including prefetch, hydration, repeated tabs, and hidden-tab behavior.
- Warm explicitly public domain reads: **zero Supabase queries and zero CHPP calls for the domain payload**, including hydration and selected-season navigation. Private/immediately revocable components may have a fresh gate; report it and interactive reads separately rather than applying it to every public page.
- Cold/evicted/redeployed/multi-instance reads load publications rather than rebuild normalized data.
- Verify every mutation family updates only affected outputs; direct SQL and RPC mutations are captured.
- Test same-generation concurrent workers, newer mutations during builds, expired leases, repeated scheduler requests, and invalidation failure after publication.
- Verify failed authoritative writes produce no publication.
- Test cross-user isolation, revoked roles, private tournaments, participant announcements, deleted news, malformed input, and anonymous access to publication internals.
- Historical identity/results remain unchanged after re-login, new-season creation, and routine sync. Corrections create a new revision.
- Preserve standings totals/order, APPG denominators/outcomes, postseason exclusion, reserve/slot behavior, fixture ordering, dates, and Season 1 navigation.
- Test delayed results, missing events, postponed games, manual outcomes, unresolved staged rounds, and incompatible contracts.
- With no organizer click, prove automatic booking detection, live score/event changes, completion and staged progression. Repeat with zero, one and many viewers; CHPP calls and DB lease work must follow due matches, not viewers. Compare worst-case observed late-game/penalty delivery latency against the existing 4–30-second behavior, including hidden-tab return and dropped Broadcast recovery.
- With the automatic replacement disabled, verify the old automatic mechanism remains enabled. Start a legacy refresh and pause its CHPP response; cut over, then release the old response: reject all old-generation writes, including warnings/progression and lease cleanup. Repeat for shared-to-legacy rollback and `legacy/7 → shared/8 → legacy/9`; generation 7 stays rejected despite the matching mode. Race a committing refresh against the switch and verify only the legal before-switch/after-switch ordering. Missing tokens, expired leases, stale switch requests and unfenced protected writes must fail. Verify one authorized automatic producer throughout and bounded transition recovery; do not mark full cutover complete while a viewer-triggered compatibility producer remains.
- Simulate Supabase outage after warming public history: fixtures/standings still render; the private/admin overlay fails closed. Test a cold miss separately and confirm the documented origin dependency.
- Warm every enabled public delivery/discovery path and configured regional probe location, withdraw, and measure commit-to-verified withdrawal against **60 seconds**, including two clean rounds five seconds apart. Test a pre-withdrawal cache fill/render finishing after the first purge, blocked invalidation, one stale regional response, failed probes and a Supabase outage mid-withdrawal. Each failure remains “Withdrawal pending”; any deadline miss shows a target-breached warning and retry, never completion. Verify no browser-driven DB gate was added to warm archives. Connected-client cleanup is best effort; saved/offline copies are explicitly outside the removal promise. Test immediate revocation separately only for its classified subset.
- Record an unfinished manual terminal outcome through operational access, then attempt to overwrite a finalized record through that same command: reject it. Test unauthorized historical correction, authorized admin correction with reason, and stale expected revision.
- Simulate many live ticks/chat/comment writes: no ordinary revision-log growth. Run pruning with an active snapshot, retired contracts inside/outside the rollback window, and initial/corrected historical revisions; preserve protected rows.

Run relevant new regression tests, the existing full suite, lint/build, and server-import checks for each enabled implementation slice. Passing compilation or mocked tests does not prove live publication/invalidation, Realtime, CHPP, or production behavior.

### Lightweight measurement

Use test-only server query/CHPP counters and browser network captures for fixed journeys. Count both HTTP requests and internal database operations where available.

Use existing Vercel cache observability plus coalesced daily snapshot aggregates: rebuild count, failure count, latency, bytes, pending age, and invalidation retries. For withdrawals, record commit-to-verified duration, target breaches, pending age and probe coverage per operation; report observed maximum/p95 where sample size supports it, without claiming untested global coverage. Measure shared scheduler invocations, CHPP calls per due match, end-to-end live latency, rejected stale producer generations, snapshot row count/bytes, historical correction growth, and retained job-run details. Do not add per-view Supabase telemetry or an unbounded per-tick log stream.

Compare promotion and quiet periods using accessible Supabase log-ingestion totals and traffic context. Promise no particular log reduction until measured.

### Rollout and rollback

Deploy additive schema and dormant compatible code first. Backfill in bounded batches; compare representative generated/manual/APPG/reserve/slot/historical outputs against captured/source facts. Enable unaffected public-read surfaces first, then a tournament with verified shared automatic production, then the wider surface. Existing automatic functionality stays active throughout.

Use flags for snapshot reads and historical enforcement plus a per-tournament automatic producer selector with transactional generation/token fencing. Deploy the fence-aware legacy path first; use the same atomic generation-advancing switch for cutover and rollback. Enable full cutover only after cache, authorization, recovery, the 60-second withdrawal target/pending UX, stale in-flight write rejection, retention and UI comparisons pass **and** the automatic replacement preserves current timing/functionality. No manual-only interim release is permitted. Keep rollback state explicit if the former automatic producer is restored.

Rollback public reads to the safe DTO-based loader behind a temporary controlled flag; keep security fixes, frozen history, and additive artifacts. This temporarily increases reads and must be observable. Never roll back to public secret-bearing rows or browser authorization. The direct-read rollback is a temporary incident mode, not the steady-state architecture; disable it again after repair.

Retain contract-versioned publications needed by the previous compatible release. Database migrations and committed domain corrections are not automatically undone by a code rollback.

### How to verify the implementation

**UI inspection:** in production-mode local/preview builds, compare Home and representative tournament layouts, current/historical tabs, direct Season 1 links, loading/error/pending states, responsive behavior, and authenticated organizer controls. Network captures must show that hydration and tab changes do not reconstruct public domain data. Dummy presentation, if needed, stays under existing Forge/testing surfaces.

**Real integration testing:** use an authorized disposable tournament and live Supabase schema to test successful/failed mutations, snapshot generations, role revocation, public withdrawal versus immediate-revocation rules, concurrent workers, scheduled repair, retention, and admin-only historical correction. CHPP refresh and live timing require authorized real teams/matches; verify automatic activity without a viewer and during worker/consumer cutover/rollback. Test warm public-history behavior during outage, cache eviction, redeployment, and regional behavior on the actual hosting environment. Production rollout and live data mutations require separate authorization.

### Investigation validation already performed

- Repository/source/framework inspection and official documentation review.
- `npm test`: **331 passed** during the planning investigation.
- `git diff --check`: passed during the planning investigation.
- Consolidated API entrypoint confirmed.
- No browser runtime traffic/log measurements, live schema inspection, Supabase execution, CHPP execution, or deployed-cache verification performed for this plan.

The 331-test result above is evidence from the original planning investigation, not a rerun for this document revision. Revision validation is document/link/consistency checking; runtime acceptance remains unverified.

## 8. Decisions and implementation prerequisites

Recommendation: proceed with the simplified current-snapshot hybrid, audited historical corrections, and a minimal automatic replacement in release one.

Confirmed product constraints:

- Public reads first must preserve automatic match updates. Include the minimal shared producer before disabling the existing mechanism; presence improvements can follow separately.
- CHPP roles only; legacy password-based admin access is retired after access verification.
- Reachable presence means at least one visible tab and interaction within five minutes.
- Ordinary public snapshots/live observations do not create an immutable version stream; original chat/comment rows are not duplicated into durable publications.
- Operational unfinished-result entry is distinct from admin-authorized correction of finalized history.
- Explicitly published public archives use cached, gate-free delivery with a measured withdrawal propagation window; genuinely private/restricted content keeps fresh authorization.
- Withdrawal targets 60 seconds from committed acceptance to verified new-delivery removal; failures/deadline misses remain visibly “Withdrawal pending.” Previously downloaded copies are outside the removal promise.
- Cutover and rollback increment a monotonic producer generation and revoke work tokens; all protected producer writes check that context transactionally, including refreshes already in flight.

The public-archive delivery-policy decision is resolved; no further approval of that tradeoff is needed to prepare the implementation. Existing confidentiality/listing semantics still require evidence before classifying a component as explicitly public. The 60-second purge target is a proposed release acceptance requirement, not measured deployed behavior.

Remaining rollout prerequisites are verified organizer access, actual confidentiality/listing semantics, live schema/grants, second-level scheduler precision, CHPP limits, hosting/cache allowances and the automatic-update continuity tests. If any prerequisite requires paid infrastructure or changes the selected product behavior, present that concrete tradeoff before changing the plan. The user's continuation authorizes local implementation of this plan; live migration application, deployment, production data mutations and additional public routes remain separately gated. Current local persistence work does not satisfy the public-read, withdrawal-delivery or automatic-update cutover acceptance tests.
