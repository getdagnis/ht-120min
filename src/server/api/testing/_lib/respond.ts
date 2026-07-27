import type { VercelRequest, VercelResponse } from '@vercel/node';
import { beautifyXml, renderTestingHtmlPage } from './xml-format.js';

export function getResponseFormat(req: VercelRequest): 'json' | 'xml' | 'html' {
  const format = String(req.query.format ?? '').toLowerCase();
  if (format === 'xml') return 'xml';
  if (format === 'html') return 'html';
  return 'json';
}

export function wantsRawXml(req: VercelRequest): boolean {
  return getResponseFormat(req) === 'xml';
}

export function respondWithChppResult(
  req: VercelRequest,
  res: VercelResponse,
  payload: {
    label: string;
    params: Record<string, string>;
    httpStatus: number;
    rawXml: string;
    requestUrl?: string;
    requestQuery?: string;
    parsed?: Record<string, unknown>;
  },
) {
  const formattedXml = beautifyXml(payload.rawXml);
  const format = getResponseFormat(req);

  if (format === 'xml') {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(payload.httpStatus).send(formattedXml);
  }

  const debugMeta = {
    requestUrl: payload.requestUrl,
    requestQuery: payload.requestQuery,
  };

  if (format === 'html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(
      renderTestingHtmlPage({
        title: payload.label,
        subtitle: `CHPP HTTP ${payload.httpStatus}`,
        parsed: { ...debugMeta, ...(payload.parsed ?? {}) },
        rawXml: payload.rawXml,
      }),
    );
  }

  return res.status(200).json({
    tool: payload.label,
    chppHttpStatus: payload.httpStatus,
    requestParams: payload.params,
    requestUrl: payload.requestUrl,
    requestQuery: payload.requestQuery,
    parsed: payload.parsed ?? null,
    rawXml: payload.rawXml,
    rawXmlFormatted: formattedXml,
  });
}
