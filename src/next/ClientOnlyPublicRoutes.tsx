'use client';

import dynamic from 'next/dynamic';

export const CreateTournamentClient = dynamic(
  () => import('../legacy-pages/Create/CreateTournament').then((module) => module.CreateTournament),
  { ssr: false },
);

export const MatchmakerClient = dynamic(
  () => import('../legacy-pages/Public/Matchmaker').then((module) => module.Matchmaker),
  { ssr: false },
);

export const SupportersClient = dynamic(
  () => import('../legacy-pages/Public/SupportersPage').then((module) => module.SupportersPage),
  { ssr: false },
);

export const AuthCallbackClient = dynamic(
  () => import('../legacy-pages/AuthCallback').then((module) => module.AuthCallback),
  { ssr: false },
);

export const ForgeClient = dynamic(
  () => import('./ForgeApp').then((module) => module.ForgeApp),
  { ssr: false },
);
