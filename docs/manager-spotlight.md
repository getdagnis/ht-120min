# Manager Spotlight data and story contract

## Sources and refresh

Manager and team identity comes from the authenticated CHPP `managercompendium` and one manager-wide `teamdetails` v3.9 response with `teamID` omitted. The responses are joined by Hattrick team ID. Login refresh and `POST /api/app?route=refresh-spotlight-profiles` (available in tournament Site admin tools) persist the result. The route requires a valid app session (or the configured superadmin bypass), then checks `canManageOperations`; this permits the original organizer, co-organizer, tournament admin, or implicit superadmin. Press officers and unassigned participants are denied. The refresh is scoped to active, non-reserve, non-placeholder managers in the selected tournament and is limited to 50 profiles per call. Successful profile refreshes invalidate the selected tournament and other active tournaments linked to the refreshed managers' current clubs.

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

Only fields actually present in CHPP are written; the sample omits unknown values for readability. The manager role array contains `{ staffType, nationalTeamId, nationalTeamName, isU21 }` objects. No CHPP OAuth or private account fields are copied into either public story model.

## Rank semantics

`TeamRank` is CHPP's league ranking. In regular Hattrick leagues, the league is the country, so prose can say `ranked #N in {country}`. The five special leagues are separate from their clubs' countries: a club may be based in Costa Rica while ranked `#N in HFI`. The Spotlight resolves the rank label through `shared/worlddetails.ts`, keeping club location and rank scope distinct. If the regular league scope is missing, the fallback is generic `league rank #N`. `PowerRating.LeagueRanking` is a different ranking and is never substituted. Rank zero and missing ranks are omitted.

## Trophy normalization

Mappings use the local CHPP `trophyID`, `CupLevel`, and `CupLevelIndex` documentation in `docs/chpp datatypes.html` and `docs/teamdetails.schema.xml`:

- `16`: cup; `CupLevel=1` with `CupLeagueLevel=0` is National Cup, `2` challenger, `3` consolation.
- `17`: series title; `18`: league title.
- `78/79/80`: World Cup gold/silver/bronze; `91`: Hattrick Masters win; `93`: Masters top scorer.
- `103`: tournament winner; `203`: tutorial tournament.

The engine currently gives story weight to World Cup medals, Masters wins, National/Challenger/Consolation cups, league titles, and counts of at least five series titles. Individual series titles and generic tournament wins remain represented in the stored summary but do not produce achievement copy. Top scorer and tutorial trophies also remain summary-only. Unknown IDs are preserved as `other`, not described as a specific win.

## Candidate selection and display

Candidates are deterministic and contain typed text/country segments. The story selects an exceptional manager role when available, the actual tournament club, the CHPP primary club, and at most one supporting fact. Regular club rank sentences name the league country with its controlled flag. Special-league sentences state the club country separately from the special-league rank. The main club includes its stored region and country when known. Supporting facts are ordered by major achievement, at least five ordinary series titles, other-club countries, then youth for a sparse profile. Rank and founding year belong in the relevant club sentences; ordinary series titles below five and minor tournament trophies do not receive a separate story sentence. Optional ties use a stable hash of manager ID, UTC date key, and candidate ID. Stories normally have three sentences, with four reserved for a strong supporting achievement after an exceptional role. The hard maximum is four.

The current-club snapshot stays complete for selection. The visible club area shows the tournament club and CHPP primary club only, or one row carrying both labels when they are the same team. The primary row also shows its founded year when known. Other clubs appear only through a country-only supporting sentence, excluding the tournament and primary clubs and their already shown countries. International and special-league short labels come from `shared/worlddetails.ts`; a positive special-league `TeamRank` is labeled with that league, not the club's country.

Country mentions are typed segments independent of flag lookup. The renderer uses the existing Hattrick-controlled flag image URL when available and a neutral, controlled flag-shaped placeholder otherwise; a flag mapping failure never removes known country text from prose or club rows. The story and team rows use separate helpers so text never contains HTML.
