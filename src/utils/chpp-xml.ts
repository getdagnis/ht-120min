export interface ChppTeamOption {
  teamId: number;
  teamName: string;
  leagueName?: string;
  leagueId?: number;
  leagueLevelUnitName?: string;
  regionName?: string;
  countryName?: string;
}

export interface ParsedManagerCompendium {
  hattrickUserId: number | null;
  managerName: string;
  teams: ChppTeamOption[];
}

function readTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
  return match?.[1]?.trim();
}

export function parseManagerCompendiumXml(xml: string): ParsedManagerCompendium {
  const userIdRaw =
    xml.match(/<UserId>(\d+)<\/UserId>/i)?.[1] ?? xml.match(/<UserID>(\d+)<\/UserID>/i)?.[1];
  const managerName = readTag(xml, 'Loginname') ?? 'Unknown';

  const teams: ChppTeamOption[] = [];
  for (const match of xml.matchAll(/<Team>([\s\S]*?)<\/Team>/gi)) {
    const block = match[1];
    const teamIdRaw = block.match(/<TeamId>(\d+)<\/TeamId>/i)?.[1] ?? block.match(/<TeamID>(\d+)<\/TeamID>/i)?.[1];
    if (!teamIdRaw) continue;

    const leagueIdRaw = block.match(/<LeagueId>(\d+)<\/LeagueId>/i)?.[1];

    teams.push({
      teamId: parseInt(teamIdRaw, 10),
      teamName: readTag(block, 'TeamName') ?? 'Unknown',
      leagueName: readTag(block, 'LeagueName'),
      leagueId: leagueIdRaw ? parseInt(leagueIdRaw, 10) : undefined,
      leagueLevelUnitName: readTag(block, 'LeagueLevelUnitName'),
      regionName: readTag(block, 'RegionName'),
      countryName: readTag(xml, 'CountryName'), // CountryName is usually at the Manager or Team level depending on file, but managercompendium has it in <Manager><Country><CountryName>
    });
  }

  return {
    hattrickUserId: userIdRaw ? parseInt(userIdRaw, 10) : null,
    managerName,
    teams,
  };
}
