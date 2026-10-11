const TOURNAMENT_SHARE_ORIGIN = 'https://ht-120min.vercel.app';

export function getTournamentShareUrl(slug: string): string {
  return `${TOURNAMENT_SHARE_ORIGIN}/t/${encodeURIComponent(slug)}`;
}

export function getTournamentForumShareCode(name: string, slug: string): string {
  return `[br][q][b]${name}[/b]\nJoin here: [b][link=${getTournamentShareUrl(slug)}][/b][/q]`;
}
