import { APPG_OUTCOMES, type AppgOutcome } from './appg';

export interface ResultCsvRow {
  type: 'team' | 'match';
  teamId: number | null;
  round: number | null;
  homeTeamId: number | null;
  awayTeamId: number | null;
  homeGoals: number | null;
  awayGoals: number | null;
  totalMinutes: number | null;
  went120: boolean | null;
  penaltyShootoutHomeGoals: number | null;
  penaltyShootoutAwayGoals: number | null;
  appgOutcome: AppgOutcome | null;
}

function parseNullableNumber(value: string | undefined, field: string, line: number) {
  const trimmed = value?.trim() || '';
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) throw new Error(`Line ${line}: ${field} must be a whole number.`);
  return Number(trimmed);
}

function parseBoolean(value: string | undefined, line: number) {
  const trimmed = value?.trim().toLowerCase() || '';
  if (!trimmed) return null;
  if (['true', '1', 'yes'].includes(trimmed)) return true;
  if (['false', '0', 'no'].includes(trimmed)) return false;
  throw new Error(`Line ${line}: went_120 must be true or false.`);
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted value.');
  values.push(current.trim());
  return values;
}

export function parseResultCsv(csv: string): ResultCsvRow[] {
  const lines = csv.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV must contain a header and at least one row.');
  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  if (!headers.includes('type')) throw new Error('CSV must include a type column: team or match.');
  const indexOf = (name: string) => headers.indexOf(name);
  const valueAt = (values: string[], name: string) => (indexOf(name) >= 0 ? values[indexOf(name)] : undefined);
  const rows: ResultCsvRow[] = [];
  const seenTeams = new Set<number>();

  lines.slice(1).forEach((line, offset) => {
    const lineNumber = offset + 2;
    const values = splitCsvLine(line);
    const type = (valueAt(values, 'type') || '').toLowerCase();
    if (type !== 'team' && type !== 'match') throw new Error(`Line ${lineNumber}: type must be team or match.`);
    const teamId = parseNullableNumber(valueAt(values, 'team_id'), 'team_id', lineNumber);
    if (type === 'team') {
      if (!teamId) throw new Error(`Line ${lineNumber}: team rows require team_id.`);
      if (seenTeams.has(teamId)) throw new Error(`Line ${lineNumber}: team_id ${teamId} appears more than once.`);
      seenTeams.add(teamId);
    }
    const round = parseNullableNumber(valueAt(values, 'round'), 'round', lineNumber);
    const homeTeamId = parseNullableNumber(valueAt(values, 'home_team_id'), 'home_team_id', lineNumber);
    const awayTeamId = parseNullableNumber(valueAt(values, 'away_team_id'), 'away_team_id', lineNumber);
    if (type === 'match' && (!round || !homeTeamId || !awayTeamId)) {
      throw new Error(`Line ${lineNumber}: match rows require round, home_team_id, and away_team_id.`);
    }
    const rawOutcome = valueAt(values, 'appg_outcome')?.trim() || '';
    if (rawOutcome && !APPG_OUTCOMES.includes(rawOutcome as AppgOutcome)) {
      throw new Error(`Line ${lineNumber}: unknown appg_outcome ${rawOutcome}.`);
    }
    rows.push({
      type,
      teamId,
      round,
      homeTeamId,
      awayTeamId,
      homeGoals: parseNullableNumber(valueAt(values, 'home_goals'), 'home_goals', lineNumber),
      awayGoals: parseNullableNumber(valueAt(values, 'away_goals'), 'away_goals', lineNumber),
      totalMinutes: parseNullableNumber(valueAt(values, 'total_minutes'), 'total_minutes', lineNumber),
      went120: parseBoolean(valueAt(values, 'went_120'), lineNumber),
      penaltyShootoutHomeGoals: parseNullableNumber(valueAt(values, 'penalty_shootout_home_goals'), 'penalty_shootout_home_goals', lineNumber),
      penaltyShootoutAwayGoals: parseNullableNumber(valueAt(values, 'penalty_shootout_away_goals'), 'penalty_shootout_away_goals', lineNumber),
      appgOutcome: (rawOutcome || null) as AppgOutcome | null,
    });
  });
  return rows;
}

export const RESULT_CSV_TEMPLATE = `type,team_id,round,home_team_id,away_team_id,home_goals,away_goals,total_minutes,went_120,penalty_shootout_home_goals,penalty_shootout_away_goals,appg_outcome\nteam,3220518,,,,,,,,,,\nmatch,,1,3220518,3220511,2,1,121,true,,,ET3`;
