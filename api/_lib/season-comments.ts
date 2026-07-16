interface FrozenParticipant {
  teamId?: string;
  teamName?: string;
  hattrickUserId?: number | null;
  managerName?: string | null;
}

interface SeasonSnapshot {
  participants?: FrozenParticipant[];
  standings?: FrozenParticipant[];
}

export function validateSeasonComment(comment: unknown) {
  const preserved = typeof comment === 'string' ? comment : '';
  if (preserved.trim().length < 1 || preserved.length > 480) {
    return { comment: '', error: 'Comment must be between 1 and 480 characters.' };
  }
  return { comment: preserved, error: null };
}

export function findOwnedSeasonParticipant(snapshot: SeasonSnapshot | null, teamId: string, hattrickUserId: number) {
  const participants = snapshot?.participants || snapshot?.standings || [];
  return (
    participants.find(
      (participant) => participant.teamId === teamId && Number(participant.hattrickUserId) === hattrickUserId,
    ) || null
  );
}
