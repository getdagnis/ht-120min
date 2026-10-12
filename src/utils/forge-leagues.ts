export const FORGE_LEAGUE_TEAM_LIMIT = 1200;

export const managerMessageHref = (managerId: number) =>
  `https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=${managerId}`;

/** Private Forge list snapshots, never tournament registrations or authenticated profiles. */
export interface ForgeLeagueOption {
  leagueId: number;
  name: string;
  activeTeams: number;
  fetched?: boolean;
}

export interface ForgeLeagueTeam {
  teamId: number;
  teamName: string;
  managerId: number;
  managerName: string;
  managerCountryId?: number | null;
  supporterTier?: string | null;
  lastLoginDate?: string | null;
  countryId: number | null;
  booked: boolean | null;
  inCup: boolean | null;
  checkedAt: string | null;
  error: string | null;
}

function capitalizeFirst(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : '';
}

export function formatForgeLeagueOutreachMessage(
  template: string,
  team: ForgeLeagueTeam,
  teamFlag: string,
): string {
  return template
    .replaceAll('{teamName}', team.teamName)
    .replaceAll('{managerName}', capitalizeFirst(team.managerName || ''))
    .replaceAll('{teamFlag}', teamFlag);
}

export interface ForgeLeagueJob {
  mode: 'populate' | 'availability' | 'precise';
  cursor: number;
  total: number;
  // Temporary discovery work queue; removed when population completes.
  seriesIds: number[];
  seriesCursor: number;
  candidates: number[];
}

export interface ForgeLeagueSnapshot {
  teams: ForgeLeagueTeam[];
  populatedAt: string | null;
  availabilityAt: string | null;
  populationComplete: boolean;
  job: ForgeLeagueJob | null;
  availabilityMethod?: 'teamdetails' | 'matches';
  saveId?: string;
}

export interface ForgeOutreachCampaign {
  id: string;
  name: string;
  campaignDate: string;
}

export interface ForgeOutreachContact {
  campaignId: string;
  managerId: number;
}

export function getForgeOutreachStatus(
  campaignId: string,
  managerId: number,
  campaigns: ForgeOutreachCampaign[],
  contacts: ForgeOutreachContact[],
) {
  const managerContacts = contacts.filter((contact) => contact.managerId === managerId);
  return {
    contacted: managerContacts.some((contact) => contact.campaignId === campaignId),
    previousCampaignNames: [...new Set(managerContacts
      .filter((contact) => contact.campaignId !== campaignId)
      .map((contact) => campaigns.find((campaign) => campaign.id === contact.campaignId)?.name)
      .filter((name): name is string => Boolean(name)))],
  };
}

export function leagueTeamStatus(team: ForgeLeagueTeam): 'Available' | 'Booked' | 'In cup' | 'Unknown' {
  if (team.inCup === true) return 'In cup';
  if (team.booked === true) return 'Booked';
  return team.booked === false && team.inCup === false ? 'Available' : 'Unknown';
}
