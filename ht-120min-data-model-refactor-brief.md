# HT-120min Data Model Refactor — Architecture Brief

## 1. Purpose

This document captures the conclusions of the recent investigation into HT-120min's manager, team, tournament, season, slot, standings and sandbox data model.

It is intentionally an **architecture brief, not an implementation recipe**.

Use your own reasoning. Inspect the repository and current database state before making changes. If code or live schema contradicts this document, surface the contradiction and explain it rather than forcing an assumption.

The main goal is to replace the current overloaded `teams` model with a clean separation between:

- manager identity;
- canonical team identity;
- tournament-season participation;
- season slots;
- slot occupancy history;
- fixtures/results;
- live standings/statistics;
- immutable historical records;
- sandbox/test data.

---

## 2. What the investigation found

The current architecture is a hybrid produced by several generations of implementation.

The biggest problem is that the `teams` table currently represents too many unrelated concepts at once.

A single row can currently contain or imply:

- a real Hattrick team identity;
- tournament membership;
- manager identity;
- OAuth credentials;
- active/inactive participation;
- season reapplication state;
- replacement lineage;
- Matchmaker/general-team identity;
- public Hattrick metadata.

This is the root problem.

The database is not merely "messy because it has duplicate rows". The duplicates are a symptom of an incorrect domain boundary.

---

## 3. `profiles` is already close to the correct manager layer

`profiles` should not be treated as display-only data.

Current server code already uses it as manager-level Hattrick identity and CHPP credential storage.

It contains concepts such as:

- `hattrick_user_id`;
- manager name;
- country;
- avatar;
- CHPP/OAuth credentials;
- last CHPP sync;
- `teams_json` containing the manager's known Hattrick teams.

This is broadly the correct place to anchor the **canonical manager/account**.

The name `profiles` can remain if changing it adds no value.

The important concept is:

    one Hattrick manager = one canonical manager/profile record

---

## 4. The current `teams` table is conceptually wrong

A real Hattrick team exists independently of HT-120min tournaments.

A tournament does not own a team.

A season does not create a new version of a team.

A team becoming inactive in a tournament does not make the team itself inactive.

The current table violates those boundaries because it contains fields such as:

- `tournament_id`;
- `active`;
- `replacement_for_team_id`;
- `reapply_season_number`;
- manager fields;
- OAuth fields;
- participation state.

Those concepts must eventually move out of canonical team identity.

---

## 5. Duplicate team rows are migration evidence, not garbage

The supplied production-style export shows the same real Hattrick team appearing in several `teams` rows.

The duplication generally corresponds to things such as:

- the same team appearing in different tournaments;
- historical tournament instances;
- a general/Matchmaker row plus tournament-specific rows;
- test/sandbox tournament participation.

Do **not** begin this refactor by deleting or merging rows manually.

Those legacy rows may still be referenced by:

- fixtures;
- completed matches;
- season history;
- replacement chains;
- Matchmaker;
- slot assignments;
- reports;
- comments/news;
- other foreign keys.

They are source data for a controlled migration.

---

## 6. `ht_team_id` is the canonical Hattrick team identifier

The schema currently contains both:

- `ht_team_id`
- `hattrick_team_id`

In the supplied team export, `ht_team_id` is the populated/current field while `hattrick_team_id` appears to be legacy and unused.

The intended future identity should therefore be:

    teams.ht_team_id = globally unique Hattrick team ID

Do not remove `hattrick_team_id` until repository usage has been verified, but treat it as a likely legacy field.

Also note that migration history contains an attempt to make `ht_team_id` globally unique, while the supplied live-style data contains duplicates. Therefore migration history and actual DB state have diverged at some point. The implementation must trust the real schema/data state over assumptions from old migration filenames.

---

## 7. Correct top-level relationship

The desired domain model is:

    Manager
       │ owns
       ▼
    Canonical Team
       │ registers for
       ▼
    Tournament Season Registration
       │ occupies
       ▼
    Tournament Season Slot
       │ has occupancy history through
       ▼
    Slot Assignment
       │
       ├── fixtures/results
       ├── live slot standings
       └── frozen season history

This relationship is the core architectural decision.

---

## 8. Managers and credentials

A manager is a real Hattrick account.

Target concept:

    profiles
    ────────────────────────
    hattrick_user_id PK
    manager_name
    country_id
    country_name
    avatar_json
    created_at
    updated_at
    last_seen_at
    chpp_synced_at

CHPP/OAuth credentials should be manager-scoped, not copied onto tournament/team-participation rows.

