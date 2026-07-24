import { getForgeSuperadminId } from './forge-session.js';
import type { TournamentRole } from '../../shared/tournament-roles.js';

export type TournamentActualRole = 'original_organizer' | TournamentRole | null;

export interface TournamentAccess {
  viewerUserId: number;
  viewerManagerName: string | null;
  organizerUserId: number | null;
  organizerManagerName: string | null;
  actualRole: TournamentActualRole;
  effectiveRole: 'original_organizer' | TournamentRole | null;
  isOriginalOrganizer: boolean;
  isImplicitSuperadmin: boolean;
  canViewAdmin: boolean;
  canManageOperations: boolean;
  canPublishAnnouncements: boolean;
  canViewRoles: boolean;
  canManageAdmins: boolean;
  canManagePressOfficer: boolean;
  canManageCoOrganizer: boolean;
}

export interface TournamentRoleRecord {
  id: string;
  tournament_id: string;
  hattrick_user_id: number;
  role: TournamentRole;
  added_by_ht_user_id: number | null;
  created_at: string;
  updated_at: string;
  manager_name: string | null;
}

export interface TournamentOwner {
  hattrick_user_id: number | null;
  manager_name: string | null;
}

function isMissingTournamentRolesTable(error: { code?: string } | null) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

interface ResolveAccessInput {
  viewerUserId: number;
  viewerManagerName?: string | null;
  organizerId: number | null;
  organizerManagerName?: string | null;
  explicitRole?: TournamentRole | null;
  isImplicitSuperadmin?: boolean;
}

export function resolveTournamentAccess(input: ResolveAccessInput): TournamentAccess {
  const isOriginalOrganizer = input.organizerId === input.viewerUserId;
  const isImplicitSuperadmin = Boolean(input.isImplicitSuperadmin);
  const actualRole: TournamentActualRole = isOriginalOrganizer
    ? 'original_organizer'
    : input.explicitRole || null;
  const effectiveRole = actualRole || (isImplicitSuperadmin ? 'original_organizer' : null);
  const canViewAdmin = Boolean(effectiveRole);
  const canManageOperations = isImplicitSuperadmin || effectiveRole === 'original_organizer' || effectiveRole === 'co_organizer' || effectiveRole === 'admin';
  const canPublishAnnouncements = canManageOperations || effectiveRole === 'press_officer';
  const canViewRoles = isImplicitSuperadmin || effectiveRole === 'original_organizer' || effectiveRole === 'co_organizer' || effectiveRole === 'admin';
  const canManageAdmins = isImplicitSuperadmin || effectiveRole === 'original_organizer' || effectiveRole === 'co_organizer';
  const canManagePressOfficer = canManageAdmins;
  const canManageCoOrganizer = isImplicitSuperadmin || effectiveRole === 'original_organizer';

  return {
    viewerUserId: input.viewerUserId,
    viewerManagerName: input.viewerManagerName || null,
    organizerUserId: input.organizerId,
    organizerManagerName: input.organizerManagerName || null,
    actualRole,
    effectiveRole,
    isOriginalOrganizer,
    isImplicitSuperadmin,
    canViewAdmin,
    canManageOperations,
    canPublishAnnouncements,
    canViewRoles,
    canManageAdmins,
    canManagePressOfficer,
    canManageCoOrganizer,
  };
}

export async function loadTournamentAccess(
  supabase: ReturnType<typeof import('./supabase.js').getServiceSupabase>,
  tournamentId: string,
  viewerUserId: number,
  allowDevelopmentBypass = false,
): Promise<TournamentAccess | null> {
  const [{ data: tournament, error: tournamentError }, { data: profile, error: profileError }, { data: assignedRole, error: roleError }] = await Promise.all([
    supabase.from('tournaments').select('organizer_id, organizer_name').eq('id', tournamentId).maybeSingle(),
    supabase.from('profiles').select('manager_name').eq('hattrick_user_id', viewerUserId).maybeSingle(),
    supabase.from('tournament_roles').select('role').eq('tournament_id', tournamentId).eq('hattrick_user_id', viewerUserId).maybeSingle(),
  ]);

  if (tournamentError) throw tournamentError;
  if (profileError) throw profileError;
  if (roleError && !isMissingTournamentRolesTable(roleError)) throw roleError;
  if (!tournament) return null;

  const organizerId = Number(tournament.organizer_id) || null;
  let organizerManagerName = tournament.organizer_name || null;
  if (organizerId === viewerUserId) {
    organizerManagerName = profile?.manager_name || organizerManagerName;
  } else if (organizerId) {
    const { data: organizerProfile, error: organizerProfileError } = await supabase
      .from('profiles')
      .select('manager_name')
      .eq('hattrick_user_id', organizerId)
      .maybeSingle();
    if (organizerProfileError) throw organizerProfileError;
    organizerManagerName = organizerProfile?.manager_name || organizerManagerName;
  }

  const configuredSuperadminId = getForgeSuperadminId();
  return resolveTournamentAccess({
    viewerUserId,
    viewerManagerName: profile?.manager_name,
    organizerId,
    organizerManagerName,
    explicitRole: (assignedRole?.role as TournamentRole | null) || null,
    isImplicitSuperadmin: allowDevelopmentBypass || viewerUserId === configuredSuperadminId,
  });
}

export async function loadTournamentRoleRecords(
  supabase: ReturnType<typeof import('./supabase.js').getServiceSupabase>,
  tournamentId: string,
) {
  const [{ data: tournament, error: tournamentError }, { data: roleRows, error: rolesError }] = await Promise.all([
    supabase.from('tournaments').select('organizer_id, organizer_name').eq('id', tournamentId).maybeSingle(),
    supabase.from('tournament_roles').select('*').eq('tournament_id', tournamentId).order('created_at'),
  ]);
  if (tournamentError) throw tournamentError;
  if (rolesError) throw rolesError;
  if (!tournament) return null;

  const rows = (roleRows || []) as TournamentRoleRecord[];
  const userIds = Array.from(new Set([
    Number(tournament.organizer_id) || 0,
    ...rows.map((row) => Number(row.hattrick_user_id)),
  ].filter(Boolean)));
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase.from('profiles').select('hattrick_user_id, manager_name').in('hattrick_user_id', userIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;

  const names = new Map((profiles || []).map((profile) => [Number(profile.hattrick_user_id), profile.manager_name]));
  return {
    originalOrganizer: {
      hattrick_user_id: Number(tournament.organizer_id) || null,
      manager_name: names.get(Number(tournament.organizer_id)) || tournament.organizer_name || null,
    } satisfies TournamentOwner,
    roles: rows.map((row) => ({
      ...row,
      manager_name: names.get(Number(row.hattrick_user_id)) || null,
    })),
  };
}
