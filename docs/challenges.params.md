# CHPP `challenges` Parameters

This document summarizes the inputs and output shape for the CHPP `challenges` file.

Only the inputs listed here are available in this file version.

## File Metadata

- `required file`: `challenges`
- `optional version`: `1.6`
- `optional actionType`: `view` by default

## Action Types

### `view`

Returns data about:

- challenges you have made
- offers you have received

### `challengeable`

Checks whether the specified teams can be challenged.

- Requires the `manage_challenges` scope
- Uses `suggestedTeamIds`

### `challenge`

Creates a friendly challenge for another team.

- Requires the `manage_challenges` scope
- Can create a challenge even if the site would normally block it, as long as the required extended permission exists

### `accept`

Accepts a challenge from another team.

- Requires the `manage_challenges` scope

### `decline`

Declines a challenge from another team.

- Requires the `manage_challenges` scope

### `withdraw`

Withdraws a challenge that has not yet been accepted.

- Requires the `manage_challenges` scope

## Parameters

| Parameter | Required | Type | Default | Used With | Notes |
| --- | --- | --- | --- | --- | --- |
| `suggestedTeamIds` | No | `String` | - | `challengeable` | Comma-separated list of team IDs to check. |
| `opponentTeamId` | Yes | `unsigned Integer` | - | `challenge` | Team ID of the opponent you want to challenge. |
| `matchType` | No | `unsigned Integer` | `0` | `challenge` | `0` = normal friendly, `1` = friendly with cup rules. |
| `matchPlace` | No | `unsigned Integer` | `0` | `challenge` | `0` = home, `1` = away, `2` = neutral arena. |
| `neutralArenaId` | No | `unsigned Integer` | `0` | `challenge` | Arena ID used when `matchPlace = 2`. |
| `trainingMatchId` | No | `unsigned Integer` | - | `accept`, `decline`, `withdraw` | ID of the friendly offer to act on. |
| `teamId` | No | `unsigned Integer` | Your primary club senior team ID | all actions | Team to manage challenges for. Must be a senior team managed by the requesting user. |
| `isWeekendFriendly` | No | `unsigned Integer` | `0` | all actions | Controls weekend friendly handling. |

## Constraints

- If `matchPlace = 2`, `neutralArenaId` must be set.
- `teamId` defaults to the requesting user's primary club senior team ID.
- `isWeekendFriendly` defaults to `0`.

## Output

The output depends on the selected `actionType`.

### `view` output

The XML response is rooted at `HattrickData` and contains these sections:

#### `Team`

| Field | Description |
| --- | --- |
| `TeamID` | Globally unique national team ID. |
| `TeamName` | Team name. |

#### `ChallengesByMe`

| Field | Description |
| --- | --- |
| `Challenge.TrainingMatchID` | Globally unique challenge or offer ID. |
| `Challenge.MatchTime` | Match start time. |
| `Challenge.MatchID` | Match ID created for an accepted challenge. |
| `Challenge.FriendlyType` | Type of friendly. |
| `Challenge.IsAgreed` | Whether the challenge has been accepted and the match arranged. |

`Challenge` also contains these nested objects:

| Object | Field | Description |
| --- | --- | --- |
| `Opponent` | `TeamID` | Globally unique national team ID. |
| `Opponent` | `TeamName` | Team name. |
| `Opponent` | `LogoURL` | Opponent logo URL, if available. |
| `Arena` | `ArenaID` | Globally unique arena ID. |
| `Arena` | `ArenaName` | Arena name. |
| `Country` | `CountryID` | Globally unique country ID. |
| `Country` | `CountryName` | Country name. |

#### `OffersByOthers`

| Field | Description |
| --- | --- |
| `Offer.TrainingMatchID` | Globally unique challenge or offer ID. |
| `Offer.MatchTime` | Match start time. |
| `Offer.MatchID` | Match ID created for an accepted challenge. |
| `Offer.FriendlyType` | Type of friendly. |
| `Offer.IsAgreed` | Whether the challenge has been accepted and the match arranged. |

`Offer` also contains these nested objects:

| Object | Field | Description |
| --- | --- | --- |
| `Opponent` | `TeamID` | Globally unique national team ID. |
| `Opponent` | `TeamName` | Team name. |
| `Opponent` | `LogoURL` | Opponent logo URL, if available. |
| `Arena` | `ArenaID` | Globally unique arena ID. |
| `Arena` | `ArenaName` | Arena name. |
| `League` | `LeagueID` | Globally unique league ID. |
| `League` | `LeagueName` | League name. |

## Notes

- `FriendlyType` values are defined by the official CHPP friendly type table.
- The `view` response is the normal read path for showing challenges and offers.
