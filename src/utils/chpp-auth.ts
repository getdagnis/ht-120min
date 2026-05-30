import crypto from 'crypto';

export interface OAuthParams {
  oauth_consumer_key: string;
  oauth_nonce: string;
  oauth_signature_method: string;
  oauth_timestamp: string;
  oauth_version: string;
  oauth_token?: string;
  oauth_verifier?: string;
  [key: string]: string | undefined;
}

export function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function getTimestamp(): string {
  return Math.floor(Date.now() / 1000).toString();
}

export function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%7E/g, '~');
}

export function generateSignature(
  method: string,
  url: string,
  params: OAuthParams,
  consumerSecret: string,
  tokenSecret: string = '',
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key] || '')}`)
    .join('&');

  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(sortedParams)].join('&');

  const signingKey = [percentEncode(consumerSecret), percentEncode(tokenSecret)].join('&');

  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

export function getAuthHeader(params: OAuthParams, signature: string): string {
  const oauthParams = { ...params, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(oauthParams)
      .sort()
      .map((key) => `${percentEncode(key)}="${percentEncode(oauthParams[key as keyof typeof oauthParams] || '')}"`)
      .join(', ')
  );
}
