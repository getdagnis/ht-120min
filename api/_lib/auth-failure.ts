import type { VercelRequest, VercelResponse } from '@vercel/node';

function getSafeReturnPath(req: VercelRequest) {
  const rawCookie = req.cookies?.auth_return_url;
  if (!rawCookie) return '/';

  try {
    const decoded = decodeURIComponent(rawCookie);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) return decoded;
  } catch {
    // Use the home page when a malformed return cookie is present.
  }

  return '/';
}

function getFailureReference() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function redirectAuthFailure(req: VercelRequest, res: VercelResponse, stage: string, error: unknown) {
  const reference = getFailureReference();
  console.error('AUTH_FAILURE', {
    reference,
    stage,
    url: req.url,
    method: req.method,
    userAgent: req.headers['user-agent'],
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });

  const returnPath = getSafeReturnPath(req);
  const separator = returnPath.includes('?') ? '&' : '?';
  return res.redirect(
    `${returnPath}${separator}auth_error=${encodeURIComponent(stage)}&auth_error_ref=${encodeURIComponent(reference)}`,
  );
}
