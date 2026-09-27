export function getAnalyticsExcludedHtUserId() {
  const parsed = Number(process.env.ANALYTICS_EXCLUDED_HT_USER_ID || '');
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
