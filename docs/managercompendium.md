# HattrickData

Hattrick Data Container
-Manager
Container wrapping the info about the manager
UserId : unsigned Integer
The globally unique UserID.
Loginname : String
The 'username' or 'nickname' used in Forums and around the site.
SupporterTier : String
The current level of Hattrick Supporter that the user has. Empty if not a Supporter.
-LastLogins
Container for the last logins.
LoginTime : String
Repeter with Login Time information
-Language
Container for the language.
LanguageId : unsigned Integer
The globally unique LanguageID.
LanguageName : String
The language name.
-Country
Container for the country.
CountryId : unsigned Integer
The globally unique CountryID.
CountryName : String
The country name
-Currency
Container for the currency selected by the user.
CurrencyName : String
The name of the currency.
CurrencyRate : Decimal
Decimal value specifying the relative currency rate to SEK (swedish krona).
-Teams
Container for the list of Teams.
-Team
Container for the data about a particular Team.
TeamId : unsigned Integer
The globally unique TeamID.
TeamName : String
The full team name
GenderID : GenderID
The gender of the team.
Added in this Version
LeagueSystemID : LeagueSystemID
The system type of the league for the team.
-Arena
Container for the arena.
ArenaId : unsigned Integer
The globally unique ArenaID.
ArenaName : String
The arena name.
-League
Container for the league.
LeagueId : unsigned Integer
The globally unique LeagueID
LeagueName : String
The League name.
Season : unsigned Integer
The Current Season.
-Country
Container for the country.
CountryId : unsigned Integer
The globally unique CountryId
CountryName : String
The Country name.
-LeagueLevelUnit
Container for the LeagueLevelUnit ('series').
LeagueLevelUnitId : unsigned Integer
The globally unique LeagueLevelUnitID.
LeagueLevelUnitName : String
The name of the LeagueLevelUnit
-Region
Container for the region.
RegionId : unsigned Integer
The globally unique RegionID.
RegionName : String
The Region name
-YouthTeam
Container for the youthTeam. Will be empty if the team has no Youth academy.
YouthTeamId : unsigned Integer
If the Team has a Youth academy the ID is represented here.
YouthTeamName : String
If the Team has a Youth academy the team name is represented here.
-YouthLeague
Container for the league of the youthTeam. Will be empty if the youthTeam is currently not playing in a league.
YouthLeagueId : unsigned Integer
The globally unique YouthLeagueID.
YouthLeagueName : String
The name of the youth league.
-NationalTeamCoach
Container for national teams the manager is a coach of. Empty if user is not a national team coach.
-NationalTeam
Container for national team.
NationalTeamId : unsigned Integer
The globally unique NationalTeamID.
NationalTeamName : String
The name of the national team.
-NationalTeamAssistant
Container for national teams the manager is an assistant coach of. Empty if user is not a national team assistant coach.
-NationalTeam
Container for national team.
NationalTeamId : unsigned Integer
The globally unique NationalTeamID.
NationalTeamName : String
The name of the national team.
-Avatar
Container for the elements to build the avatar.
BackgroundImage : URI
The URL to the card background-image. This will show a silouette for non-supporter teams.
-Layer
Attribute: 'x' : unsigned Integer
x-coordinate of image layer
Attribute: 'y' : unsigned Integer
y-coordinate of image layer
The container for each avatar bodypart item. Two attribute named X and Y indicates where the item should be positioned. There are several of this container for each player. This container will not be provided for non-supporter team.
Image : URI
The URL to the bodypart item.
