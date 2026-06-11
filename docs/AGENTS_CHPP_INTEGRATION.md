# Hattrick CHPP Integration: The Definitive Guide

This document is the absolute source of truth for Hattrick API integration in the HT-120min project. It replaces all previous "creative interpretations" with facts derived from the official CHPP documentation.

## 1. Time & Timezones (The "Swedish Time" Rule)

- **Standard**: Hattrick uses **Central European Time (CET)** or **Central European Summer Time (CEST)**, also known as `CE(ST)`.
- **Offset**:
  - Winter: UTC+1 (CET)
  - Summer: UTC+2 (CEST)
- **Application**: Every timestamp in the API (e.g., `<MatchDate>`, `<FinishedDate>`, `<FetchedDate>`) is in Swedish Time. All application logic comparing "now" to match times must convert the local system time to Swedish Time before comparison.

## 2. Friendly Match Types & Tournament Policy

The tournament allows both Normal and Cup rules friendlies. A fixture is **Arranged** if a match exists with the correct partner on the target date, regardless of the subtype.

- **Allowed Match Types (`MatchTypeID`)**:
  - `4`: Friendly (normal rules) - Maximum 90 minutes.
  - `5`: Friendly (cup rules) - Can go to 120 minutes + penalties.
  - `8`: International friendly (normal rules).
  - `9`: International friendly (cup rules).
- **Policy**: If teams book a Normal rules match (`4` or `8`), it is **NOT** misarranged. We record the result and minutes (which will be capped at 90 + stoppage time).

## 3. The Weekly Cycle (The "Thursday 6 AM" Rule)

- **Reset Point**: The Hattrick engine refreshes the friendly match pool for the next week on **Thursday at 06:00 Hattrick Time**.
- **Refreshes**: Attempting to "Refresh Fixtures" for a future round before this time is a waste of resources, as the API will not return matches for the next week until the reset occurs.
- **Guam Schedule**: Matches are typically played on Wednesday 04:15 Hattrick Time.

## 4. Match Result Data Points

To correctly calculate scores and the "120min" bonus, we use the following from `matchdetails.example.xml`:

- **Match Status**: `<MatchStatus>2</MatchStatus>` indicates the match is finished.
- **Extra Time Detection**: If `<MatchPart>` 3 or 4 is present in the `<Scorers>` or `<Bookings>` (or specifically indicates the final part of the match), the base time is **120 minutes**. Otherwise, it is **90 minutes**.
- **Added Minutes**: The `<AddedMinutes>` tag in `matchdetails` represents the official compensation (stoppage) time added to the final part of the match.
- **Total Minutes Formula**: `(Base Minutes [90 or 120]) + AddedMinutes`.

## 5. API Response Metadata & Error Handling

Every CHPP XML response is wrapped in a `<HattrickData>` container.

### Common Output Tags

| Tag             | Description                                                                           |
| :-------------- | :------------------------------------------------------------------------------------ |
| `<FileName>`    | The requested CHPP file name.                                                         |
| `<Version>`     | API version delivered.                                                                |
| `<UserID>`      | The UserID of the authenticated manager (not TeamID). Defaults to 0 if not logged on. |
| `<FetchedDate>` | Timestamp of the fetch (always in **Swedish Time**).                                  |

### Error Codes

If an error occurs, CHPP returns an XML result with an error code instead of the requested data.

- **0**: Not logged in
- **1**: Access Denied
- **6**: Only for Supporters
- **10**: Invalid parameter
- **50/51/56**: Unknown TeamID / MatchID / PlayerID
- **90**: Hattrick is down for maintenance

*Note: For a full list of codes, see the internal documentation or official CHPP guide.*

### Testing Supporter Features

To test logic that behaves differently for Hattrick Supporters, append `overrideIsSupporter=X` to your URL:

- `X=-1`: Off
- `X=0`: Silver
- `X=1`: Gold
- `X=2`: Platinum
- `X=3`: Diamond
*(Note: This does not work for the `teamdetails` file).*

## 6. Maximum Integration: The /docs Knowledge Base

For 100% accurate integration, agents must consult the following files in the `/docs` directory.

### Core Reference & Discovery

- **`# CHPP Files help.md`**: A quick index of all available CHPP interfaces and their brief descriptions.
- **`chpp datatypes.html`**: **The Type Bible**. Verify `MatchTypeID`, `MatchStatus`, `MatchPart`, and `MatchRuleID` here.
- **`global-match-times.json`**: Comprehensive list of league and friendly match times per country. Crucial for scheduling automation.

### XML Schema Snapshots (The Ground Truth)

The directory contains `{name}.schema.xml` (structure) and `{name}.example.xml` (data snapshot) pairs. Use them to write and test your parsers.

| Snapshot | Context | Crucial Relevance for HT-120min |
| :--- | :--- | :--- |
| **`training`** | Training Report | **Vital.** Contains actual training minutes. Since the tournament is built around the "120min" training bonus, this is the ultimate verification of a match's impact. |
| **`matchdetails`** | Match Results | Provides `<AddedMinutes>` and `<MatchPart>` to detect Extra Time. Primary source for score and base minute recording. |
| **`matchlineup`** | Match Lineup | **Vital.** Shows who started, substituted, and at what minute. Essential for calculating individual player minutes. |
| **`matches`** | Fixture List | Used for automated fixture detection. Filter for `MatchTypeID` 4, 5, 8, or 9. |
| **`teamdetails`** | Team Metadata | Definitive `TeamID`, `LogoURL`, and `CountryName` (used for localized time). |
| **`live`** | Live Polling | Real-time standings updates. Observe `<EventKey>` 599 for "Match Finished". See `docs/match-event-types.md` for more event types. |
| **`players`** | Player List | Master list of players. Crucial for mapping `MatchID` events to specific team members. |
| **`trainingevents`** | Training Events | Tracks specific player improvements during update cycles. |
| **`playerevents`** | Player Match Events | Specific events (goals, cards, injuries) tied to individual players. |
| **`matchesarchive`** | Historical Matches | Retrieve results for past seasons or missed refreshes. |
| **`matchorders`** | Tactical Orders | Contains match orders; useful for validating "arranged" status. |
| **`managercompendium`** | Manager Info | Metadata and multi-team ownership details. |
| **`playerdetails`** | Detailed Player Info | Extended stats for a single player. |
| **`transfersteam`** | Team Transfers | History of players bought/sold. |
| **`match-event-types`** | Event Definitions | Enumeration of all possible match event IDs. |

## 6. Best Practices for Max Integration

### A. Defensive Parsing

Hattrick XML can be inconsistent (e.g., `LogoURL` vs `LogoUri`). Always check the `.schema.xml` files to see naming variations and use defensive parsing logic that handles both.

### B. Validation over Assumption

If you are implementing a feature that depends on match results, cross-reference `chpp datatypes.html` to ensure you are handling all relevant `MatchTypeID` values (4, 5, 8, 9).

### C. The "Hattrick Time" Conversion

All integration tools MUST include a utility to convert system time to Swedish Time before making scheduling decisions. Use the `Intl.DateTimeFormat` with `timeZone: 'Europe/Stockholm'` as the gold standard for this conversion.

### D. Thursday Reset Logic

Any automation for fixture detection MUST respect the Thursday 06:00 Swedish Time reset. Refreshes attempted before this window for future rounds are technically impossible and should be blocked to save resources.
