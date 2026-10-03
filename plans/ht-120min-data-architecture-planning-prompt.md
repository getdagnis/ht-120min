# HT-120min — public data architecture: investigation and technical plan

You are working in the HT-120min repository. Investigate the current implementation and produce a concrete technical plan for redesigning data reads, caching, publication, and synchronization. **Plan only: do not implement application changes, apply migrations, or deploy.** Save the plan in the repository's established documentation location.

Read AGENTS.md and relevant architecture/decision documentation first. Verify the installed framework version, deployment environment, existing cache behavior, schema, and actual read/write paths. Use current official documentation when verifying version-specific cache semantics. Do not assume a particular Next.js caching API works as remembered.

## Why we are doing this

HT-120min is primarily a tournament publication product with a small live layer. Most public information changes infrequently; historical information should be immutable by default. The current concern is that ordinary page visits repeatedly reconstruct largely unchanged information from Supabase.

Supabase log ingestion rose during tournament promotion and increased browsing/signups. There were only three tournament matches that week and probably one live viewer. Pausing activity tracking did not materially reduce the observed spikes. Earlier explanations repeatedly over-attributed usage to analytics or live polling. **Treat the cause of the observed log volume as unproven.** Repository inspection can establish request amplification, but cannot establish the actual distribution of ingested log bytes without runtime evidence.

We want to fix the architectural mismatch regardless: public traffic should mostly consume published data, rather than multiply database reconstruction work by visitor count. We currently have around 60 active users and want capacity for roughly 100 times that number without proportional DB queries or CHPP synchronization.

## Core philosophy and required invariants

**Supabase owns authoritative data. Public reads consume cached projections of that data. Query frequency follows meaningful data changes, not page renders.**

- Default public domain reads to indefinitely cached or published data. Justify each freshness exception with an actual mutation path or live UX requirement.
- Use mutation-driven invalidation/publication as the primary mechanism. A blanket five-minute TTL is not the target architecture.
- Public reads must not trigger CHPP synchronization, identity refresh, historical repairs, or other domain writes. A bounded internal cache fill on a miss is a separate operation; explicitly describe when it is allowed.
- Isolate live and personalized information from the public cached shell. Chat or login state must not force the entire tournament dataset to be reconstructed.
- Freeze historical facts. Current identity refresh must not rewrite historical team/manager snapshots.
- Authentication, authorization, private messages, secrets, access revocation, and permission checks remain appropriately fresh. Never treat security-sensitive state as immutable public metadata.
- Keep existing product behavior and design. Historical season navigation, including Season 1 fixtures and standings, already exists; preserve it.

Here, “team/manager credentials” means **public identity metadata** such as names, logos, avatars, countries, and league information. It does not mean OAuth tokens, session credentials, or authorization.

## Desired freshness rules

| Data | Required behavior |
|---|---|
| Finished seasons | Immutable by default; explicit admin correction only |
| Finalized fixtures, results, events, historical standings | Published/frozen once; explicit admin correction only |
| Historical team and manager snapshots | Preserve identity as recorded for that historical context |
| Current team/manager identity metadata | Refresh from CHPP only on manager re-login or explicit admin refresh |
| Tournament metadata | Cached until authorized mutation |
| Participants and assignments | Cached until join/leave/assignment/admin mutation |
| Schedule and current fixtures | Cached until scheduling, booking, result, or lifecycle mutation |
| Announcements/news | Cached public projection; invalidate on publish/edit/delete |
| Chat/comments | Separate interactive layer; define initial-read caching and live updates per UX need |
| Online presence/live match state | Dedicated live handling |
| Auth/private user data | Separate request/user-scoped handling with correct authorization |

Define “finalized” precisely. Do not freeze an incomplete fixture just because kickoff has passed. Account for delayed results, missing events, postponed matches, and reconciliation before publication. An admin correction should produce a new historical snapshot revision and invalidate the affected outputs without enabling routine background historical refresh.

## Investigation required

Map representative anonymous and authenticated journeys: Home, tournament overview, current fixtures/standings, historical fixtures/standings, and navigation between them. Include SSR, hydration, client fetches, prefetch, subscriptions, timers, and hidden-tab behavior.

Inspect and verify these previously reported suspects rather than repeating them as facts:

- Public `force-dynamic` routes and repeated multi-query tournament reconstruction.
- Duplicate `useAuth()` consumers fetching profile/tournament data independently.
- Client refetches/subscriptions recreating data already provided by the server.
- Per-viewer live polling performing identical DB/CHPP work and unchanged writes.
- Presence reads/writes, activity telemetry, and unnecessary identity enrichment.

For every important dataset, identify its current readers, mutation entry points, synchronization jobs, security boundary, cache scope, and invalidation dependencies. Include admin tools, cron jobs, RPCs, direct DB changes, and external callbacks. Cite actual files/functions. Label measured counts, static estimates, and unknowns separately.

## Architecture options to evaluate

Recommend the simplest architecture that satisfies these invariants on our actual deployment. Compare a small number of viable options; do not assume a new paid service is necessary.

1. Framework-managed cached public loaders and prerendered/server-rendered routes, with explicit mutation invalidation.
2. Durable, versioned tournament/season public snapshots, published atomically after relevant changes, with cached delivery.
3. A staged hybrid: cache existing loaders first, then introduce durable projections where they materially improve reliability or historical publication.

