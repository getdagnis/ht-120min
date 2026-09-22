import { GoogleGenAI, Type, type GenerateContentParameters } from '@google/genai';
import type { RoundPressInput } from './round-press-input.js';
import { parseAndValidateRoundPressDraft, type RoundPressDraft } from './round-press-validator.js';
import { ROUND_PRESS_PROMPT_V2 as ROUND_PRESS_PROMPT_V1 } from './round-press-prompts.js';

export const ROUND_PRESS_PROMPT_VERSION = 1;
export const ROUND_PRESS_MODEL = 'gemini-3.8-flash';
export const ROUND_PRESS_THINKING_LEVEL = 'low';
const ROUND_PRESS_MAX_TRANSPORT_ATTEMPTS = 3;
const ROUND_PRESS_RETRY_DELAYS_MS = [1000, 2000] as const;

export class GeminiTemporarilyUnavailableError extends Error {
  readonly status = 503;

  constructor() {
    super('Gemini is temporarily unavailable.');
    this.name = 'GeminiTemporarilyUnavailableError';
  }
}

export const ROUND_PRESS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    intro: { type: Type.STRING },
    matches: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          matchId: { type: Type.STRING },
          paragraph: { type: Type.STRING },
        },
        required: ['matchId', 'paragraph'],
      },
    },
    outro: { type: Type.STRING },
  },
  required: ['title', 'intro', 'matches', 'outro'],
} as const;

function repairInstruction(errors: string[]) {
  return `The previous JSON draft failed validation: ${errors.join(' ')} Return corrected JSON only, preserving the exact requested match IDs and one paragraph per match.`;
}

interface GeminiTextResponse {
  text?: string;
}

export interface RoundPressWriterDependencies {
  generateContent?: (params: GenerateContentParameters) => Promise<GeminiTextResponse>;
  sleep?: (milliseconds: number) => Promise<void>;
}

function getHttpStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const value = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  const status = value.status ?? value.statusCode ?? value.response?.status;
  return typeof status === 'number' ? status : null;
}

function isTransientGeminiFailure(error: unknown) {
  const status = getHttpStatus(error);
  return status === 429 || status === 503;
}

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function generateWithTransportRetries(
  generateContent: (params: GenerateContentParameters) => Promise<GeminiTextResponse>,
  params: GenerateContentParameters,
  sleep: (milliseconds: number) => Promise<void>,
) {
  for (let attempt = 0; attempt < ROUND_PRESS_MAX_TRANSPORT_ATTEMPTS; attempt += 1) {
    try {
      return await generateContent(params);
    } catch (error) {
      if (!isTransientGeminiFailure(error)) throw error;
      if (attempt === ROUND_PRESS_MAX_TRANSPORT_ATTEMPTS - 1) throw new GeminiTemporarilyUnavailableError();
      await sleep(ROUND_PRESS_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw new GeminiTemporarilyUnavailableError();
}

export async function generateRoundPressDraft(
  input: RoundPressInput,
  dependencies: RoundPressWriterDependencies = {},
): Promise<{ draft: RoundPressDraft; repaired: boolean }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini configuration is missing.');

  const ai = new GoogleGenAI({ apiKey });
  const generateContent = dependencies.generateContent || ((params: GenerateContentParameters) => ai.models.generateContent(params));
  const sleep = dependencies.sleep || defaultSleep;
  const expectedMatchIds = input.matches.map((match) => match.matchId);
  let repair = false;
  let contents = JSON.stringify(input);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await generateWithTransportRetries(generateContent, {
      model: ROUND_PRESS_MODEL,
      contents,
      config: {
        thinkingConfig: { thinkingLevel: ROUND_PRESS_THINKING_LEVEL },
        systemInstruction: ROUND_PRESS_PROMPT_V1,
        responseMimeType: 'application/json',
        responseSchema: ROUND_PRESS_RESPONSE_SCHEMA,
      },
    }, sleep);
    const result = parseAndValidateRoundPressDraft(response.text || '', expectedMatchIds);
    if (result.draft) return { draft: result.draft, repaired: repair };
    if (attempt === 0) {
      repair = true;
      contents = `${JSON.stringify(input)}\n\n${repairInstruction(result.errors)}`;
      console.warn('[Round press] validation failed; attempting one repair', { errors: result.errors });
      continue;
    }
    throw new Error(`Gemini returned an invalid round summary after one repair attempt: ${result.errors.join(' ')}`);
  }

  throw new Error('Gemini round summary generation failed.');
}
