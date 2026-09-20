# Exotic small HFI leagues bootstrap

The one-off campaign seed creates the 20 missing `exotic-hfi-*` tournaments and presents them with the existing Guam tournament (`queens-of-the-pacific-cup`) in a dedicated homepage section.

## Country restriction format

Campaign rows use CHPP `CountryID` values, while some older tournament rows use
the older `LeagueID` representation. Those numeric namespaces overlap, so they
cannot be reliably distinguished from `country_limit` alone. Before releasing
the campaign cards, apply migration `20260920152428_add_country_limit_format.sql`.
It marks Queens and the 20 campaign slugs as `country_id` without guessing or
rewriting any unrelated historical restrictions. New normal tournament rows
with a country restriction now persist the same explicit marker.

## Safe operation

Run the read-only review first:

```bash
npm run seed:exotic-hfi -- --dry-run
```

It requires `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) from the normal server-side environment. It reads Queens to inherit the real organizer and prints each target's CountryID, LeagueID, flag, name, slug, description, organizer, existing state, and CREATE/SKIP result. It performs no writes.

Review that Queens is skipped, the organizer is correct, all 20 current CountryID restrictions are correct, and every new row has the exact expected slug. The command deliberately never prints `admin_password` values.

Only after that review, apply missing rows:

```bash
npm run seed:exotic-hfi -- --apply
```

The apply command generates a per-tournament `nanoid(8)` admin password exactly like the browser create flow, stores it only in the database, and does not log it. It is idempotent by exact slug: reruns skip campaign rows already present and never create `-2` variants or update existing descriptions.

After apply, inspect at least `exotic-hfi-saint-kitts-and-nevis`: it must be HFI, Hattrick Validated (CHPP), 120min, public/open, CountryID-limited, unlimited, have no teams, show a focused description, and be managed by the inherited Queens organizer.
