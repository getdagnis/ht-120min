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

`TeamRank` is CHPP's league-rank value. `PowerRating.LeagueRanking` is a different Power Rating ranking. The Spotlight never substitutes one for the other. A positive `TeamRank` can be described as `league rank #N`; it is not labeled as a country rank because CHPP's TeamRank schema does not establish a country-only scope. HFI `TeamRank` is suppressed in both story and team rows until a separately established HFI-specific rank source exists. Rank zero and missing ranks are omitted.

## Trophy normalization

Mappings use the local CHPP `trophyID`, `CupLevel`, and `CupLevelIndex` documentation in `docs/chpp datatypes.html` and `docs/teamdetails.schema.xml`:

- `16`: cup; `CupLevel=1` with `CupLeagueLevel=0` is National Cup, `2` challenger, `3` consolation.
- `17`: series title; `18`: league title.
- `78/79/80`: World Cup gold/silver/bronze; `91`: Hattrick Masters win; `93`: Masters top scorer.
- `103`: tournament winner; `203`: tutorial tournament.

The engine currently gives story weight to World Cup medals, Masters wins, National/Challenger/Consolation cups, league/series titles, and tournament wins. Top scorer and tutorial trophies remain represented in the stored summary but do not produce achievement copy. Unknown IDs are preserved as `other`, not described as a specific win.

## Candidate selection

Candidates are deterministic and contain typed text/country segments. Selection orders P0 exceptional identity, mandatory P1 tournament participant, P2 primary club, P3 major achievements/notable rank, P4 history/footprint, and P5 youth/arena/fanclub colour. Footprint candidates can identify an all-different country spread, one home club plus a foreign cluster, or clubs sharing a country/region. Same-team duplicate ranks/history/footprints are filtered. Optional ties use a stable hash of manager ID, UTC date key, and candidate ID. The normal target is three sentences, with a four-sentence hard maximum. Only selected facts are passed to the widget.

Country mentions are typed segments independent of flag lookup. The renderer uses the existing Hattrick-controlled flag image URL when available and a neutral, controlled flag-shaped placeholder otherwise; a flag mapping failure never removes known country text from prose or club rows. The story and team rows use separate helpers so text never contains HTML.
