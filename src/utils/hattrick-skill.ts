const SKILL_NAMES = [
  'non-existent', 'disastrous', 'wretched', 'poor', 'weak', 'inadequate', 'passable',
  'solid', 'excellent', 'formidable', 'outstanding', 'brilliant', 'magnificent', 'world class',
  'supernatural', 'titanic', 'extra-terrestrial', 'mythical', 'magical', 'utopian', 'divine',
];

export function skillDisplay(value: number | null | undefined) {
  if (value === null) return 'Not set';
  if (value === undefined) return '—';
  const name = SKILL_NAMES[value];
  return name ? `${name[0].toUpperCase()}${name.slice(1)} (${value})` : String(value);
}
