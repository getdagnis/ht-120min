export function isHattrickReferral(referrer: string): boolean {
  try {
    const url = new URL(referrer);
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.hostname.toLowerCase().endsWith('.hattrick.org');
  } catch {
    return false;
  }
}
