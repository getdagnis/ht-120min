# Manager Spotlight data and story contract

## Sources and refresh

Manager and team identity comes from the authenticated CHPP `managercompendium` and one manager-wide `teamdetails` v3.9 response with `teamID` omitted. The responses are joined by Hattrick team ID. Login refresh and `POST /api/app?route=refresh-spotlight-profiles` (available through the tournament's Update manager snapshots button) persist the result. The route requires a valid app session (or the configured superadmin bypass), then checks `canManageOperations`; this permits the original organizer, co-organizer, tournament admin, or implicit superadmin. Press officers and unassigned participants are denied. The refresh is scoped to active, non-reserve, non-placeholder managers in the selected tournament. It rejects more than 25 distinct eligible managers before any CHPP request, capping one manual action at 50 potential CHPP calls. Successful profile refreshes invalidate the selected tournament and other active tournaments linked to the refreshed managers' current clubs.

`profiles.teams_json` remains an array containing the manager's current owned-team snapshots. `profiles.national_team_roles_json` stores manager-level staff roles separately. Public rendering reads those persisted profile snapshots and tournament participant relations; it does not call CHPP. The manager profile table remains the canonical source for this Spotlight read model.

Official Hattrick roles are derived from the nickname prefixes `HT-`, `GM-`, `Mod-`, and `LA-`; they are not persisted. Teamdetails national-team staff type values normalize as `0=coach`, `1=assistant`, and `2=scout`. U21 is derived from `/^U21\b/i` on the national-team name. Duplicate role records are removed by `(type, nationalTeamId)`.

## Persisted shape

A `profiles.teams_json` entry retains its existing `teamId` / `teamName` identity and may contain:

```json
{
  "teamId": 3220504,
  "teamName": "'Nduje Amaranto",
  "isPrimaryClub": false,
  "foundedDate": "2026-03-16 17:49:00",
  "countryId": 179,
  "countryName": "Guam",
  "regionName": "Hagåtña",
  "leagueId": 3000,
  "leagueName": "HFI",
  "leagueSystemId": 1,
  "leagueLevel": 6,
  "leagueLevelUnitId": 12345,
  "leagueLevelUnitName": "VI.976",
  "teamRank": 1229,
  "numberOfVictories": 4,
  "homeFlagLeagueIds": [4, 154],
  "awayFlagLeagueIds": [3, 174],
  "powerRating": 888,
  "powerGlobalRank": 40,
  "powerLeagueRank": 7,
  "powerRegionRank": 2,
  "youthTeamName": "Youth Club",
  "arenaId": 12345,
  "arenaName": "Example Arena",
  "fanclubSize": 2579,
  "logoUrl": "https://res.hattrick.org/teamlogo/...png",
  "trophies": [
    { "typeId": 16, "kind": "national_cup", "season": 88, "cupLeagueLevel": 0, "cupLevel": 1 }
  ]
}
```

Most optional fields are written only when available; the sample omits unknown values for readability. The three new streak/flag fields always have `null` or empty-array defaults when absent. The manager role array contains `{ staffType, nationalTeamId, nationalTeamName, isU21 }` objects. No CHPP OAuth or private account fields are copied into either public story model.

`numberOfVictories` is a point-in-time winning-streak count: a positive CHPP value is stored, while a missing, empty, or zero value becomes `null` and clears any older count. Home and away flag LeagueIDs remain separate, deduplicated ascending arrays; a missing collection becomes `[]`. They are not converted to CountryIDs during refresh. These three fields are team-level snapshot data. The story selector reads them from the persisted snapshot without a public CHPP request.

For collected flags, CHPP's `Flag.LeagueID` names a **country-backed Hattrick league**. It reflects the country visited, not the league system in which the match was played. An HFI club can collect another country's flag by visiting an HFI club based there. Special league IDs such as `3000` (HFI) and `1003` (Homegrown) are not destinations or collectible country flags. Keep CHPP's LeagueID in the snapshot and resolve it through `shared/worlddetails.ts` when presenting or counting country flags; do not infer flag geography from the visiting club's `leagueId`.

## Rank semantics

`TeamRank` is CHPP's league ranking. In regular Hattrick leagues, the league is the country, so prose can say `ranked #N in {country}`. The five special leagues are separate from their clubs' countries: a club may be based in Costa Rica while ranked `#N in HFI`. The Spotlight resolves the rank label through `shared/worlddetails.ts`, keeping club location and rank scope distinct. If the regular league scope is missing, the fallback is generic `league rank #N`. `PowerRating.LeagueRanking` is a different ranking and is never substituted. Rank zero and missing ranks are omitted.

## Trophy normalization

Mappings use the local CHPP `trophyID`, `CupLevel`, and `CupLevelIndex` documentation in `docs/chpp datatypes.html` and `docs/teamdetails.schema.xml`:

- `16`: cup; `CupLevel=1` with `CupLeagueLevel=0` is National Cup, `2` challenger, `3` consolation.
- `17`: series title; `18`: league title.
- `78/79/80`: World Cup gold/silver/bronze; `91`: Hattrick Masters win; `93`: Masters top scorer.
- `103`: tournament winner; `203`: tutorial tournament.

The engine gives story weight to World Cup medals, Masters wins, National/Challenger/Consolation cups, league titles, and series titles starting with one. Generic tournament wins remain represented in the stored summary but do not produce achievement copy. Top scorer and tutorial trophies also remain summary-only. Unknown IDs are preserved as `other`, not described as a specific win.

## Candidate selection and display

Candidates are deterministic and contain typed text, emphasized-entity, and country segments. The tournament club is always introduced. A distinct main club normally supplies the next club-context sentence. When it is the tournament club, it is not reintroduced; the most useful other-club context can take that space. A stronger fact from a third club can replace routine main-club context, keeping prose to two named clubs. One club-facts candidate gathers each current club's strongest trophy, Power Rating value, winning streak of at least three, series titles starting with one, and substantial flag collection. Up to four distinct facts fit in that candidate; the fifth or later fact yields to the shorter profile. A National Cup win receives lead wording as a major Hattrick honour. Selected club facts sit immediately after that club's introduction in the same rendered paragraph, while the story retains its four-sentence ceiling and may be shorter for sparse profiles. An exceptional manager role can leave room for only the stronger of two clubs' fact sentences. Three wording families for tournament and main-club introductions are chosen by manager ID and UTC date; they change phrasing without changing facts. Optional ties use a stable hash of manager ID, UTC date key, and candidate ID. TeamRank and Power Rating league rank remain separate measures; story Power Rating facts use the rating value. Flag counts combine home and away flags for one club, map only country-backed LeagueIDs through `shared/worlddetails.ts`, and count each country once.

The visible club area shows every current club from the canonical snapshot, oldest known founding date first and unknown dates last. The tournament and CHPP primary clubs retain distinct labels when they differ; a shared club row shows only the participating-club heading. The participating-club label uses the tournament's persisted name and country restriction. Every row shows its founding year when known. Other clubs may also inform one concise country-only supporting sentence, excluding the tournament and primary clubs and their already mentioned countries. International and special-league short labels come from `shared/worlddetails.ts`; a positive special-league `TeamRank` is labeled with that league, not the club's country.

Story sentences are authored with a typed `story` template tag. `strong()` marks manager, club, and region names; country segments retain flag metadata and receive the same emphasis in story rendering. The renderer uses semantic `<strong>` markup at weight 600 and the existing Hattrick-controlled flag image URL when available, with a neutral flag-shaped placeholder otherwise. A flag mapping failure never removes known country text from prose or club rows. A nonbreaking space keeps each country name with its flag. The generator contains no JSX or HTML.
