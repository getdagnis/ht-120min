import type { RoundPressInput } from './round-press-input.js';
import { parseAndValidateRoundPressDraft, validateRoundPressDraft, type RoundPressDraft } from './round-press-validator.js';
import { ROUND_PRESS_PROMPT_V2 as ROUND_PRESS_PROMPT_V1 } from './round-press-prompts.js';

export const CLOUDFLARE_ROUND_PRESS_MODEL = '@cf/zai-org/glm-4.7-flash';

export const ROUND_PRESS_CLOUDFLARE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    intro: { type: 'string' },
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          matchId: { type: 'string' },
          paragraph: { type: 'string' },
        },
        required: ['matchId', 'paragraph'],
      },
    },
    outro: { type: 'string' },
  },
  required: ['title', 'intro', 'matches', 'outro'],
} as const;

export class CloudflareAiTemporarilyUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super('Cloudflare AI is temporarily unavailable.');
    this.name = 'CloudflareAiTemporarilyUnavailableError';
  }
}

export class CloudflareAiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareAiConfigurationError';
  }
}

export class CloudflareAiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudflareAiRequestError';
  }
}

interface CloudflareResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export interface CloudflareRoundPressWriterDependencies {
  fetch?: (input: string, init: RequestInit) => Promise<CloudflareResponse>;
  accountId?: string;
  apiToken?: string;
}

function isTransientCloudflareFailure(status: number, payload: unknown) {
  if (status === 408 || status === 429 || status >= 500) return true;
  if (typeof payload !== 'object' || payload === null) return false;
  const messages = (payload as { errors?: unknown; messages?: unknown }).errors ?? (payload as { messages?: unknown }).messages;
  return /out[- ]of[- ]capacity|rate.?limit|temporarily unavailable/i.test(JSON.stringify(messages || ''));
}

function responseContent(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const result = (payload as { result?: unknown }).result;
  if (typeof result === 'string') return result;
  if (typeof result !== 'object' || result === null) return undefined;
  const value = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
  return value.response ?? value.choices?.[0]?.message?.content;
}

function validateCloudflareContent(content: unknown, expectedMatchIds: string[]): RoundPressDraft {
  const validated = typeof content === 'string'
    ? parseAndValidateRoundPressDraft(content, expectedMatchIds)
    : validateRoundPressDraft(content, expectedMatchIds);
  if (validated.draft) return validated.draft;
  throw new CloudflareAiRequestError(`Cloudflare AI returned an invalid round summary: ${validated.errors.join(' ')}`);
}

export async function generateCloudflareRoundPressDraft(
  input: RoundPressInput,
  dependencies: CloudflareRoundPressWriterDependencies = {},
): Promise<{ draft: RoundPressDraft; repaired: boolean }> {
  const accountId = dependencies.accountId ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = dependencies.apiToken ?? process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!accountId || !apiToken) throw new CloudflareAiConfigurationError('Cloudflare AI configuration is missing.');

  const request = dependencies.fetch ?? fetch;
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${CLOUDFLARE_ROUND_PRESS_MODEL}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: ROUND_PRESS_PROMPT_V1 },
          { role: 'user', content: JSON.stringify(input) },
        ],
        reasoning_effort: 'low',
        response_format: {
          type: 'json_schema',
          json_schema: ROUND_PRESS_CLOUDFLARE_RESPONSE_SCHEMA,
        },
      }),
    },
  );

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    if (isTransientCloudflareFailure(response.status, null)) throw new CloudflareAiTemporarilyUnavailableError();
    throw new CloudflareAiRequestError('Cloudflare AI returned an unreadable response.');
  }

  if (!response.ok || (typeof payload === 'object' && payload !== null && (payload as { success?: unknown }).success === false)) {
    if (isTransientCloudflareFailure(response.status, payload)) throw new CloudflareAiTemporarilyUnavailableError();
    if (response.status === 401 || response.status === 403) {
      throw new CloudflareAiConfigurationError('Cloudflare AI authentication failed.');
    }
    throw new CloudflareAiRequestError(`Cloudflare AI request failed with status ${response.status}.`);
  }

  return {
    draft: validateCloudflareContent(responseContent(payload), input.matches.map((match) => match.matchId)),
    repaired: false,
  };
}
