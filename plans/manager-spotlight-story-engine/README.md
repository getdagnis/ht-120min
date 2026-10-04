# Manager Spotlight story engine

Reference logic for the next HT-120min Manager Spotlight iteration.

Files:

- `manager-spotlight-story-engine.ts` — framework-agnostic TypeScript reference implementation.
- `manager-spotlight-story-engine.test.ts` — behavioral examples / implementation tests.

## Core editorial model

The engine is not a "manager summary" generator. It ranks eligible factual story candidates and spends a 3–4 sentence budget on the strongest combination.

Priority:

1. **P0 exceptional identity** — Hattrick official role and/or national-team role.
2. **P1 tournament relevance** — always identify the participating club.
3. **P2 primary/main club identity** — keep the registered main club visible.
4. **P3 achievements / notable rank** — major trophies and ranks <= 100.
5. **P4 history / footprint** — longevity and multi-club geography.
6. **P5 colour/fallback** — youth side, large fanclub, arena, etc.

The selector is deterministic. Optional same-priority facts use `managerId + spotlightDateKey` as a stable tie-breaker.

## Important implementation notes

- This is reference code, not necessarily drop-in code. Adapt types/imports to the repo.
- Public rendering must remain snapshot-only; no CHPP fetches inside this engine.
- Use `teamdetails.User.NationalTeams` as canonical national-team staff data.
- `NationalTeamStaffType`: `0 coach`, `1 assistant`, `2 scout`.
- Reserved nickname prefixes: `HT-`, `GM-`, `Mod-`, `LA-`.
- `TeamRank` is the ordinary CHPP league rank; do not confuse it with PowerRating league rank.
- Prefer small CDN flag images in React. Do not embed OS emoji flags into story strings.
- The story should not enumerate every club/country when the rows underneath already do that.
- Do not infer personality or meaning from names.

## Suggested integration shape

Normalize CHPP data during authenticated/admin refresh:

    managercompendium + teamdetails
      -> normalized manager/team snapshot
      -> profiles/team storage
      -> buildManagerStory(snapshot)
      -> public snapshot
      -> React widget

Keep parsing, normalization, story selection, and rendering separate.
