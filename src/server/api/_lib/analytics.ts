export function getAnalyticsExcludedHtUserId() {
  const parsed = Number(process.env.ANALYTICS_EXCLUDED_HT_USER_ID || '');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isLocalAnalyticsHost(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;

  let hostname = raw.trim().toLowerCase();
  if (!hostname) return false;
  if (hostname === '::1' || hostname === '[::1]') return true;
  try {
    hostname = new URL(`http://${hostname}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  hostname = hostname.replace(/^\[|\]$/g, '');

  return hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || /^127\./.test(hostname)
    || hostname === '::1';
}

export function isVercelPreviewAnalyticsHost(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return false;
  try {
    const hostname = new URL(`http://${raw.trim()}`).hostname.toLowerCase();
    return /^ht-120min-(?:[a-z0-9-]+-)?getdagnis-projects\.vercel\.app$/.test(hostname);
  } catch {
    return false;
  }
}

export function isExcludedAnalyticsReferrer(value: string | null) {
  if (!value) return false;
  try {
    const host = new URL(value).host;
    return isLocalAnalyticsHost(host) || isVercelPreviewAnalyticsHost(host);
  } catch {
    return false;
  }
}
