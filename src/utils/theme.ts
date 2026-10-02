export type EffectiveTheme = 'light' | 'dark';

function isExplicitTheme(value: string | null | undefined): value is EffectiveTheme {
  return value === 'light' || value === 'dark';
}

export function resolveEffectiveTheme({
  storedPreference,
  dataTheme,
  prefersDark,
}: {
  storedPreference?: string | null;
  dataTheme?: string | null;
  prefersDark: boolean;
}): EffectiveTheme {
  if (isExplicitTheme(storedPreference)) return storedPreference;
  if (isExplicitTheme(dataTheme)) return dataTheme;
  return prefersDark ? 'dark' : 'light';
}