A cleaner final form may be:

    manager_chpp_credentials
    ────────────────────────
    hattrick_user_id PK/FK → profiles
    oauth_token
    oauth_token_secret
    oauth_scope
    updated_at
    last_verified_at

Whether credentials remain temporarily on `profiles` or move to a private credentials table is an implementation decision.

The invariant is:

    credentials belong to the manager/account level

not to a tournament participation row.

---

## 9. Manager → team ownership

A manager may own multiple teams.

This must be a first-class model.

A canonical team should therefore contain something like:

    manager_id → profiles.hattrick_user_id

`manager_id` may be nullable because a team can be discovered through public CHPP data before its owner has authenticated with HT-120min.

When the real owner later authenticates, the existing canonical team should be linked to that manager rather than duplicated.

`profiles.teams_json` can remain useful as a CHPP snapshot/cache and migration aid, but it should not be the only relational representation of ownership.

---

## 10. Canonical teams

The future production `teams` table should mean one thing:

> one real Hattrick team.

Conceptually:

    teams
    ────────────────────────
    id UUID PK
    ht_team_id BIGINT UNIQUE NOT NULL
    manager_id BIGINT NULL FK → profiles.hattrick_user_id

    name
    logo_url

    country_id
    country_name

    league_id
    league metadata as needed

    gender_id

    arena metadata as needed
    fanclub metadata as needed

    created_at
    updated_at
    chpp_synced_at

This table stores current public identity/metadata.

It should not store tournament participation state.

---

## 11. What should eventually leave canonical `teams`

The following concepts do not belong on the final canonical team row:

    tournament_id
    active
    replacement_for_team_id
    reapply_season_number
    joined_via_oauth
    oauth_token
    oauth_token_secret

They may remain temporarily for compatibility during migration.

Do not drop them before all callers have been moved.

---

## 12. Tournaments and seasons

A tournament is the enduring competition identity.

A tournament season is one edition of that competition.

Desired relationship:

    tournaments
        │
        │ 1 → many
        ▼
    tournament_seasons

Example:

    Queens of the Pacific Cup
        ├── Season 1
        └── Season 2

New seasons should not create new canonical team rows.

Historical competitions that were already created as separate tournament records do not need to be aggressively merged during this refactor. Preserve history first.

---

## 13. Tournament-season registration

Registration answers:

> Is this canonical team participating in this particular season?

It is a relationship between a team and a tournament season.

Suggested concept:

    tournament_season_registrations
    ───────────────────────────────
    id UUID PK
    tournament_season_id FK
    team_id FK

    status
    registered_at
    withdrawn_at
    registration_source
    registered_by_manager_id
    created_at
    updated_at

    UNIQUE (tournament_season_id, team_id)

Possible registration states/sources can be refined by the implementation, but the important point is:

**registration is not team identity and registration is not the schedule slot itself.**

---

## 14. Season slots: the egg-box model

Generated tournament schedules contain stable physical competition positions.

Think of them as an egg box:

    [1] [2] [3] [4] [5] [6]

Teams occupy those positions.

If a team leaves, the slot remains.

If another team replaces it, the new team occupies the same slot.

The slot belongs to the tournament season, not to the team.

Suggested concept:

    tournament_season_slots
    ───────────────────────
    id UUID PK
    tournament_season_id FK
    slot_index INTEGER
    created_at

    UNIQUE (tournament_season_id, slot_index)

A new season gets new slots.

Slots are never reused between seasons.

---

## 15. Slot assignments: occupancy history

A slot assignment records which team occupied a slot during a period.

Suggested concept:

    tournament_season_slot_assignments
    ──────────────────────────────────
    id UUID PK
    slot_id FK
    team_id FK

    assigned_at
    released_at
    reason/source

    frozen_team_name
    frozen_ht_team_id
    frozen_manager_id
    frozen_manager_name
    frozen_logo_url
    other intentionally frozen public metadata

`released_at IS NULL` represents the current occupant.

The model must guarantee:

- at most one current assignment per slot;
- a team cannot occupy two slots in the same season;
- assignment history is preserved rather than overwritten.

Replacement should therefore mean:

    release old assignment
    create new assignment

not:

    create another team identity
    point it at replacement_for_team_id

---

## 16. Fixtures, historical truth and future fixtures

Fixtures need to distinguish:

1. the competition position involved;
2. the actual team that played.

The slot model introduced in the recent FFC → Zermatt compatibility work is the correct conceptual direction.

A completed fixture must remain historically true.

