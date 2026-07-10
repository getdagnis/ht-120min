export const FORGE_SUPERADMIN_USER_ID = 8777402;

export const siteAdminRules = [
  {
    role: 'superadmin',
    title: 'Superadmin',
    hattrickUserId: FORGE_SUPERADMIN_USER_ID,
    description: 'Full access to Forge, FAQ editing, testing tools, and any future admin surfaces.',
  },
  {
    role: 'moderator',
    title: 'Moderator',
    hattrickUserId: null,
    description: 'Future partial-access role for content review and support tasks.',
  },
] as const;