Static HTML is the ideal outcome for historical views when practical. It is not a requirement to invent an HTML export pipeline if framework prerendering plus persistent published snapshots achieves the same useful behavior. Explain the differences between React request memoization, server data cache, full-route cache, CDN cache, browser cache, and durable snapshots. A DB snapshot still queried on every view reduces fan-out but does not eliminate per-view database requests.

Consider focused projections for tournament shell, season fixtures/standings, identity, and news instead of a single oversized snapshot containing all chat/activity. Define schema, cache keys, dependency tags or revision identifiers, selected-season routing, and payload limits. Include schema/deployment version compatibility.

For normal warm historical reads, target **zero Supabase reconstruction queries and zero CHPP calls**, including after hydration. Identify the expected behavior across cold starts, redeploys, cache eviction, multiple server instances, and concurrent requests. Local memory alone must not be described as durable or globally shared caching.

## Correctness and safeguards

- Publish only after successful authoritative mutations. Never mark a failed write as published.
- Prevent partially built snapshots from becoming visible; use atomic publication/version switching where needed.
- Prevent stale rebuilds from overwriting newer revisions. Explain concurrency, single-flight/deduplication, and retry behavior across instances.
- Handle the failure window between DB commit and invalidation/publication. Evaluate an outbox, revision check, bounded repair job, or simpler equivalent against actual complexity and traffic.
- Give each mutation an explicit dependency/invalidation mapping, including identity refresh and admin historical corrections. Avoid invalidating every tournament for one small change.
- Preserve read-your-write UX for organizers/admins while public rebuilds complete. Explain how users see pending publication or obtain a fresh authorized view.
- Separate public projections from private data at the source. Never cache tokens, service-role data, private profiles, organizer-only warnings, or user-specific permissions in shared outputs. Test cross-user isolation.
- Keep immutable historical identity separate from mutable current identity. Plan how existing history can be snapshotted when original identity is unavailable; never invent past values.
- Do not silently change standings calculations, APPG behavior, season selection, fixture ordering, or historical navigation.
- Provide an explicit admin rebuild/repair path with appropriate authorization, revision visibility, and bounded operational effort.

## Live state and adaptive timing

Live-match refresh should eventually perform one shared authoritative refresh per match/tournament interval, with clients reading the shared result. Persist meaningful changes only. Explain deduplication, locks/leases, expiry, and failures without replacing DB amplification with another heavily polled DB lock.

Presence must answer “can I reach this person in chat now?” Separate ephemeral online presence from sparse persisted `last_seen_at`. Evaluate existing Realtime Presence before designing DB heartbeats. Account for multiple tabs, disconnects, background tabs, idle users, and reconnects; agree on the semantics before choosing intervals.

Propose a reusable adaptive/Fibonacci timing helper where suitable: `30, 30, 60, 90, 150, 240, 390, 600` seconds, capped, configurable, cancellable, with optional jitter. Define resets on meaningful interaction, new data, visibility, or state changes. Distinguish idle polling from error retries. Do not apply increasing delays to live deadlines or presence accuracy requirements indiscriminately. Treat this and live polling as scoped follow-up work if including them would delay the main public-read redesign.

## Fallbacks and rollout

Describe controlled behavior for a cache miss, missing historical snapshot, publication failure, Supabase/CHPP outage, or incompatible snapshot version. Prefer the last successfully published public snapshot with clear freshness/pending status when appropriate. Do not return stale authorization or accidentally expose deleted/restricted content; define hard invalidation for those cases.

Any temporary direct-read fallback must be bounded, observable, deduplicated where possible, and removable. It must not silently restore reconstruction on every request. Public fallback reads must still never trigger external synchronization.

Plan incremental rollout with feature flags, backfill, representative shadow comparisons, and rollback. Preserve normalized tables as truth. Avoid destructive migrations. Explain cache/schema compatibility during deployment and what a rollback can and cannot safely undo. Identify practical hosting/cache limits and costs before proposing additional infrastructure.

## Required plan output

Produce a concise but complete technical plan with:

1. Verified current architecture and evidence; separate unknown runtime usage attribution.
2. Data freshness/ownership matrix and proposed component/read-model boundaries.
3. Recommended architecture, alternatives, tradeoffs, and actual deployment compatibility.
4. Read/write/publication flows, invalidation dependency matrix, and failure/concurrency handling.
5. Phased implementation tasks referencing real files, schema changes, dependencies, effort, and decisions requiring my input.
6. Meaningful verification and acceptance criteria: compare cold/warm query counts, hydration traffic, authenticated isolation, mutation propagation, historical immutability, concurrent rebuilds, failure recovery, and preservation of existing UI behavior.
7. A lightweight measurement plan: DB/API/CHPP calls per journey, rebuild frequency, cache hit rate, and log-ingestion trend if accessible. Avoid creating another high-volume per-event telemetry system. Do not promise a particular log reduction without measurements.
8. Rollout/rollback strategy, open risks, and a proposed durable architecture/AGENTS decision record so future agents preserve these invariants.

The first implementation phase should yield a meaningful reduction in ordinary public reads, not merely reduce thirteen reconstruction queries to nine. Keep the plan proportionate to a small product, while making growth and correctness explicit. Challenge implementation assumptions and suggest better mechanisms where warranted; preserve the product's freshness and historical immutability requirements.

Finish with your recommendation and the few decisions genuinely needed before implementation. Do not start implementing the plan.
