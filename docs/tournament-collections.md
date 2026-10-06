# Tournament collections

Collections are persistent identities above tournaments. `tournament_collections` owns the slug, title, description, banner URL, publication flag and order. `tournament_collection_memberships` links a collection to a persistent `tournaments.id`, with one row per pair and collection-specific featured flag/order. Membership is independent of Home's `tournaments.is_featured` and survives new `tournament_seasons` rows.

## Public contract

The Home directory builder reads published collection metadata and memberships in two bounded queries, then joins them to its already built public tournament summaries in memory. The collection page and tournament return links read that same Home payload. Nonpublic/test/archived/stopped tournaments and unpublished collections are omitted. Shared publication contains only public ordering; joined-team and eligibility preferences can later be applied per viewer after the shared read. No public browsing path calls CHPP.

During rollout, a cached contract-1 Home payload may have the older explicit `exoticHfiTournaments` list but no `collections` field. The read adapter temporarily projects only the known campaign slugs into the Exotic collection, removes those cards from the general catalogue, and uses the same banner. A fresh publication with `collections` replaces this compatibility path; it does not create membership rows or alter the migration backfill.

The public group mapping is: no rounds plus open/waiting status and registration still open = Registration open; current rounds with unfinished matches = In progress; other unstarted members = Upcoming; finished status or fully completed current matches = Completed. Empty groups are hidden. Completed members remain accessible through their existing tournament URL and season selector. The Home section uses explicit featured membership order first, then fills to eight with registration-open, in-progress, upcoming and completed members in stable collection order.

Admin controls live in Tournament Settings. An authorized operational tournament admin may assign/remove membership, feature that tournament within a collection and set its collection order. Metadata is seeded by migration for this launch; there is no generic metadata editor yet. Server actions check the existing signed session/legacy organizer password and tournament operational role before service-role writes. Source-table triggers dirty the existing `home:directory` publication; a collection unpublish or membership deletion also closes old origin admission until a replacement build. The existing Home worker and cache invalidation remain responsible for publishing the replacement.

## Initial Exotic Small HFI Series

Migration [097](../migrations/097_tournament_collections.sql) creates `exotic-hfi` with `/series/exotic-tiny-hfi-banner.jpg`. It assigns the following exact slugs in this order, only when the row already exists and is public, not a test, and not archived/stopped:

1. `queens-of-the-pacific-cup`
2. `exotic-hfi-san-marino`
3. `exotic-hfi-saint-kitts-and-nevis`
4. `exotic-hfi-tahiti`
5. `exotic-hfi-faroe-islands`
6. `exotic-hfi-gibraltar`
7. `exotic-hfi-bhutan`
8. `exotic-hfi-curacao`
9. `exotic-hfi-barbados`
10. `exotic-hfi-sao-tome-e-principe`
11. `exotic-hfi-liechtenstein`
12. `exotic-hfi-saint-vincent-and-the-grenadines`
13. `exotic-hfi-malta`
14. `exotic-hfi-andorra`
15. `exotic-hfi-bahamas`
16. `exotic-hfi-madagascar`
17. `exotic-hfi-maldives`
18. `exotic-hfi-cabo-verde`
19. `exotic-hfi-suriname`
20. `exotic-hfi-brunei`
21. `exotic-hfi-comoros`
22. `exotic-hfi-trinidad-tobago`

The first eight are initially featured. If any campaign tournament does not exist when 097 is applied, the migration skips it; add it later through Tournament Settings after confirming it is a real public tournament. The migration does not create tournament rows or seasons.

## Owner publication steps

1. Inspect and apply 097 after the existing numbered migrations. Do not edit applied migration markers. Confirm the seeded collection and exact membership IDs/slugs, and check that no test/private row was assigned.
2. If `PUBLIC_HOME_SNAPSHOT_ENABLED` is on, disable it for the rollout so the new app uses direct public reads after 097 while the old payload lacks `collections`. Deploy the matching code. The direct builder also requires 097 first.
3. Ensure the Home worker/approval/dispatch setup is active as described in [public data rollout](public-data-implementation.md). After the new worker code is deployed, dirty `home:directory` again as service role with `SELECT public.mark_public_snapshot_dirty('home:directory', 1);`, run the existing protected Home refresh, and verify the published payload contains `collections`, source and published generations match, and cache invalidation completes. Re-enable the Home snapshot flag only then.
4. Inspect `/en/collection/exotic-hfi`, Home, member tournament return links and admin changes in a fresh session. Check a second locale and a narrow viewport. Live Supabase, worker scheduling, cache propagation, browser behavior and production function counts remain owner verification.

No production database connection, migration execution or deployment was performed for this change.
