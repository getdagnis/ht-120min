# Tournament collections

Collections are persistent identities above tournaments. `tournament_collections` owns the slug, title, description, banner URL, publication flag, homepage group and order. `tournament_collection_memberships` links a collection to a persistent `tournaments.id`, with one row per pair and collection-specific featured flag/order. Membership is independent of Home's `tournaments.is_featured` and survives new `tournament_seasons` rows.

## Public contract

The Home directory builder reads published collection metadata and memberships in two bounded queries, then joins them to its already built public tournament summaries in memory. The collection page and tournament return links read that same Home payload. Nonpublic/test/archived/stopped tournaments and unpublished collections are omitted. Shared publication contains only public ordering; joined-team and eligibility preferences can later be applied per viewer after the shared read. No public browsing path calls CHPP.

During rollout, a cached contract-1 Home payload may have the older explicit `exoticHfiTournaments` list but no `collections` field. The read adapter temporarily projects only the known campaign slugs into the Exotic collection, removes those cards from the general catalogue, and uses the same banner. A fresh publication with `collections` replaces this compatibility path; it does not create membership rows or alter the migration backfill.

The collection page places collection-featured members in **Featured tournaments** first, then lists **all** current members by status, including those highlighted above. Current rounds with unfinished matches = In progress; no rounds plus open/waiting status and registration still open = Registration open; other unstarted members = Upcoming; paused tournaments = Inactive; finished status or fully completed current matches = Completed. Empty groups are hidden. Completed members remain accessible through their existing tournament URL and season selector. The Home section takes up to eight members, ranking in-progress first by activity, then all non-ongoing members by public readiness: at least one current participant, a custom picture, the combination of picture plus visible description plus a news article (excluding generated round reports), then most recent public edit. Exact ties use collection display order and stable identity. Collection-specific featured flags do not change that Home selection.

The current public tournament model has no distinct draft status. Public unstarted tournaments outside open registration appear under Upcoming; private/test tournaments remain excluded.

Migration [099](../migrations/099_collection_homepage_groups.sql) adds nullable `homepage_group` to `tournament_collections` and assigns `exotic-hfi` to `concept-120min`. Home renders that as **Concept 120 min Tournaments**, with the Exotic banner beneath the heading. The other allowed groups are **Virtual Concept Tournaments** (`virtual-concept`) and **Hop-On Hop-Off Tournaments** (`hop-on-hop-off`). They remain hidden until a published collection is explicitly assigned. Bone Crashers and APPG based tournaments are prospective members of those groups; this migration creates no new collections or tournament memberships and does not infer grouping from scoring mode. An unassigned published collection appears under **Collections** so it remains discoverable. Old Home publications without the new field keep the known Exotic collection under Concept during rollout.

Collection and Home cards share the same public summary display: current team count, season/current round, start or planned date, and up to the first 20 words of the tournament description (with `...` when shortened) when `show_description` is enabled. The snapshot retains up to 600 characters; truncation is presentation-only. Ongoing cards sort by descending season number, completed rounds, current teams and start/planned date. Non-ongoing cards use the readiness order above within their collection-page status group and in Home's general lists. The Home publication builder reads descriptions in its existing bounded tournament query and reads news presence and edit times in bounded batches. Migration [098](../migrations/098_publish_home_tournament_descriptions.sql) adds the missing description dirty hook; editing or hiding a displayed description must lead to a new published Home snapshot. Migration [100](../migrations/100_tournament_modification_time.sql) adds `tournaments.updated_at` for public-edit ordering. It backfills existing rows from `created_at`, since historical edit times are unavailable, and advances on edits to public tournament fields already covered by the Home dirty triggers. Before 100 is applied, readers use `created_at` for the final tie-break.

The separate Featured Tournaments Home section uses the existing global `tournaments.is_featured` flag, including tournaments that belong to collections. It is an independent spotlight: those cards also remain in the collection's eight Home cards or the appropriate general catalogue section, and in the collection's full status list. Collection-specific `is_featured` selects the additional featured group on the collection page; it does not alter the Home eight or a member's status group.

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

1. Confirm the owner-marked-applied 097 collection rows, membership IDs/slugs and public eligibility in Supabase. Do not edit its applied marker. Apply 098, 099 and then 100 after the existing numbered migrations; they add the description publication hook, homepage group column and public edit time, then dirty `home:directory`. None of these migrations was applied here.
2. If `PUBLIC_HOME_SNAPSHOT_ENABLED` is on, disable it for the rollout so the new app uses direct public reads while the old payload lacks `collections` or descriptions. Deploy the matching code. The direct builder requires 097 first.
3. Ensure the Home worker/approval/dispatch setup is active as described in [public data rollout](public-data-implementation.md). After the new worker code is deployed, dirty `home:directory` again as service role with `SELECT public.mark_public_snapshot_dirty('home:directory', 1);`, run the existing protected Home refresh, and verify the published payload contains `collections`, source and published generations match, and cache invalidation completes. Re-enable the Home snapshot flag only then.
4. Inspect `/en/collection/exotic-hfi` for a featured group before status groups, and Home for the Concept heading above the Exotic banner. Check member tournament return links and admin changes in a fresh session, a second locale and a narrow viewport. Live Supabase, worker scheduling, cache propagation, browser behavior and production function counts remain owner verification.

No production database connection, migration execution or deployment was performed for this change.
