export interface RoundPressDraft {
  title: string;
  intro: string;
  matches: Array<{ matchId: string; paragraph: string }>;
  outro: string;
}

export interface RoundPressValidationResult {
  draft: RoundPressDraft | null;
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateRoundPressDraft(value: unknown, expectedMatchIds: string[]): RoundPressValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { draft: null, errors: ['Response must be a JSON object.'] };

  const title = text(value.title);
  const intro = text(value.intro);
  const outro = text(value.outro);
  if (!title) errors.push('title must be non-empty.');
  if (!intro) errors.push('intro must be non-empty.');
  if (!outro) errors.push('outro must be non-empty.');

  const rawMatches = value.matches;
  if (!Array.isArray(rawMatches)) {
    errors.push('matches must be an array.');
    return { draft: null, errors };
  }

  const matches: Array<{ matchId: string; paragraph: string }> = [];
  const seen = new Set<string>();
  rawMatches.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`matches[${index}] must be an object.`);
      return;
    }
    const matchId = text(item.matchId);
    const paragraph = text(item.paragraph);
    if (!matchId) errors.push(`matches[${index}].matchId must be non-empty.`);
    if (!paragraph) errors.push(`matches[${index}].paragraph must be non-empty.`);
    if (!matchId || !paragraph) return;
    if (seen.has(matchId)) errors.push(`Duplicate match ID: ${matchId}.`);
    seen.add(matchId);
    if (!expectedMatchIds.includes(matchId)) errors.push(`Foreign match ID: ${matchId}.`);
    matches.push({ matchId, paragraph });
  });

  if (matches.length !== expectedMatchIds.length) {
    errors.push(`Expected ${expectedMatchIds.length} match paragraphs, received ${matches.length}.`);
  }
  const missing = expectedMatchIds.filter((matchId) => !seen.has(matchId));
  if (missing.length > 0) errors.push(`Missing match IDs: ${missing.join(', ')}.`);

  if (errors.length > 0 || !title || !intro || !outro) return { draft: null, errors };
  return { draft: { title, intro, matches, outro }, errors: [] };
}

export function parseAndValidateRoundPressDraft(raw: string, expectedMatchIds: string[]): RoundPressValidationResult {
  try {
    return validateRoundPressDraft(JSON.parse(raw) as unknown, expectedMatchIds);
  } catch {
    return { draft: null, errors: ['Response was not valid JSON.'] };
  }
}
