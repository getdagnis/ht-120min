# CHPP API Usage Audit (Authoritative Source Verification)

This document presents a comprehensive audit of all Hattrick / CHPP integrations in the codebase. The goal is to verify that every piece of Hattrick-derived data is obtained from the most authoritative, reliable, and intended CHPP interface available.

---

## 1. Executive Summary & Key Findings

Our systematic review of the codebase reveals that while the application successfully integrates with Hattrick's CHPP API, several critical areas rely on convenient or secondary data sources rather than canonical, authoritative endpoints. 

### Key Issues Identified:
1. **Availability & Booking Detection (Critical):** The codebase relies on `TeamDetails` (specifically `friendlyTeamId` and `possibleToChallengeMidweek` / `possibleToChallengeWeekend`) to infer matchmaker availability. This is highly fragile compared to querying the dedicated `matches` or `matchesarchive` endpoints, or using the official `challenge` API.
2. **Country & League Mapping (High):** There are multiple places where country names are used as identifiers or mapped loosely, rather than relying strictly on Hattrick's canonical `CountryId` or `LeagueId`.
3. **Caching & Staleness (Medium):** There is no unified caching layer with explicit TTLs for CHPP responses, leading to potential rate-limiting issues or stale data when users query team details or arena details.

---

## 2. Integration Audit Tables

### Manager Data

| Feature | Manager Profile & Teams |
| :--- | :--- |
| **UI Location** | Login / Registration, User Profile |
| **Current Endpoint** | `managercompendium` (via `parseManagerCompendiumXml`) |
| **Current Field** | `Loginname`, `UserId` / `UserID`, `CountryId`, `CountryName`, `Avatar` |
| **Better Endpoint Exists?** | No for general overview, but `managerdetails` is more authoritative for supporter status and youth details. |
| **Recommended Source** | `managercompendium` for initial login/team list; `managerdetails` if supporter status or youth info is needed. |
| **Risk Level** | Low |
| **Notes** | The current parser handles both `<UserId>` and `<UserID>` tags gracefully. |

---

### Team Data

| Feature | Team Details & Eligibility |
| :--- | :--- |
| **UI Location** | Tournament Join, Matchmaker Team Selection |
| **Current Endpoint** | `teamdetails` (via `parseTeamDetailsXml`) |
| **Current Field** | `TeamID`, `TeamName`, `CountryName`, `LogoURL`, `GenderID`, `ArenaID`, `FriendlyTeamID` |
| **Better Endpoint Exists?** | Yes, for league/series details, `leaguedetails` is more authoritative. |
| **Recommended Source** | `teamdetails` for basic team metadata; `leaguedetails` for precise division hierarchy. |
| **Risk Level** | Medium |
| **Notes** | Gender and league category checks are performed on `ChppTeamOption` fields. Ensure `GenderID` is always parsed as an integer. |

---

### Arena Data

| Feature | Arena Details |
| :--- | :--- |
| **UI Location** | Matchmaker / Venue Information |
| **Current Endpoint** | `arenadetails` (via `parseArenaDetailsXml`) |
| **Current Field** | `ArenaID`, `ArenaName`, `Capacity`, `ArenaImageURL` |
| **Better Endpoint Exists?** | No |
| **Recommended Source** | `arenadetails` |
| **Risk Level** | Low |
| **Notes** | Arena details are fetched on-demand. Risk of stale cache if arena capacity or name changes. |

---

### Matchmaker Availability & Booking Detection

| Feature | Matchmaker Availability & Booking |
| :--- | :--- |
| **UI Location** | Matchmaker Dashboard |
| **Current Endpoint** | `teamdetails` & `matches` |
| **Current Field** | `friendlyTeamId`, `possibleToChallengeMidweek`, `possibleToChallengeWeekend`, `MatchDate`, `MatchType`, `Status` |
| **Better Endpoint Exists?** | Yes |
| **Recommended Source** | Dedicated `matches` endpoint for upcoming fixtures, combined with the `challenge` endpoint options. |
| **Risk Level** | Critical |
| **Notes** | Inferring availability from `friendlyTeamId` or `possibleToChallenge` flags in `teamdetails` is prone to race conditions and does not account for pending challenges or temporary booking locks. |

---

### Country & League Data Mapping

| Feature | Country & League Verification |
| :--- | :--- |
| **UI Location** | Tournament Restrictions, Team Eligibility |
| **Current Endpoint** | Parsed from `teamdetails` or `managercompendium` |
| **Current Field** | `CountryName`, `LeagueName` |
| **Better Endpoint Exists?** | Yes |
| **Recommended Source** | `worlddetails` (for canonical Country ID -> Country Name mapping) |
| **Risk Level** | High |
| **Notes** | The codebase occasionally matches or filters by `countryName` string. This is vulnerable to localization changes. We must transition to strict `CountryId` and `LeagueId` matching. |

---

## 3. Prioritized Findings List

### [Critical] Matchmaker Availability & Booking Detection
* **Description:** Availability is inferred from `teamdetails` flags and active match lists. This can lead to false positives where a team is marked available but already has a booked friendly or pending challenge.
* **Complexity:** High
* **Risk:** High
* **Confidence:** High
* **Recommendation:** Query the `matches` endpoint directly for the target week to verify if a friendly match type is already scheduled.

### [High] Country Name String Matching
* **Description:** Several eligibility checks and filters compare `countryName` strings directly.
* **Complexity:** Medium
* **Risk:** Medium
* **Confidence:** High
* **Recommendation:** Refactor `validateTeamEligibility` and tournament filters to use Hattrick's canonical `CountryId` instead of localized names.

### [Medium] Lack of Unified Caching & Refresh Strategy
* **Description:** CHPP data (like Arena details and Team details) is fetched on-demand without a standardized caching layer, risking rate limits.
* **Complexity:** Medium
* **Risk:** Low
* **Confidence:** High
* **Recommendation:** Implement a Redis or Supabase-backed cache layer with explicit TTLs (e.g., 24 hours for Arena/Team details, 15 minutes for Match status).

---

## 4. Recommended Migration Plan

1. **Phase 1 (Data Integrity):** Replace all string-based country and league name checks with ID-based checks using `CountryId` and `LeagueId`.
2. **Phase 2 (Matchmaker Robustness):** Refactor `classifyTeamAvailability` to rely on the dedicated `matches` endpoint to confirm the absence of scheduled friendly matches.
3. **Phase 3 (Caching Layer):** Introduce a standardized caching decorator for all CHPP API proxy requests to prevent redundant hits to Hattrick's servers.
