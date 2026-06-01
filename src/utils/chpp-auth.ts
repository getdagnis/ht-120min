import crypto from 'crypto';

/**
 * RFC 3986 compliant encoding
 */
function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function generateNonce(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function getTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export function generateSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret = '',
): string {
  const baseString = [
    method.toUpperCase(),
    rfc3986(url),
    rfc3986(
      Object.keys(params)
        .sort()
        .map((key) => `${rfc3986(key)}=${rfc3986(params[key])}`)
        .join('&'),
    ),
  ].join('&');

  const signingKey = `${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`;

  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

export function getAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token = '',
  tokenSecret = '',
): string {
  const oauthParams: Record<string, string> = {
    ...params,
    oauth_consumer_key: consumerKey,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: getTimestamp(),
    oauth_nonce: generateNonce(),
    oauth_version: '1.0',
  };

  if (token) {
    oauthParams.oauth_token = token;
  }

  const signature = generateSignature(method, url, oauthParams, consumerSecret, tokenSecret);
  oauthParams.oauth_signature = signature;

  // Header should only contain oauth_ parameters for maximum compatibility
  return (
    'OAuth ' +
    Object.keys(oauthParams)
      .filter((key) => key.startsWith('oauth_'))
      .sort()
      .map((key) => `${rfc3986(key)}="${rfc3986(oauthParams[key])}"`)
      .join(', ')
  );
}
