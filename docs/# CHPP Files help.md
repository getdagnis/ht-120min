# CHPP Files Help

> **Important**
>
> As a CHPP developer you may only access the interfaces documented here. Do not build products that depend on any other part of the site. Violating the CHPP rules can put your team at risk.

This file is a quick index of the CHPP interfaces that are relevant to the project.

## User and Account Data

- `achievements` - The achievements of a specific user.
- `avatars` - Avatars for all players of the user's team.
- `bookmarks` - User bookmarks.
- `economy` - Economy.
- `fans` - Fan club information.
- `managercompendium` - The manager compendium of the logged-in user. `1.0` (`2013-12-10`) `{default}`
- `supporters` - Information about teams supported and teams supporting. `1.0` (`2013-12-16`) `{default}`

## Team and Club Data

- `club` - Information about specialists and youth.
- `currentbids` - Shows the current transfer activity for a team.
- `teamdetails` - Team information. `1.9` `{default}`
- `regiondetails` - Detailed information about a region.
- `staffavatars` - Avatars for all staff members. `1.0` (`2014-04-03`) `{default}`
- `stafflist` - A list of all staff members. `1.0` (`2014-04-03`) `{default}`
- `worlddetails` - General information about all countries in HT World.
- `worldlanguages` - Available languages.

## Matches and Fixtures

- `challenges` - Very important. Friendly booking management
- `cupmatches` - Information about cup matches.
- `live` - Get the live match ticker. `1.3` `{default}`
- `matches` - The most recent and upcoming matches for a particular team, senior or youth. `2.3` `{default}`
- `matchesarchive` - Match archive.
- `matchdetails` - Detailed match information. `1.5` `{default}`
- `matchlineup` - Match lineup for finished matches.
- `matchorders` - Match orders for upcoming matches. `1.3` `{default}`

## Leagues and Competitions

- `alliances` - Alliance and federation search.
- `alliancedetails` - Alliance and federation information.
- `challenges` - Challenges.
- `ladderdetails` - Information about teams in the ladder and positions in it. `1.0` (`2013-11-20`) `{default}`
- `ladderlist` - Information about the ladder that the user is currently playing in. `1.0` (`2013-11-08`) `{default}`
- `leaguedetails` - Information about a league level unit (series).
- `leaguefixtures` - Fixtures for a league level unit (series).
- `leaguelevels` - Shows league level unit (series) information for a specific league. `1.0` (`2024-08-26`) `{default}`
- `nationalteams` - National teams. `1.2`
- `nationalteamdetails` - National team information. `1.2`
- `nationalteammatches` - National team matches.
- `nationalplayers` - National team players.
- `tournamentdetails` - Information about a tournament. Available only for the current season. `1.0` (`2013-10-17`) `{default}`
- `tournamentfixtures` - Information about matches for a tournament. Available only for the current season. For non-restarted tournaments, available for 2 seasons after the tournament finished. `1.0` (`2013-10-17`) `{default}`
- `tournamentleaguetables` - League tables for a tournament. Available only for the current season. For non-restarted tournaments, available for 2 seasons after the tournament finished. `1.0` (`2013-10-17`) `{default}`
- `tournamentlist` - Information about tournaments that the user is currently playing in. `1.0` (`2013-10-17`) `{default}`
- `worldcup` - World Cup groups and matches.

## Players and Training

- `hofplayers` - Hall of Fame players.
- `players` - Players. `1.4` `{default}`
- `playerdetails` - Detailed information for a player.
- `playerevents` - Player events.
- `training` - Training. `1.3` `{default}`
- `trainingevents` - Get training events for a player.

## Transfers and Market

- `transfersearch` - Search the transfer market. This file is not meant to be fetched by bots to automatically scan the transfer market, but instead on manual user request. `1.0` (`2013-12-12`) `{default}`
- `transfersteam` - Get the transfer history of a team. `{default}`
- `transfersplayer` - Get all transfers of a player.

## Youth

- `youthavatars` - Avatars for all players of the user's youth team.
- `youthleaguedetails` - The youth league information. `1.0` (`2013-12-02`) `{default}`
- `youthleaguefixtures` - Fixtures for a youth league (series). `1.0` (`2013-12-02`) `{default}`
- `youthplayerdetails` - Detailed information for a youth player. `1.0` (`2011-11-15`) `{default}`
- `youthplayerlist` - Youth players. `1.0` (`2011-11-15`) `{default}`
- `youthteamdetails` - Youth team information.

## Data Feeds

- `translations` - Translations for the denominations in the game. This file is not meant to be fetched on each user session, but instead periodically, for example once a week, and stored in the app. `1.0` (`2013-11-27`) `{default}`
