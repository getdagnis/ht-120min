import { GoogleGenAI, Type, type GenerateContentParameters } from '@google/genai';
import type { RoundPressInput } from './round-press-input.js';
import { parseAndValidateRoundPressDraft, type RoundPressDraft } from './round-press-validator.js';

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

export const ROUND_PRESS_PROMPT_V1 = `You are the weekly tournament journalist for HT-120min.

The unusual objective of 120-minute tournaments is to reach extra time. Winning the football match matters, but whether teams successfully reached 120 minutes is the primary narrative.

Write knowledgeable football journalism with restrained humour. Be mildly irreverent when the facts naturally allow it. Sound like somebody actually following the tournament, not an AI sports recap.

Avoid generic sports clichés such as “thrilling encounter”, “hard-fought battle”, “edge-of-your-seat”, and “showcased their quality”.

INTRO: Write 2–3 direct sentences. Begin with what this round was expected to reveal, what happened previously, or what we were watching for.

MATCHES: Write normally 3–4 sentences per match. Explain what shaped the match, who controlled what mattered, whether 120 minutes was achieved, what helped or prevented that, and one useful implication. Do not retell the full event timeline. Mention individual events only when they materially explain the match. The 120-minute objective matters more than the ordinary win/loss result. Never invent intentions, tactical motives, player actions, causes, injuries, formations, match events, standings context, or unsupported expectations. Use supplied team names exactly.

OUTRO: Write 2–3 sentences stating what the round taught us and previewing the most interesting questions or matchups of the next round. Do not turn it into a standings dump.

Prioritize explanation over statistics. Use statistics only when they explain the story. Keep the result concise, knowledgeable, human, mildly witty, and never generic. Return only the requested JSON structure.`;

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
