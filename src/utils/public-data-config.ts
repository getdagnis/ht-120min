export const PUBLIC_DATA_READ_TIMEOUT_MS = 6_000;
export const PUBLIC_DATA_RETRY_TIMEOUTS_MS = [6_000, 8_000, 10_000] as const;

export function getPublicDataReadTimeoutMs(attempt: number): number {
  const normalizedAttempt = Number.isInteger(attempt) ? Math.max(1, Math.min(attempt, PUBLIC_DATA_RETRY_TIMEOUTS_MS.length)) : 1;
  return PUBLIC_DATA_RETRY_TIMEOUTS_MS[normalizedAttempt - 1];
}

export function parsePublicDataAttempt(value: string | undefined): number {
  const attempt = Number(value);
  return Number.isInteger(attempt) && attempt >= 1 && attempt <= PUBLIC_DATA_RETRY_TIMEOUTS_MS.length ? attempt : 1;
}

export function getPublicDataRetryHref(href: string, attempt: number): string {
  const [pathname, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  params.set('publicDataAttempt', String(Math.min(attempt + 1, PUBLIC_DATA_RETRY_TIMEOUTS_MS.length)));
  return `${pathname}?${params.toString()}`;
}
