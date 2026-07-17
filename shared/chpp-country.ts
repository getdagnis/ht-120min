import { getCountryWorldDetails } from './worlddetails.js';

export function normalizeChppCountryName(countryName?: string, countryId?: number): string | undefined {
  const isAscii = (name: string) => [...name].every((character) => character.charCodeAt(0) <= 0x7f);

  return (
    getCountryWorldDetails(countryId)?.fullName ??
    (countryId == null && countryName && isAscii(countryName) ? countryName : undefined)
  );
}