Example:

    Round 1:
    FFC vs Team A

If Zermatt later replaces FFC in that slot, Round 1 must still show FFC.

Future incomplete fixtures should resolve to Zermatt as the new occupant.

Therefore:

    competition position = slot
    historical participant = assignment/team that actually played

The recently introduced slot/assignment fields and frozen identity snapshots should be treated as a compatibility prototype for the final architecture, not discarded casually.

---

## 17. Live standings and statistics belong to the slot

This is a central product decision.

During a season, standings represent the competition position.

If FFC earns results in slot 4 and Zermatt later takes over slot 4:

    slot 4 keeps the accumulated competition results

while completed fixtures remain attached to the teams that actually played them.

Conceptually:

    matches/results
          ↓
    aggregate by season slot
          ↓
    live standings
          ↓
    display current slot occupant

Examples of slot-derived statistics include:

- played;
- wins/draws/losses;
- goals;
- points;
- 120-minute statistics;
- APPG values;
- competition-specific scoring metrics.

Do not move those statistics onto canonical `teams`.

At season finish, freeze the final historical result.

---

## 18. Leaving, replacing, rejoining and new seasons

These actions should operate on participation and slot relationships.

### Leave

Do not deactivate the canonical team.

Instead:

    registration → withdrawn
    current slot assignment → released

### Replace

Do not create a new identity.

Instead:

    existing slot remains
    old assignment ends
    incoming canonical team receives new assignment
    future fixtures follow incoming assignment
    completed fixtures remain unchanged

### Rejoin / revive

Interpret the real domain operation:

- reactivate/create registration;
- claim a vacant slot when appropriate;
- create a new-season registration.

Do not model "revive" as `teams.active = true`.

### New season

The canonical team persists.

Create:

    new season
    new registration
    new slots when the schedule is generated
    new slot assignments

Do not clone the team.

---

## 19. Sandbox/test architecture

The current sandbox design intentionally reused production-like tables so tests behaved closely to real tournaments.

That was useful for behavioral parity but wrong for canonical identity.

The future rule should be:

> same application/domain behavior, separate data.

Sandbox must not create or mutate production canonical identities, ownership, registrations, achievements or credentials.

A sandbox may use real public CHPP metadata, for example:

    Guåhan Goddesses
    source_ht_team_id = 3220518
    real team name
    real logo
    real league/country metadata

but internally it should be a disposable sandbox participant snapshot.

It must not mean:

    production canonical team 3220518 joined another real tournament

Possible isolation approaches include:

1. separate sandbox Supabase/database;
2. separate PostgreSQL schema;
3. dedicated sandbox tables in the same DB.

Choose the implementation that best fits the current project, but avoid continuing the current model where test participation creates normal production `teams` rows and correctness depends on scattered `is_test` filters.

Sandbox expiry/deletion is **not part of this refactor**.

The existing seven-day expiry concept can remain unimplemented for now.

The priority is data isolation.

---

## 20. What must be preserved and where the refactor should end

### Preserve

The refactor must preserve all meaningful live and historical data, including:

- Hattrick manager IDs;
- Hattrick team IDs;
- current manager/team ownership where known;
- CHPP authentication;
- tournament IDs/slugs/settings;
- tournament seasons;
- current schedules;
- linked Hattrick match IDs;
- completed results;
- match event details;
- APPG and 120-minute data;
- season reports/history;
- yearbook/comments/news where relevant;
- Matchmaker relationships;
- the recent slot compatibility behavior;
- the successful FFC → Zermatt replacement semantics;
- historical fixture truth.

### Do not treat duplicate legacy rows as disposable

The legacy database should be treated as migration source material.

Several old rows may map to:

    one canonical team
        +
    several tournament-season registrations
        +
    several historical slot assignments

### Desired end state

After the refactor, these statements should all be true:

    one real Hattrick manager
    = one canonical profile

    one real Hattrick team
    = one canonical production team

    one manager
    may own many canonical teams

    a tournament never owns or clones a team

    a team joins a season through a registration

    a generated season contains stable slots

    a team occupies a slot through an assignment

    replacement changes slot occupancy, not team identity

    live standings belong to the slot

    completed fixtures preserve the team that actually played

    future fixtures follow the slot's current occupant

    finished seasons preserve immutable historical truth

    Matchmaker references the same canonical team identity

    sandbox exercises equivalent competition behavior
    without contaminating production identities

This is the target architecture.

Use your own reasoning to determine the safest migration path from the current hybrid system to this model.
