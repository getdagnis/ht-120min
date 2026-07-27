export interface ParsedChppMatch {
  matchId: number;
  homeId: number;
  awayId: number;
  homeName: string | null;
  awayName: string | null;
  date: Date;
  matchType: number;
  homeGoals: number | null;
  awayGoals: number | null;
  status: string | null;
}

export interface ParsedChppMatchesResult {
  matches: ParsedChppMatch[];
  rawMatchesReturned: number;
  selectedCategoryMatches: number;
}

function readTag(block: string, tag: string) {
  return block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]?.trim() || '';
}

function parseDate(value: string) {
  const date = new Date(value.replace(' ', 'T'));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function parseChppMatchesXml(
  xml: string,
  options: {
    matchTypes: Set<number>;
    archive?: boolean;
    firstDate?: Date;
    lastDate?: Date;
  },
): ParsedChppMatchesResult {
  const matches: ParsedChppMatch[] = [];
  const blocks = [...xml.matchAll(/<Match>([\s\S]*?)<\/Match>/gi)].map((match) => match[1]);

  for (const block of blocks) {
    const matchType = Number.parseInt(readTag(block, 'MatchType') || '0', 10);
    const date = parseDate(readTag(block, 'MatchDate'));
    const matchId = Number.parseInt(readTag(block, 'MatchID') || '0', 10);
    const homeId = Number.parseInt(readTag(block, 'HomeTeamID') || '0', 10);
    const awayId = Number.parseInt(readTag(block, 'AwayTeamID') || '0', 10);
    const status = readTag(block, 'Status') || (options.archive ? 'FINISHED' : null);
    const categorySelected = options.matchTypes.has(matchType);

    if (!categorySelected || !date || !matchId || !homeId || !awayId) continue;
    if (options.firstDate && date < options.firstDate) continue;
    if (options.lastDate && date > options.lastDate) continue;
    if (!options.archive && status !== 'FINISHED' && status !== 'UPCOMING') continue;

    matches.push({
      matchId,
      homeId,
      awayId,
      homeName: readTag(block, 'HomeTeamName') || null,
      awayName: readTag(block, 'AwayTeamName') || null,
      date,
      matchType,
      homeGoals: readTag(block, 'HomeGoals') === '' ? null : Number(readTag(block, 'HomeGoals')),
      awayGoals: readTag(block, 'AwayGoals') === '' ? null : Number(readTag(block, 'AwayGoals')),
      status,
    });
  }

  return {
    matches,
    rawMatchesReturned: blocks.length,
    selectedCategoryMatches: matches.length,
  };
}

export function buildArchiveDateChunks(start: Date, end: Date, weeks = 4) {
  const chunks: Array<{ firstDate: Date; lastDate: Date }> = [];
  const chunkMilliseconds = weeks * 7 * 24 * 60 * 60 * 1000;
  let cursor = new Date(start);

  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + chunkMilliseconds, end.getTime()));
    chunks.push({ firstDate: new Date(cursor), lastDate: next });
    cursor = next;
  }

  return chunks;
}

export function mergeChppMatchesById(matchGroups: ParsedChppMatch[][]) {
  const merged = new Map<number, ParsedChppMatch>();
  for (const matches of matchGroups) {
    for (const match of matches) merged.set(match.matchId, match);
  }
  return [...merged.values()];
}
