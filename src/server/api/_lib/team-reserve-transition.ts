export type TeamReserveTransitionAction = 'to_reserve' | 'to_participant';

export interface TeamReserveTransitionTeam {
  active: boolean;
  reserve_active: boolean;
  is_placeholder?: boolean | null;
}

export type TeamReserveTransitionResult =
  | {
      ok: true;
      values: {
        active: boolean;
        reserve_active: boolean;
      };
    }
  | {
      ok: false;
      status: 409;
      error: string;
    };

export function validateTeamReserveTransition(input: {
  action: TeamReserveTransitionAction;
  team: TeamReserveTransitionTeam;
  hasGeneratedRounds: boolean;
  activeParticipantCount: number;
  maxTeams: number | null;
}): TeamReserveTransitionResult {
  if (input.hasGeneratedRounds) {
    return {
      ok: false,
      status: 409,
      error: 'Team reserve changes are unavailable after the schedule has been generated.',
    };
  }

  if (input.team.is_placeholder) {
    return { ok: false, status: 409, error: 'Placeholder slots cannot be moved between participants and reserves.' };
  }

  if (input.action === 'to_reserve') {
    if (!input.team.active || input.team.reserve_active) {
      return { ok: false, status: 409, error: 'Only an active participant can be moved to the reserve list.' };
    }
    return { ok: true, values: { active: false, reserve_active: true } };
  }

  if (input.team.active || !input.team.reserve_active) {
    return { ok: false, status: 409, error: 'Only a reserve team can be promoted to the tournament.' };
  }

  if (input.maxTeams !== null && input.activeParticipantCount >= input.maxTeams) {
    return { ok: false, status: 409, error: 'The tournament has reached its maximum number of teams.' };
  }

  return { ok: true, values: { active: true, reserve_active: false } };
}
