import type { ParsedTeamDetails } from './chpp-xml.js';

export interface HfiRankParticipant {
  id: string;
  name: string | null;
  ht_team_id: number | string | null;
  active: boolean | null;
  reserve_active: boolean | null;
  is_placeholder: boolean | null;
}

export interface HfiRankUpdate {
  teamId: string;
  htTeamId: number;
  teamName: string;
  teamRank: number;
  powerRating: number | null;
  powerGlobalRank: number | null;
  powerLeagueRank: number | null;
  powerRegionRank: number | null;
}

export interface HfiRankRefreshResult {
  participantCount: number;
  updatedCount: number;
  ranks: HfiRankUpdate[];
}

export function validateHfiRankRefreshAccess(input: {
  canManageOperations: boolean;
  leagueCategory: string | null | undefined;
}) {
  if (!input.canManageOperations) return 'This role cannot update HFI ranks.';
  if (input.leagueCategory !== 'hfi') return 'HFI ranks can only be updated for HFI tournaments.';
  return null;
}

export function selectCurrentHfiParticipants(rows: HfiRankParticipant[]) {
  return rows.filter(
    (team) => team.active === true && team.reserve_active !== true && team.is_placeholder !== true,
  );
}

function getValidHtTeamId(team: HfiRankParticipant) {
  const teamId = Number(team.ht_team_id);
  return Number.isSafeInteger(teamId) && teamId > 0 ? teamId : null;
}

function getValidTeamRank(details: Pick<ParsedTeamDetails, 'teamRank'>) {
  return Number.isSafeInteger(details.teamRank) && Number(details.teamRank) > 0 ? Number(details.teamRank) : null;
}

function getPowerValue(value: number | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export async function refreshCurrentHfiTeamRanks(input: {
  participants: HfiRankParticipant[];
  fetchTeamDetails: (
    teamId: number,
  ) => Promise<Pick<ParsedTeamDetails, 'teamName' | 'teamRank' | 'powerRating' | 'powerGlobalRank' | 'powerLeagueRank' | 'powerRegionRank'>>;
  updateTeamMetadata: (teamId: string, update: Omit<HfiRankUpdate, 'teamId' | 'htTeamId' | 'teamName'>) => Promise<void>;
}): Promise<HfiRankRefreshResult> {
  const participants = selectCurrentHfiParticipants(input.participants);
  const teamIds = participants.map((team) => ({ team, htTeamId: getValidHtTeamId(team) }));
  const invalidTeam = teamIds.find(({ htTeamId }) => htTeamId === null)?.team;
  if (invalidTeam) {
    throw new Error(`Active participant ${invalidTeam.name || invalidTeam.id} has no valid Hattrick team ID.`);
  }

  // Fetch the complete set before invoking updateTeamMetadata. A CHPP failure or
  // missing rank therefore leaves every database row untouched.
  const ranks = await Promise.all(
    teamIds.map(async ({ team, htTeamId }) => {
      const details = await input.fetchTeamDetails(htTeamId as number).catch((error) => {
        const reason = error instanceof Error ? error.message : 'CHPP teamdetails could not be fetched.';
        throw new Error(`Could not refresh HFI rank for ${team.name || `team ${htTeamId}`}: ${reason}`);
      });
      const teamRank = getValidTeamRank(details);
      if (teamRank === null) {
        throw new Error(`CHPP did not return a valid HFI rank for ${details.teamName || team.name || `team ${htTeamId}`}.`);
      }
      return {
        teamId: team.id,
        htTeamId: htTeamId as number,
        teamName: details.teamName || team.name || `Team ${htTeamId}`,
        teamRank,
        powerRating: getPowerValue(details.powerRating),
        powerGlobalRank: getPowerValue(details.powerGlobalRank),
        powerLeagueRank: getPowerValue(details.powerLeagueRank),
        powerRegionRank: getPowerValue(details.powerRegionRank),
      } satisfies HfiRankUpdate;
    }),
  );

  for (const rank of ranks) {
    await input.updateTeamMetadata(rank.teamId, {
      teamRank: rank.teamRank,
      powerRating: rank.powerRating,
      powerGlobalRank: rank.powerGlobalRank,
      powerLeagueRank: rank.powerLeagueRank,
      powerRegionRank: rank.powerRegionRank,
    });
  }

  return {
    participantCount: participants.length,
    updatedCount: ranks.length,
    ranks,
  };
}
