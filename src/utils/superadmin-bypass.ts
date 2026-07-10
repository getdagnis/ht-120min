const SUPERADMIN_BYPASS_COOKIE_NAME = 'issuperadmin';
const SUPERADMIN_BYPASS_TOKEN = import.meta.env.VITE_SUPERADMIN_BYPASS_TOKEN?.trim() || null;

function readCookieValue(cookieHeader: string, cookieName: string) {
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${cookieName}=`)) continue;

    const rawValue = trimmed.slice(cookieName.length + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

export function hasSuperAdminBypassCookie(cookieHeader: string | undefined) {
  if (import.meta.env.PROD || !SUPERADMIN_BYPASS_TOKEN || !cookieHeader) {
    return false;
  }

  return readCookieValue(cookieHeader, SUPERADMIN_BYPASS_COOKIE_NAME) === SUPERADMIN_BYPASS_TOKEN;
}
