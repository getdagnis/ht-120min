export type TacticKey =
  | 'normal'
  | 'pressing'
  | 'counter_attacks'
  | 'attack_in_the_middle'
  | 'attack_on_wings'
  | 'play_creatively'
  | 'long_shots';

interface TacticDefinition {
  key: TacticKey;
  type: number;
  canonicalName: string;
  displayName: string;
  aliases: readonly string[];
}

export const TACTIC_DEFINITIONS = [
  { key: 'normal', type: 0, canonicalName: 'Normal', displayName: '⚠️ Normal', aliases: ['Normal'] },
  { key: 'pressing', type: 1, canonicalName: 'Pressing', displayName: '✅ Pressing', aliases: ['Pressing'] },
  { key: 'counter_attacks', type: 2, canonicalName: 'Counter-attacks', displayName: '⛔️ Counter-attacks', aliases: ['Counter attacks'] },
  {
    key: 'attack_in_the_middle', type: 3, canonicalName: 'Attack in the middle', displayName: '⛔️ Attack in the middle',
    aliases: ['Attack in middle', 'Attack through the middle'],
  },
  {
    key: 'attack_on_wings', type: 4, canonicalName: 'Attack on wings', displayName: '⛔️ Attack on wings',
    aliases: ['Attack in wings', 'Attack on the wings', 'Attack on wings'],
  },
  { key: 'play_creatively', type: 7, canonicalName: 'Play creatively', displayName: '⛔️ Play creatively', aliases: ['Play creatively'] },
  { key: 'long_shots', type: 8, canonicalName: 'Long shots', displayName: '⛔️ Long shots', aliases: ['Long shots'] },
] as const satisfies readonly TacticDefinition[];

const keyByLabel = new Map<string, TacticKey>();

function normalizeTacticLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
}

for (const definition of TACTIC_DEFINITIONS) {
  keyByLabel.set(definition.key, definition.key);
  keyByLabel.set(normalizeTacticLabel(definition.displayName), definition.key);
  for (const alias of definition.aliases) keyByLabel.set(normalizeTacticLabel(alias), definition.key);
}

export function getTacticKey(value: string | null | undefined): TacticKey | null {
  if (!value) return null;
  return keyByLabel.get(normalizeTacticLabel(value)) ?? null;
}

export function getTacticKeyFromType(type: number | null | undefined): TacticKey | null {
  return type === null || type === undefined
    ? null
    : TACTIC_DEFINITIONS.find((definition) => definition.type === type)?.key ?? null;
}

export function resolveTacticKey(type: number | null | undefined, savedName: string | null | undefined): TacticKey | null {
  return getTacticKeyFromType(type) ?? getTacticKey(savedName);
}

export function getTacticDisplayName(value: string | TacticKey | null | undefined): string | null {
  if (!value) return null;
  const key = getTacticKey(value);
  return key ? TACTIC_DEFINITIONS.find((definition) => definition.key === key)?.displayName ?? null : null;
}

export function getTacticDisplayNameFromType(type: number | null | undefined): string | null {
  const key = getTacticKeyFromType(type);
  return key ? TACTIC_DEFINITIONS.find((definition) => definition.key === key)?.displayName ?? null : null;
}

/** Stable stored name; display prefixes belong only in presentation. */
export function getTacticCanonicalNameFromType(type: number | null | undefined): string | null {
  const key = getTacticKeyFromType(type);
  return key ? TACTIC_DEFINITIONS.find((definition) => definition.key === key)?.canonicalName ?? null : null;
}
